import { addDaysIso } from "@/lib/deadline-alert";
import type { CardStage } from "@/lib/study-card-schedule";
import { vnDayStart } from "@/lib/vn-time";

// Kế hoạch thẻ của một ngày, tối đa [quota] ≤ 20 thẻ (mục 3 của kế hoạch thẻ từ vựng). Hàm thuần, không đụng DB —
// test ở study-card-queue.test.ts.

export type CardBucket = "DUE" | "NEW" | "HARD" | "RANDOM";
export const MAX_DAILY_CARDS = 20;
/** Số lượt Chưa nhớ trong 30 ngày để thẻ vào nhóm khó. */
export const HARD_MIN_NOT_YET = 2;

export type QueueCard = { id: string; stage: CardStage; dueAt: Date | null; suspended: boolean; createdAt: Date; lastReviewedAt: Date | null };
export type PlanItem = { cardId: string; bucket: CardBucket };

export type QueueInput = {
  /** Ngày theo giờ VN, "YYYY-MM-DD". */
  today: string;
  /** Mặc định và tối đa 20. */
  quota?: number;
  cards: readonly QueueCard[];
  /** Số lượt NOT_YET của từng thẻ trong 30 ngày (thiếu = 0). */
  notYetCounts: ReadonlyMap<string, number>;
  /** Tổng số lượt ôn của từng thẻ trong 30 ngày (thiếu = 0). */
  reviewCounts: ReadonlyMap<string, number>;
  /** Kế hoạch đã lưu của hôm nay; có thì giữ nguyên và chỉ bù thêm. */
  existing?: readonly PlanItem[];
  /** Hạt giống cho nhóm ngẫu nhiên (id môn + ngày): cùng hạt giống ra cùng danh sách. */
  seed: string;
};

export type QueueResult = {
  /** Toàn bộ kế hoạch: thẻ đã có (giữ nguyên thứ tự) rồi thẻ bù thêm. */
  items: PlanItem[];
  /** Chỉ phần bù thêm lần này — route chèn đúng phần này vào DB. */
  added: PlanItem[];
  /** Số thẻ từng nhóm trong toàn bộ kế hoạch. */
  counts: Record<CardBucket, number>;
};

/** Hạt giống chuỗi → số 32 bit (xmur3). */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Bộ sinh số ngẫu nhiên có hạt giống (mulberry32), trả [0, 1). */
function rng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Xáo trộn Fisher–Yates có hạt giống; xếp theo id trước để kết quả không phụ thuộc thứ tự đầu vào. */
function seededShuffle<T extends { id: string }>(items: readonly T[], seed: string): T[] {
  const out = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const time = (d: Date | null) => (d ? d.getTime() : -Infinity); // chưa ôn bao giờ = cũ nhất

/**
 * Chia R chỗ còn lại: khó = làm tròn 20%, ngẫu nhiên = làm tròn 10%, mới = phần còn lại.
 * Ba số không bao giờ cộng quá R.
 */
export function splitSlots(remaining: number): { NEW: number; HARD: number; RANDOM: number } {
  const hard = Math.min(Math.round(remaining / 5), remaining);
  const random = Math.min(Math.round(remaining / 10), remaining - hard);
  return { NEW: remaining - hard - random, HARD: hard, RANDOM: random };
}

/**
 * Tạo kế hoạch ngày (chưa có [existing]) hoặc bù thêm vào kế hoạch đã có.
 * - Tạo mới: DUE (quá hạn lâu nhất trước, tối đa quota), rồi chia chỗ còn lại 70/20/10 mới/khó/ngẫu nhiên,
 *   thiếu nhóm nào thì bù theo thứ tự mới → khó → ngẫu nhiên, vẫn thiếu thì để trống (không ép đủ).
 * - Bù thêm: giữ nguyên mọi mục đã có, chỉ thêm thẻ chưa có trong kế hoạch, không vượt quota. Thứ tự bù:
 *   thẻ đến hạn hôm nay còn sót (hiếm), mới → khó → ngẫu nhiên.
 */
export function buildDayPlan(input: QueueInput): QueueResult {
  const quota = Math.min(Math.max(Math.floor(input.quota ?? MAX_DAILY_CARDS), 1), MAX_DAILY_CARDS);
  const existing = input.existing ?? [];
  const endOfToday = vnDayStart(addDaysIso(input.today, 1)).getTime(); // loại trừ: hạn trước mốc này là đến hạn hôm nay
  const inPlan = new Set(existing.map((e) => e.cardId));
  const notYet = (c: QueueCard) => input.notYetCounts.get(c.id) ?? 0;
  const rate = (c: QueueCard) => {
    const total = input.reviewCounts.get(c.id) ?? 0;
    return total > 0 ? notYet(c) / total : 0;
  };

  const usable = input.cards.filter((c) => !c.suspended && !inPlan.has(c.id));
  const isDue = (c: QueueCard) => c.stage !== "NEW" && c.dueAt !== null && c.dueAt.getTime() < endOfToday;
  const due = usable.filter(isDue).sort((a, b) => time(a.dueAt) - time(b.dueAt) || byId(a, b));
  const fresh = usable.filter((c) => c.stage === "NEW").sort((a, b) => time(a.createdAt) - time(b.createdAt) || byId(a, b));
  const older = usable.filter((c) => c.stage !== "NEW" && !isDue(c));
  const hard = older
    .filter((c) => notYet(c) >= HARD_MIN_NOT_YET)
    .sort((a, b) => rate(b) - rate(a) || time(a.lastReviewedAt) - time(b.lastReviewedAt) || byId(a, b));
  const random = seededShuffle(
    older.filter((c) => notYet(c) < HARD_MIN_NOT_YET),
    input.seed
  );

  const added: PlanItem[] = [];
  const room = () => quota - existing.length - added.length;
  const take = (cards: readonly QueueCard[], bucket: CardBucket, max: number) => {
    const n = Math.max(0, Math.min(max, room(), cards.length));
    for (const c of cards.slice(0, n)) added.push({ cardId: c.id, bucket });
    return n;
  };

  if (existing.length === 0) {
    take(due, "DUE", quota);
    const slots = splitSlots(room());
    const nNew = take(fresh, "NEW", slots.NEW);
    const nHard = take(hard, "HARD", slots.HARD);
    const nRandom = take(random, "RANDOM", slots.RANDOM);
    // Chỗ trống của nhóm thiếu thẻ: bù từ phần còn lại theo thứ tự mới → khó → ngẫu nhiên.
    let gap = slots.NEW - nNew + (slots.HARD - nHard) + (slots.RANDOM - nRandom);
    gap = Math.min(gap, room());
    gap -= take(fresh.slice(nNew), "NEW", gap);
    gap -= take(hard.slice(nHard), "HARD", gap);
    take(random.slice(nRandom), "RANDOM", gap);
  } else {
    take(due, "DUE", room());
    take(fresh, "NEW", room());
    take(hard, "HARD", room());
    take(random, "RANDOM", room());
  }

  const items = [...existing, ...added];
  const counts: Record<CardBucket, number> = { DUE: 0, NEW: 0, HARD: 0, RANDOM: 0 };
  for (const i of items) counts[i.bucket]++;
  return { items, added, counts };
}
