// Test kế hoạch 20 thẻ mỗi ngày — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDayPlan, splitSlots, type PlanItem, type QueueCard } from "./study-card-queue";
import type { CardStage } from "./study-card-schedule";

// 2026-11-06 (thứ Sáu). Hết ngày hôm nay giờ VN = 2026-11-06T17:00:00Z.
const TODAY = "2026-11-06";
const SEED = "subject-1:2026-11-06";
const NOON = Date.parse("2026-11-06T05:00:00Z");

let n = 0;
const mk = (stage: CardStage, over: Partial<QueueCard> = {}): QueueCard => {
  n++;
  const id = `c${String(n).padStart(4, "0")}`;
  return { id, stage, dueAt: null, suspended: false, createdAt: new Date(NOON - 1_000_000 + n * 1000), lastReviewedAt: null, ...over };
};
const dueAt = (daysAgo: number) => new Date(NOON - daysAgo * 86_400_000);
const futureDue = () => new Date(NOON + 5 * 86_400_000);

const news = (k: number) => Array.from({ length: k }, () => mk("NEW"));
const dues = (k: number) => Array.from({ length: k }, (_, i) => mk("WEEKLY", { dueAt: dueAt(k - i) })); // thẻ đầu quá hạn lâu nhất
/** Thẻ đã ôn, chưa đến hạn, có [notYet] lượt Chưa nhớ / [total] lượt ôn. */
const olds = (k: number, notYet: number, total: number, counts: Map<string, number>, totals: Map<string, number>) =>
  Array.from({ length: k }, () => {
    const c = mk("WEEKLY", { dueAt: futureDue() });
    counts.set(c.id, notYet);
    totals.set(c.id, total);
    return c;
  });

const run = (cards: QueueCard[], extra: { existing?: PlanItem[]; seed?: string; notYet?: Map<string, number>; totals?: Map<string, number>; quota?: number } = {}) =>
  buildDayPlan({ today: TODAY, quota: extra.quota, cards, notYetCounts: extra.notYet ?? new Map(), reviewCounts: extra.totals ?? new Map(), existing: extra.existing, seed: extra.seed ?? SEED });
const countOf = (r: ReturnType<typeof run>) => r.counts;

test("splitSlots: ba số không bao giờ vượt R", () => {
  for (let r = 0; r <= 20; r++) {
    const s = splitSlots(r);
    assert.equal(s.NEW + s.HARD + s.RANDOM, r);
    assert.ok(s.NEW >= 0 && s.HARD >= 0 && s.RANDOM >= 0);
  }
  assert.deepEqual(splitSlots(20), { NEW: 14, HARD: 4, RANDOM: 2 });
  assert.deepEqual(splitSlots(12), { NEW: 9, HARD: 2, RANDOM: 1 });
  assert.deepEqual(splitSlots(8), { NEW: 5, HARD: 2, RANDOM: 1 });
});

test("không có thẻ đến hạn → 14 mới, 4 khó, 2 ngẫu nhiên", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const cards = [...news(30), ...olds(10, 3, 5, nc, tc), ...olds(10, 0, 5, nc, tc)];
  const r = run(cards, { notYet: nc, totals: tc });
  assert.deepEqual(countOf(r), { DUE: 0, NEW: 14, HARD: 4, RANDOM: 2 });
  assert.equal(r.items.length, 20);
});

test("8 đến hạn → R=12 → 9 mới, 2 khó, 1 ngẫu nhiên", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const r = run([...dues(8), ...news(30), ...olds(10, 3, 5, nc, tc), ...olds(10, 0, 5, nc, tc)], { notYet: nc, totals: tc });
  assert.deepEqual(countOf(r), { DUE: 8, NEW: 9, HARD: 2, RANDOM: 1 });
});

test("12 đến hạn → còn 8 → 2 khó, 1 ngẫu nhiên, 5 mới", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const r = run([...dues(12), ...news(30), ...olds(10, 3, 5, nc, tc), ...olds(10, 0, 5, nc, tc)], { notYet: nc, totals: tc });
  assert.deepEqual(countOf(r), { DUE: 12, NEW: 5, HARD: 2, RANDOM: 1 });
});

test("20 đến hạn → không có thẻ mới", () => {
  const r = run([...dues(20), ...news(30)]);
  assert.deepEqual(countOf(r), { DUE: 20, NEW: 0, HARD: 0, RANDOM: 0 });
});

test("25 đến hạn → đúng 20, quá hạn lâu nhất trước, phần dư dồn sang ngày sau", () => {
  const cards = dues(25);
  const r = run(cards);
  assert.equal(r.items.length, 20);
  assert.deepEqual(r.items.map((i) => i.cardId), cards.slice(0, 20).map((c) => c.id));
  assert.ok(r.items.every((i) => i.bucket === "DUE"));
});

test("đến hạn: tính đến hết hôm nay giờ VN, không tính ngày mai", () => {
  const lastSecond = mk("WEEKLY", { dueAt: new Date("2026-11-06T16:59:59Z") }); // 23:59:59 VN
  const tomorrow = mk("WEEKLY", { dueAt: new Date("2026-11-06T17:00:00Z") }); // 00:00 ngày mai VN
  const r = run([lastSecond, tomorrow]);
  assert.equal(r.items.find((i) => i.cardId === lastSecond.id)!.bucket, "DUE");
  assert.equal(r.items.find((i) => i.cardId === tomorrow.id)!.bucket, "RANDOM"); // chưa đến hạn → chỉ là ứng viên ngẫu nhiên
});

test("thẻ NEW và thẻ tạm dừng không bao giờ là DUE; thẻ tạm dừng không xuất hiện", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const paused = [mk("NEW", { suspended: true }), mk("WEEKLY", { suspended: true, dueAt: dueAt(3) })];
  const hardPaused = mk("WEEKLY", { suspended: true, dueAt: futureDue() });
  nc.set(hardPaused.id, 5);
  tc.set(hardPaused.id, 5);
  const r = run([...paused, hardPaused, ...news(3)], { notYet: nc, totals: tc });
  const ids = new Set(r.items.map((i) => i.cardId));
  for (const p of [...paused, hardPaused]) assert.ok(!ids.has(p.id));
  assert.equal(r.items.length, 3);
});

test("thiếu thẻ mới → chỗ trống bù bằng khó rồi ngẫu nhiên", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  // 4 mới (thiếu 10 chỗ) → khó có 8 (4 slot + 4 bù) → ngẫu nhiên có 10 (2 slot + 6 bù nhưng chỉ cần phần còn lại).
  const r = run([...news(4), ...olds(8, 3, 5, nc, tc), ...olds(10, 0, 5, nc, tc)], { notYet: nc, totals: tc });
  assert.deepEqual(countOf(r), { DUE: 0, NEW: 4, HARD: 8, RANDOM: 8 });
  assert.equal(r.items.length, 20);
});

test("thiếu mới và thiếu khó → bù nốt bằng ngẫu nhiên", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const r = run([...news(2), ...olds(1, 3, 5, nc, tc), ...olds(30, 0, 5, nc, tc)], { notYet: nc, totals: tc });
  assert.deepEqual(countOf(r), { DUE: 0, NEW: 2, HARD: 1, RANDOM: 17 });
});

test("thừa mới nhưng thiếu khó và ngẫu nhiên → bù bằng mới", () => {
  const r = run(news(30));
  assert.deepEqual(countOf(r), { DUE: 0, NEW: 20, HARD: 0, RANDOM: 0 });
});

test("không đủ thẻ thì để trống, không ép đủ 20", () => {
  const r = run([...news(3), ...dues(2)]);
  assert.equal(r.items.length, 5);
  assert.equal(run([]).items.length, 0);
});

test("thẻ mới theo thứ tự tạo (cũ nhất trước)", () => {
  const cards = news(5).reverse(); // đầu vào đảo thứ tự
  const r = run(cards);
  const created = [...cards].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((c) => c.id);
  assert.deepEqual(r.items.map((i) => i.cardId), created);
});

test("nhóm khó: ≥ 2 Chưa nhớ, xếp tỷ lệ giảm dần, bằng nhau thì ôn lâu nhất trước", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const set = (c: QueueCard, notYet: number, total: number) => (nc.set(c.id, notYet), tc.set(c.id, total), c);
  const high = set(mk("WEEKLY", { dueAt: futureDue(), lastReviewedAt: new Date(NOON - 1000) }), 3, 4); // 0.75
  const tieOld = set(mk("WEEKLY", { dueAt: futureDue(), lastReviewedAt: new Date(NOON - 9_000_000) }), 2, 4); // 0.5, ôn lâu hơn
  const tieNew = set(mk("WEEKLY", { dueAt: futureDue(), lastReviewedAt: new Date(NOON - 1_000_000) }), 2, 4); // 0.5
  const low = set(mk("WEEKLY", { dueAt: futureDue() }), 2, 10); // 0.2
  const notHard = set(mk("WEEKLY", { dueAt: futureDue() }), 1, 1); // chỉ 1 lượt Chưa nhớ → không khó
  const r = run([low, tieNew, notHard, high, tieOld], { notYet: nc, totals: tc, quota: 20 });
  const hardIds = r.items.filter((i) => i.bucket === "HARD").map((i) => i.cardId);
  assert.deepEqual(hardIds, [high.id, tieOld.id, tieNew.id, low.id]);
  assert.equal(r.items.find((i) => i.cardId === notHard.id)!.bucket, "RANDOM");
});

test("thẻ khó/ngẫu nhiên không được đến hạn hôm nay (thẻ đến hạn chỉ vào DUE)", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const dueHard = mk("WEEKLY", { dueAt: dueAt(1) });
  nc.set(dueHard.id, 5);
  tc.set(dueHard.id, 5);
  const r = run([dueHard, ...news(30)], { notYet: nc, totals: tc });
  assert.equal(r.items.find((i) => i.cardId === dueHard.id)!.bucket, "DUE");
  assert.equal(r.counts.HARD, 0);
});

test("cùng hạt giống ra cùng danh sách ngẫu nhiên, kể cả khi đổi thứ tự đầu vào", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const cards = olds(40, 0, 5, nc, tc);
  const pick = (cs: QueueCard[], seed: string) => run(cs, { notYet: nc, totals: tc, seed }).items.map((i) => i.cardId);
  const a = pick(cards, "s1:2026-11-06");
  assert.deepEqual(pick(cards, "s1:2026-11-06"), a);
  assert.deepEqual(pick([...cards].reverse(), "s1:2026-11-06"), a);
  assert.notDeepEqual(pick(cards, "s1:2026-11-07"), a);
  assert.equal(a.length, 20);
});

test("bù thêm: giữ nguyên mục đã có, chỉ thêm thẻ mới, không trùng", () => {
  const existing: PlanItem[] = [
    { cardId: "old-1", bucket: "DUE" },
    { cardId: "old-2", bucket: "NEW" },
    { cardId: "old-3", bucket: "RANDOM" },
  ];
  const cards = [...news(40), mk("NEW", { id: "old-2" } as Partial<QueueCard>)];
  const r = run(cards, { existing });
  assert.deepEqual(r.items.slice(0, 3), existing);
  assert.equal(r.items.length, 20);
  assert.equal(r.added.length, 17);
  assert.equal(new Set(r.items.map((i) => i.cardId)).size, 20);
  assert.ok(r.added.every((i) => i.cardId !== "old-2"));
});

test("bù thêm: thẻ mới → khó → ngẫu nhiên theo thứ tự, không vượt quota", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  const existing: PlanItem[] = Array.from({ length: 10 }, (_, i) => ({ cardId: `e${i}`, bucket: "NEW" as const }));
  const cards = [...news(4), ...olds(3, 3, 5, nc, tc), ...olds(20, 0, 5, nc, tc)];
  const r = run(cards, { existing, notYet: nc, totals: tc });
  assert.deepEqual(r.added.map((i) => i.bucket), ["NEW", "NEW", "NEW", "NEW", "HARD", "HARD", "HARD", "RANDOM", "RANDOM", "RANDOM"]);
  assert.equal(r.items.length, 20);
});

test("bù thêm: kế hoạch đã đầy thì không thêm gì; thẻ đã tạm dừng vẫn giữ trong kế hoạch", () => {
  const full: PlanItem[] = Array.from({ length: 20 }, (_, i) => ({ cardId: `e${i}`, bucket: "NEW" as const }));
  const r = run([...news(10), mk("NEW", { suspended: true, id: "e0" } as Partial<QueueCard>)], { existing: full });
  assert.deepEqual(r.items, full);
  assert.equal(r.added.length, 0);
});

test("bù thêm: tính counts trên toàn bộ kế hoạch", () => {
  const existing: PlanItem[] = [{ cardId: "x", bucket: "DUE" }, { cardId: "y", bucket: "HARD" }];
  const r = run(news(3), { existing });
  assert.deepEqual(r.counts, { DUE: 1, NEW: 3, HARD: 1, RANDOM: 0 });
});

test("quota: mặc định và tối đa 20; quota nhỏ hơn được tôn trọng", () => {
  assert.equal(run(news(50), { quota: 99 }).items.length, 20);
  assert.equal(run(news(50), { quota: 7 }).items.length, 7);
  assert.equal(run(dues(30), { quota: 5 }).items.length, 5);
});

test("tổng không bao giờ quá 20 với mọi tổ hợp đến hạn", () => {
  const nc = new Map<string, number>(), tc = new Map<string, number>();
  for (const d of [0, 1, 7, 13, 19, 20, 21, 40]) {
    const r = run([...dues(d), ...news(30), ...olds(8, 3, 5, nc, tc), ...olds(30, 0, 5, nc, tc)], { notYet: nc, totals: tc });
    assert.ok(r.items.length <= 20, `due=${d}`);
    assert.equal(r.items.length, 20, `due=${d} vẫn đủ thẻ để đầy`);
  }
});
