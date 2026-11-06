// Test trạng thái thẻ trong kế hoạch hôm nay — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCard, comparePlanCards, dayBounds, isExtraReview, summarizeDay, type DayReview, type PlanCard } from "./study-card-day";
import type { CardBucket } from "./study-card-queue";
import type { CardRating } from "./study-card-schedule";

// Hôm nay = 2026-11-06 giờ VN: [2026-11-05T17:00Z, 2026-11-06T17:00Z).
const TODAY = "2026-11-06";
const vn = (s: string) => new Date(`${s}+07:00`);
const NOW = vn("2026-11-06T10:00:00");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

let n = 0;
const card = (bucket: CardBucket, over: Partial<PlanCard> = {}): PlanCard => ({ cardId: `c${String(++n).padStart(3, "0")}`, bucket, suspended: false, dueAt: null, createdAt: new Date(2026, 0, 1, 0, 0, n), ...over });
const review = (c: PlanCard, rating: CardRating, at = NOW): DayReview => ({ cardId: c.cardId, rating, reviewedAt: at });
const run = (plan: PlanCard[], reviewsToday: DayReview[] = [], now = NOW) => summarizeDay({ today: TODAY, now, plan, reviewsToday });

test("dayBounds: [00:00 VN hôm nay, 00:00 VN ngày mai)", () => {
  const b = dayBounds(TODAY);
  assert.equal(b.start.toISOString(), "2026-11-05T17:00:00.000Z");
  assert.equal(b.end.toISOString(), "2026-11-06T17:00:00.000Z");
});

test("isExtraReview: chỉ HARD/RANDOM và chỉ lượt đầu tiên trong ngày", () => {
  assert.equal(isExtraReview("HARD", false), true);
  assert.equal(isExtraReview("RANDOM", false), true);
  assert.equal(isExtraReview("HARD", true), false); // lượt sau NOT_YET là lượt thường
  assert.equal(isExtraReview("RANDOM", true), false);
  assert.equal(isExtraReview("DUE", false), false);
  assert.equal(isExtraReview("NEW", false), false);
});

test("classifyCard: chưa ôn → PENDING", () => {
  assert.equal(classifyCard({ dueAt: null, lastRatingToday: null, now: NOW, today: TODAY }), "PENDING");
  assert.equal(classifyCard({ dueAt: min(-500), lastRatingToday: null, now: NOW, today: TODAY }), "PENDING"); // thẻ DUE chưa ôn
});

test("classifyCard: Đã nhớ / Cần ôn lại → FINISHED", () => {
  for (const r of ["REMEMBERED", "REVIEW_AGAIN"] as const) assert.equal(classifyCard({ dueAt: vn("2026-11-07T00:00:00"), lastRatingToday: r, now: NOW, today: TODAY }), "FINISHED");
});

test("classifyCard: NOT_YET hạn ≤ bây giờ → RETURNING_DUE; hạn sau bây giờ nhưng trong hôm nay → RETURNING_WAIT", () => {
  assert.equal(classifyCard({ dueAt: min(-1), lastRatingToday: "NOT_YET", now: NOW, today: TODAY }), "RETURNING_DUE");
  assert.equal(classifyCard({ dueAt: NOW, lastRatingToday: "NOT_YET", now: NOW, today: TODAY }), "RETURNING_DUE"); // đúng hạn
  assert.equal(classifyCard({ dueAt: min(5), lastRatingToday: "NOT_YET", now: NOW, today: TODAY }), "RETURNING_WAIT");
});

test("classifyCard: NOT_YET mà hạn rơi sang ngày mai (23:58 VN) → coi như xong hôm nay", () => {
  const late = vn("2026-11-06T23:58:00");
  assert.equal(classifyCard({ dueAt: new Date(late.getTime() + 5 * 60_000), lastRatingToday: "NOT_YET", now: late, today: TODAY }), "FINISHED");
  // 16:59:59Z = 23:59:59 VN còn trong hôm nay; 17:00:00Z = 00:00 ngày mai
  assert.equal(classifyCard({ dueAt: new Date("2026-11-06T16:59:59Z"), lastRatingToday: "NOT_YET", now: NOW, today: TODAY }), "RETURNING_WAIT");
  assert.equal(classifyCard({ dueAt: new Date("2026-11-06T17:00:00Z"), lastRatingToday: "NOT_YET", now: NOW, today: TODAY }), "FINISHED");
});

test("summarizeDay: tiến độ, hàng ôn theo thứ tự kế hoạch, theo từng nhóm", () => {
  const d1 = card("DUE", { dueAt: min(-3000) });
  const d2 = card("DUE", { dueAt: min(-9000) }); // quá hạn lâu hơn → đứng trước d1
  const n1 = card("NEW");
  const n2 = card("NEW");
  const h1 = card("HARD");
  const r1 = card("RANDOM");
  const s = run([r1, h1, n2, d1, n1, d2], [review(n1, "REMEMBERED"), review(d1, "REVIEW_AGAIN")]);
  assert.deepEqual(s.queue, [d2.cardId, n2.cardId, h1.cardId, r1.cardId]);
  assert.deepEqual(s.progress.planned, 6);
  assert.deepEqual([s.progress.finished, s.progress.remaining], [2, 4]);
  assert.deepEqual(s.progress.byBucket, { DUE: { planned: 2, finished: 1 }, NEW: { planned: 2, finished: 1 }, HARD: { planned: 1, finished: 0 }, RANDOM: { planned: 1, finished: 0 } });
  assert.equal(s.soonestDueAt, null);
});

test("summarizeDay: NOT_YET đang chờ → soonestDueAt là hạn sớm nhất; không có trong hàng, chưa tính finished", () => {
  const a = card("NEW", { dueAt: min(5) });
  const b = card("NEW", { dueAt: min(2) });
  const c = card("NEW");
  const s = run([a, b, c], [review(a, "NOT_YET"), review(b, "NOT_YET")]);
  assert.deepEqual(s.queue, [c.cardId]);
  assert.equal(s.soonestDueAt!.getTime(), min(2).getTime());
  assert.equal(s.progress.finished, 0);
  assert.equal(s.statuses.get(a.cardId), "RETURNING_WAIT");
});

test("summarizeDay: NOT_YET đã đến hạn quay lại hàng ôn; hết hạn chờ thì soonestDueAt null", () => {
  const a = card("NEW", { dueAt: min(-1) });
  const s = run([a], [review(a, "NOT_YET")]);
  assert.deepEqual(s.queue, [a.cardId]);
  assert.equal(s.soonestDueAt, null);
});

test("summarizeDay: lượt cuối trong ngày quyết định (NOT_YET rồi REMEMBERED → xong)", () => {
  const a = card("HARD", { dueAt: vn("2026-11-08T00:00:00") });
  // đưa lượt vào lộn thứ tự: hàm tự sắp theo thời gian
  const s = run([a], [review(a, "REMEMBERED", min(-1)), review(a, "NOT_YET", min(-30))]);
  assert.equal(s.statuses.get(a.cardId), "FINISHED");
  assert.equal(s.progress.finished, 1);
  assert.ok(s.reviewedToday.has(a.cardId));
});

test("summarizeDay: NOT_YET rồi hạn rơi sang ngày mai → finished, không vào soonestDueAt", () => {
  const late = vn("2026-11-06T23:58:00");
  const a = card("NEW", { dueAt: new Date(late.getTime() + 5 * 60_000) });
  const s = run([a], [review(a, "NOT_YET", late)], late);
  assert.deepEqual([s.progress.finished, s.progress.remaining, s.soonestDueAt], [1, 0, null]);
});

test("summarizeDay: thẻ tạm dừng không tính vào kế hoạch, hàng ôn và tiến độ", () => {
  const a = card("NEW", { suspended: true });
  const b = card("NEW");
  const s = run([a, b]);
  assert.deepEqual(s.queue, [b.cardId]);
  assert.equal(s.progress.planned, 1);
  assert.ok(!s.statuses.has(a.cardId));
});

test("summarizeDay: kế hoạch rỗng", () => {
  const s = run([]);
  assert.deepEqual(s.queue, []);
  assert.deepEqual(s.progress, { planned: 0, finished: 0, remaining: 0, byBucket: { DUE: { planned: 0, finished: 0 }, NEW: { planned: 0, finished: 0 }, HARD: { planned: 0, finished: 0 }, RANDOM: { planned: 0, finished: 0 } } });
  assert.equal(s.soonestDueAt, null);
});

test("comparePlanCards: DUE theo hạn, NEW theo ngày tạo, tie theo id", () => {
  const a = card("NEW", { createdAt: new Date(2026, 0, 2) });
  const b = card("NEW", { createdAt: new Date(2026, 0, 1) });
  assert.ok(comparePlanCards(b, a) < 0);
  const x = card("RANDOM", { createdAt: new Date(2026, 0, 1) });
  const y = card("RANDOM", { createdAt: new Date(2026, 0, 1) });
  assert.ok(comparePlanCards(x, y) < 0); // id c-nhỏ trước
  assert.ok(comparePlanCards(card("DUE", { dueAt: min(-10) }), card("DUE", { dueAt: min(-5) })) < 0);
});
