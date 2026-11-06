// Thống kê nhóm khó của thẻ từ vựng (mục 7 của kế hoạch). Hàm thuần — test ở study-card-insights.test.ts.

/** Nhóm chỉ hiện khi có ít nhất chừng này thẻ từng bị Chưa nhớ. */
export const HARD_GROUP_MIN_CARDS = 10;
/** Thẻ hay quên: từ chừng này lượt Chưa nhớ. */
export const HARDEST_CARD_MIN_NOT_YET = 3;
export const HARDEST_CARDS_LIMIT = 10;

export type InsightCard = { id: string; kind: string; topics: readonly string[]; sourceLogId: string | null; notYetCount: number; reviewCount: number };
export type InsightReview = { cardId: string; rating: string; stageBefore: string; stageAfter: string };

/** rate = thẻ từng Chưa nhớ / tổng thẻ của nhóm. */
export type InsightGroup = { key: string; label: string; totalCards: number; everNotYetCards: number; rate: number };
export type InsightResult = {
  totals: { reviews: number; notYetRate: number; promotedToWeekly: number };
  byKind: InsightGroup[];
  byTopic: InsightGroup[];
  byLesson: InsightGroup[];
  hardestCards: { cardId: string; notYetCount: number; reviewCount: number }[];
};

const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);

/** Gom thẻ theo khoá (một thẻ có thể thuộc nhiều nhóm); chỉ giữ nhóm đủ ngưỡng, xếp tỷ lệ giảm dần rồi số thẻ giảm dần. */
function hardGroups(cards: readonly InsightCard[], keysOf: (c: InsightCard) => readonly string[], labelOf: (key: string) => string): InsightGroup[] {
  const groups = new Map<string, { total: number; ever: number }>();
  for (const c of cards) {
    for (const key of new Set(keysOf(c))) {
      const g = groups.get(key) ?? { total: 0, ever: 0 };
      g.total++;
      if (c.notYetCount >= 1) g.ever++;
      groups.set(key, g);
    }
  }
  return [...groups]
    .filter(([, g]) => g.ever >= HARD_GROUP_MIN_CARDS)
    .map(([key, g]) => ({ key, label: labelOf(key), totalCards: g.total, everNotYetCards: g.ever, rate: ratio(g.ever, g.total) }))
    .sort((a, b) => b.rate - a.rate || b.everNotYetCards - a.everNotYetCards || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export function buildInsights(input: { cards: readonly InsightCard[]; reviews: readonly InsightReview[]; lessonLabels: ReadonlyMap<string, string> }): InsightResult {
  const { cards, reviews, lessonLabels } = input;
  const notYetReviews = reviews.filter((r) => r.rating === "NOT_YET").length;
  const promotedToWeekly = reviews.filter((r) => r.stageAfter === "WEEKLY" && r.stageBefore !== "WEEKLY").length;

  return {
    totals: { reviews: reviews.length, notYetRate: ratio(notYetReviews, reviews.length), promotedToWeekly },
    byKind: hardGroups(cards, (c) => [c.kind], (k) => k),
    byTopic: hardGroups(cards, (c) => c.topics, (t) => t),
    byLesson: hardGroups(cards, (c) => (c.sourceLogId ? [c.sourceLogId] : []), (id) => lessonLabels.get(id) ?? id),
    hardestCards: cards
      .filter((c) => c.notYetCount >= HARDEST_CARD_MIN_NOT_YET)
      .sort((a, b) => b.notYetCount - a.notYetCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, HARDEST_CARDS_LIMIT)
      .map((c) => ({ cardId: c.id, notYetCount: c.notYetCount, reviewCount: c.reviewCount })),
  };
}
