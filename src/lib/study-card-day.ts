import { addDaysIso } from "@/lib/deadline-alert";
import type { CardBucket } from "@/lib/study-card-queue";
import type { CardRating } from "@/lib/study-card-schedule";
import { vnDayStart } from "@/lib/vn-time";

// Trạng thái từng thẻ trong kế hoạch HÔM NAY: chờ ôn, đã xong, đang chờ quay lại. Hàm thuần, không đụng DB —
// test ở study-card-day.test.ts.
//
// - FINISHED: hôm nay đã có lượt ôn và lượt cuối KHÔNG phải NOT_YET; hoặc lượt cuối là NOT_YET nhưng hạn quay lại
//   rơi sang ngày khác (coi như xong trong ngày).
// - RETURNING: lượt ôn cuối hôm nay là NOT_YET và hạn còn trong hôm nay. RETURNING_DUE (hạn ≤ bây giờ) hiện lại
//   trong hàng ôn; RETURNING_WAIT (hạn > bây giờ) chỉ tính vào soonestDueAt.
// - PENDING: hôm nay chưa có lượt ôn nào.
// Thẻ tạm dừng không được tính vào kế hoạch (không planned, không finished, không trong hàng).

export type DayStatus = "PENDING" | "FINISHED" | "RETURNING_DUE" | "RETURNING_WAIT";

export type PlanCard = { cardId: string; bucket: CardBucket; suspended: boolean; dueAt: Date | null; createdAt: Date };
export type DayReview = { cardId: string; rating: CardRating; reviewedAt: Date };

export type BucketProgress = { planned: number; finished: number };
export type DaySummary = {
  /** Trạng thái các thẻ không tạm dừng của kế hoạch. */
  statuses: Map<string, DayStatus>;
  /** Thẻ hôm nay đã có ít nhất một lượt ôn (kể cả thẻ tạm dừng). */
  reviewedToday: Set<string>;
  /** Thẻ cần hiện ngay: PENDING + RETURNING_DUE, theo thứ tự kế hoạch. */
  queue: string[];
  progress: { planned: number; finished: number; remaining: number; byBucket: Record<CardBucket, BucketProgress> };
  /** Hạn sớm nhất của thẻ RETURNING còn đợi trong hôm nay; null nếu không có. */
  soonestDueAt: Date | null;
};

const BUCKET_RANK: Record<CardBucket, number> = { DUE: 0, NEW: 1, HARD: 2, RANDOM: 3 };

/** [start, end) của ngày giờ VN "YYYY-MM-DD". */
export function dayBounds(today: string): { start: Date; end: Date } {
  return { start: vnDayStart(today), end: vnDayStart(addDaysIso(today, 1)) };
}

/** Ôn thêm (Đã nhớ không đổi giai đoạn/hạn) chỉ với thẻ HARD/RANDOM và chỉ ở lượt ôn đầu tiên trong ngày. */
export function isExtraReview(bucket: CardBucket, hasReviewToday: boolean): boolean {
  return (bucket === "HARD" || bucket === "RANDOM") && !hasReviewToday;
}

/** Trạng thái một thẻ trong kế hoạch; [lastRatingToday] null = hôm nay chưa ôn. */
export function classifyCard(input: { dueAt: Date | null; lastRatingToday: CardRating | null; now: Date; today: string }): DayStatus {
  const { dueAt, lastRatingToday, now, today } = input;
  if (lastRatingToday === null) return "PENDING";
  if (lastRatingToday !== "NOT_YET") return "FINISHED";
  if (dueAt === null) return "RETURNING_DUE";
  if (dueAt.getTime() >= dayBounds(today).end.getTime()) return "FINISHED"; // quay lại sau nửa đêm: xong cho hôm nay
  return dueAt.getTime() <= now.getTime() ? "RETURNING_DUE" : "RETURNING_WAIT";
}

/** Thứ tự kế hoạch (bảng plan không lưu vị trí): DUE → NEW → HARD → RANDOM; DUE theo hạn, còn lại theo ngày tạo, rồi id. */
export function comparePlanCards(a: PlanCard, b: PlanCard): number {
  if (a.bucket !== b.bucket) return BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket];
  const ka = a.bucket === "DUE" ? (a.dueAt?.getTime() ?? Infinity) : a.createdAt.getTime();
  const kb = b.bucket === "DUE" ? (b.dueAt?.getTime() ?? Infinity) : b.createdAt.getTime();
  return ka - kb || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
}

/** Gom tiến độ, hàng ôn và soonestDueAt của một môn. [reviewsToday] là các lượt ôn trong [start, end) của hôm nay. */
export function summarizeDay(input: { today: string; now: Date; plan: readonly PlanCard[]; reviewsToday: readonly DayReview[] }): DaySummary {
  const { today, now } = input;
  const last = new Map<string, CardRating>();
  for (const r of [...input.reviewsToday].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime())) last.set(r.cardId, r.rating);

  const active = input.plan.filter((c) => !c.suspended).sort(comparePlanCards);
  const statuses = new Map<string, DayStatus>();
  const byBucket: Record<CardBucket, BucketProgress> = { DUE: { planned: 0, finished: 0 }, NEW: { planned: 0, finished: 0 }, HARD: { planned: 0, finished: 0 }, RANDOM: { planned: 0, finished: 0 } };
  const queue: string[] = [];
  let finished = 0;
  let soonest: Date | null = null;

  for (const c of active) {
    const status = classifyCard({ dueAt: c.dueAt, lastRatingToday: last.get(c.cardId) ?? null, now, today });
    statuses.set(c.cardId, status);
    byBucket[c.bucket].planned++;
    if (status === "FINISHED") {
      finished++;
      byBucket[c.bucket].finished++;
    } else if (status === "RETURNING_WAIT") {
      if (c.dueAt && (soonest === null || c.dueAt.getTime() < soonest.getTime())) soonest = c.dueAt;
    } else {
      queue.push(c.cardId);
    }
  }
  return {
    statuses,
    reviewedToday: new Set(last.keys()),
    queue,
    progress: { planned: active.length, finished, remaining: active.length - finished, byBucket },
    soonestDueAt: soonest,
  };
}
