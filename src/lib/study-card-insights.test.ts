// Test thống kê nhóm khó — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsights, countTopics, lessonLabel, periodStart, type InsightCard, type InsightReview } from "./study-card-insights";

let n = 0;
const card = (over: Partial<InsightCard> = {}): InsightCard => ({ id: `c${String(++n).padStart(4, "0")}`, kind: "COLLOCATION", topics: [], sourceLogId: null, notYetCount: 0, reviewCount: 0, ...over });
const many = (k: number, over: Partial<InsightCard> = {}) => Array.from({ length: k }, () => card(over));
const run = (cards: InsightCard[], reviews: InsightReview[] = [], labels = new Map<string, string>()) => buildInsights({ cards, reviews, lessonLabels: labels });

test("nhóm có 9 thẻ từng Chưa nhớ thì ẩn, đủ 10 thì hiện", () => {
  assert.deepEqual(run(many(9, { kind: "IDIOM", notYetCount: 1 })).byKind, []);
  const r = run([...many(10, { kind: "IDIOM", notYetCount: 1 }), ...many(5, { kind: "IDIOM" })]);
  assert.equal(r.byKind.length, 1);
  assert.deepEqual(r.byKind[0], { key: "IDIOM", label: "IDIOM", totalCards: 15, everNotYetCards: 10, rate: 10 / 15 });
});

test("thẻ Chưa nhớ rồi Đã nhớ vẫn tính (notYetCount ≥ 1 là đủ, không xét lượt sau)", () => {
  const cards = many(10, { notYetCount: 1, reviewCount: 2 });
  const reviews = cards.flatMap((c): InsightReview[] => [
    { cardId: c.id, rating: "NOT_YET", stageBefore: "LEARNING", stageAfter: "LEARNING" },
    { cardId: c.id, rating: "REMEMBERED", stageBefore: "LEARNING", stageAfter: "WEEKLY" },
  ]);
  const r = run(cards, reviews);
  assert.equal(r.byKind[0].everNotYetCards, 10);
  assert.equal(r.totals.reviews, 20);
  assert.equal(r.totals.notYetRate, 0.5);
  assert.equal(r.totals.promotedToWeekly, 10);
});

test("thẻ có hai chủ đề được tính ở cả hai; chủ đề lặp trong một thẻ chỉ tính một lần", () => {
  const r = run([...many(10, { topics: ["travel", "work"], notYetCount: 2 }), ...many(10, { topics: ["travel", "travel"], notYetCount: 1 })]);
  const by = Object.fromEntries(r.byTopic.map((g) => [g.key, g]));
  assert.equal(by.travel.totalCards, 20);
  assert.equal(by.travel.everNotYetCards, 20);
  assert.equal(by.work.totalCards, 10);
  assert.equal(by.work.everNotYetCards, 10);
});

test("xếp theo tỷ lệ giảm dần, bằng nhau thì theo số thẻ giảm dần, rồi theo tên", () => {
  const r = run([
    ...many(10, { kind: "IDIOM", notYetCount: 1 }), // 10/10 = 1
    ...many(10, { kind: "PATTERN", notYetCount: 1 }), ...many(10, { kind: "PATTERN" }), // 10/20 = 0.5
    ...many(12, { kind: "COLLOCATION", notYetCount: 1 }), ...many(12, { kind: "COLLOCATION" }), // 12/24 = 0.5, nhiều thẻ hơn
    ...many(10, { kind: "EXPRESSION", notYetCount: 1 }), ...many(10, { kind: "EXPRESSION" }), // 10/20 = 0.5, tên sau PATTERN? E < P
  ]);
  assert.deepEqual(r.byKind.map((g) => g.key), ["IDIOM", "COLLOCATION", "EXPRESSION", "PATTERN"]);
});

test("byLesson: dùng nhãn buổi học, thiếu nhãn thì dùng id, thẻ không có buổi học bị bỏ qua", () => {
  const r = run([...many(10, { sourceLogId: "log-1", notYetCount: 1 }), ...many(10, { sourceLogId: "log-2", notYetCount: 1 }), ...many(20, { notYetCount: 1 })], [], new Map([["log-1", "Buổi 12/10"]]));
  assert.deepEqual(r.byLesson.map((g) => g.label).sort(), ["Buổi 12/10", "log-2"]);
  assert.equal(r.byLesson.find((g) => g.key === "log-1")!.label, "Buổi 12/10");
});

test("hardestCards: từ 3 lượt Chưa nhớ, nhiều nhất trước, tối đa 10", () => {
  const cards = [card({ notYetCount: 2 }), ...Array.from({ length: 12 }, (_, i) => card({ notYetCount: 3 + i, reviewCount: 20 }))];
  const r = run(cards);
  assert.equal(r.hardestCards.length, 10);
  assert.deepEqual(r.hardestCards.map((c) => c.notYetCount), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.ok(r.hardestCards.every((c) => c.notYetCount >= 3));
  assert.deepEqual(run([card({ notYetCount: 2 })]).hardestCards, []);
});

test("promotedToWeekly: chỉ tính lượt sang WEEKLY từ giai đoạn khác", () => {
  const r = run([], [
    { cardId: "a", rating: "REMEMBERED", stageBefore: "NEW", stageAfter: "WEEKLY" },
    { cardId: "b", rating: "REMEMBERED", stageBefore: "LEARNING", stageAfter: "WEEKLY" },
    { cardId: "c", rating: "REMEMBERED", stageBefore: "WEEKLY", stageAfter: "MONTHLY" },
    { cardId: "d", rating: "REMEMBERED", stageBefore: "WEEKLY", stageAfter: "WEEKLY" }, // ôn thêm: không đổi
    { cardId: "e", rating: "NOT_YET", stageBefore: "QUARTERLY", stageAfter: "LEARNING" },
  ]);
  assert.equal(r.totals.promotedToWeekly, 2);
  assert.equal(r.totals.reviews, 5);
  assert.equal(r.totals.notYetRate, 1 / 5);
});

test("đầu vào rỗng: không chia cho 0, mọi mảng rỗng", () => {
  const r = run([]);
  assert.deepEqual(r, { totals: { reviews: 0, notYetRate: 0, promotedToWeekly: 0 }, byKind: [], byTopic: [], byLesson: [], hardestCards: [] });
});

test("nhóm không có thẻ nào thì không sinh ra; tỷ lệ luôn hữu hạn", () => {
  const r = run(many(10, { notYetCount: 1, topics: ["a"] }));
  for (const g of [...r.byKind, ...r.byTopic]) assert.ok(Number.isFinite(g.rate) && g.rate <= 1);
});

test("lessonLabel: dd/MM · khóa; không khóa → Ôn tập; buổi ôn thẻ → Ôn thẻ", () => {
  assert.equal(lessonLabel("2026-11-03", "Khóa A", "LESSON"), "03/11 \u00b7 Khóa A");
  assert.equal(lessonLabel("2026-11-03", null, "LESSON"), "03/11 \u00b7 Ôn tập");
  assert.equal(lessonLabel("2026-01-09", null, "CARD_REVIEW"), "09/01 \u00b7 Ôn thẻ");
});

test("periodStart: 7 ngày gần nhất tính cả hôm nay, theo 00:00 giờ VN", () => {
  assert.equal(periodStart("2026-11-06", 7).toISOString(), "2026-10-30T17:00:00.000Z"); // 31/10 00:00 VN (06/11 − 6 ngày)
  assert.equal(periodStart("2026-11-06", 30).toISOString(), "2026-10-07T17:00:00.000Z"); // 08/10 00:00 VN
  assert.equal(periodStart("2026-01-03", 7).toISOString(), "2025-12-27T17:00:00.000Z"); // qua ranh giới năm
});

test("countTopics: mỗi thẻ một lần cho mỗi chủ đề, nhiều thẻ trước rồi theo chữ cái", () => {
  const r = countTopics([{ topics: ["travel", "work"] }, { topics: ["work", "work"] }, { topics: ["beta"] }, { topics: ["alpha"] }, { topics: [] }]);
  assert.deepEqual(r, [{ topic: "work", cards: 2 }, { topic: "alpha", cards: 1 }, { topic: "beta", cards: 1 }, { topic: "travel", cards: 1 }]);
  assert.deepEqual(countTopics([]), []);
});
