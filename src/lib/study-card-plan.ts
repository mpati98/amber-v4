import { and, asc, count, eq, getTableColumns, gte, inArray, lt, sql } from "drizzle-orm";
import { studyCardDayPlanItems, studyCardReviews, studyCards, studySubjects } from "@/db/schema";
import { dayBounds, summarizeDay, type DaySummary } from "@/lib/study-card-day";
import { buildDayPlan, type CardBucket } from "@/lib/study-card-queue";
import { nextFor } from "@/lib/study-card-schedule";
import { cardView, type CardRow } from "@/lib/study-cards";
import type { DbLike } from "@/lib/study-courses";

// Phần dùng DB của kế hoạch thẻ trong ngày: tạo/bù kế hoạch, tải trạng thái hôm nay, dạng thẻ trong hàng ôn.

const REVIEW_WINDOW_MS = 30 * 86_400_000;
type SubjectRow = typeof studySubjects.$inferSelect;

/**
 * Tạo kế hoạch hôm nay (chưa có) hoặc bù thêm vào kế hoạch đã có, rồi lưu phần thêm vào study_card_day_plan_items.
 * Phải gọi trong transaction đã khoá dòng môn để hai lần gọi song song không tạo hai kế hoạch.
 */
export async function ensureDayPlan(tx: DbLike, userId: string, subject: SubjectRow, today: string, now: Date) {
  const cards = await tx.select().from(studyCards).where(and(eq(studyCards.userId, userId), eq(studyCards.subjectId, subject.id)));
  const reviewRows = await tx
    .select({ cardId: studyCardReviews.cardId, total: count(), notYet: sql<number>`(count(*) filter (where ${studyCardReviews.rating} = 'NOT_YET'))::int` })
    .from(studyCardReviews)
    .innerJoin(studyCards, eq(studyCards.id, studyCardReviews.cardId))
    .where(and(eq(studyCardReviews.userId, userId), eq(studyCards.subjectId, subject.id), gte(studyCardReviews.reviewedAt, new Date(now.getTime() - REVIEW_WINDOW_MS))))
    .groupBy(studyCardReviews.cardId);
  const existing = await tx
    .select({ cardId: studyCardDayPlanItems.cardId, bucket: studyCardDayPlanItems.bucket })
    .from(studyCardDayPlanItems)
    .where(and(eq(studyCardDayPlanItems.userId, userId), eq(studyCardDayPlanItems.subjectId, subject.id), eq(studyCardDayPlanItems.planDate, today)));

  const plan = buildDayPlan({
    today,
    quota: subject.cardDailyQuota,
    cards: cards.map((c) => ({ id: c.id, stage: c.stage, dueAt: c.dueAt, suspended: c.suspended, createdAt: c.createdAt, lastReviewedAt: c.lastReviewedAt })),
    notYetCounts: new Map(reviewRows.map((r) => [r.cardId, r.notYet])),
    reviewCounts: new Map(reviewRows.map((r) => [r.cardId, Number(r.total)])),
    existing,
    seed: `${subject.id}:${today}`,
  });
  if (plan.added.length > 0) {
    await tx
      .insert(studyCardDayPlanItems)
      .values(plan.added.map((i) => ({ userId, subjectId: subject.id, planDate: today, cardId: i.cardId, bucket: i.bucket })))
      .onConflictDoNothing({ target: [studyCardDayPlanItems.subjectId, studyCardDayPlanItems.planDate, studyCardDayPlanItems.cardId] });
  }
  return plan;
}

export type PlanEntry = { card: CardRow; bucket: CardBucket };
export type SubjectDay = { summary: DaySummary; entries: Map<string, PlanEntry> };

/** Chỉ đọc: kế hoạch hôm nay và trạng thái từng thẻ của các môn. Môn chưa có kế hoạch có planned = 0. */
export async function loadDays(dbx: DbLike, userId: string, subjectIds: string[], today: string, now: Date): Promise<Map<string, SubjectDay>> {
  const out = new Map<string, SubjectDay>();
  if (subjectIds.length === 0) return out;
  const rows = await dbx
    .select({ bucket: studyCardDayPlanItems.bucket, card: getTableColumns(studyCards) })
    .from(studyCardDayPlanItems)
    .innerJoin(studyCards, eq(studyCards.id, studyCardDayPlanItems.cardId))
    .where(and(eq(studyCardDayPlanItems.userId, userId), eq(studyCards.userId, userId), inArray(studyCardDayPlanItems.subjectId, subjectIds), eq(studyCardDayPlanItems.planDate, today)));
  const cardIds = rows.map((r) => r.card.id);
  const { start, end } = dayBounds(today);
  const reviews = cardIds.length
    ? await dbx
        .select({ cardId: studyCardReviews.cardId, rating: studyCardReviews.rating, reviewedAt: studyCardReviews.reviewedAt })
        .from(studyCardReviews)
        .where(and(eq(studyCardReviews.userId, userId), inArray(studyCardReviews.cardId, cardIds), gte(studyCardReviews.reviewedAt, start), lt(studyCardReviews.reviewedAt, end)))
        .orderBy(asc(studyCardReviews.reviewedAt), asc(studyCardReviews.id))
    : [];

  for (const subjectId of subjectIds) {
    const mine = rows.filter((r) => r.card.subjectId === subjectId);
    const ids = new Set(mine.map((r) => r.card.id));
    out.set(subjectId, {
      entries: new Map(mine.map((r) => [r.card.id, { card: r.card, bucket: r.bucket }])),
      summary: summarizeDay({
        today,
        now,
        plan: mine.map((r) => ({ cardId: r.card.id, bucket: r.bucket, suspended: r.card.suspended, dueAt: r.card.dueAt, createdAt: r.card.createdAt })),
        reviewsToday: reviews.filter((r) => ids.has(r.cardId)),
      }),
    });
  }
  return out;
}

/** Thẻ trong hàng ôn: các trường của thẻ + nhóm + kết quả nếu chọn từng mức (cho nhãn nút). */
export function queueCard(card: CardRow, bucket: CardBucket, isExtra: boolean, now: Date, reviewWeekdays: readonly number[]) {
  return { ...cardView(card), bucket, next: nextFor({ stage: card.stage, dueAt: card.dueAt }, now, reviewWeekdays, isExtra) };
}

/** Dạng progress + soonestDueAt trả về cho client. */
export function dayProgress(summary: DaySummary) {
  return { progress: summary.progress, soonestDueAt: summary.soonestDueAt };
}
