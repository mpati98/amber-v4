import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { studyCardReviews, studyCards, studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest, invalidBody, readJson } from "@/lib/study-input";
import { guardStudy, isUuid, StudyError } from "@/lib/study-courses";
import { isExtraReview } from "@/lib/study-card-day";
import { dayProgress, loadDays, queueCard } from "@/lib/study-card-plan";
import { scheduleCard } from "@/lib/study-card-schedule";
import { vnToday } from "@/lib/vn-time";

type RouteParams = { params: Promise<{ id: string }> };
const bodySchema = z.object({ rating: z.enum(["NOT_YET", "REVIEW_AGAIN", "REMEMBERED"]) });

// Ghi một lượt ôn thẻ. Khoá dòng thẻ (FOR UPDATE) nên bấm đúp / hai yêu cầu song song chỉ áp dụng một lần:
// yêu cầu sau đọc lại trạng thái mới và nhận 409.
export const POST = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { rating } = parsed.data;

  return guardStudy(async () => {
    const today = vnToday();
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      if (!isUuid(id)) throw new StudyError("card_not_found", 404);
      const [card] = await tx
        .select()
        .from(studyCards)
        .where(and(eq(studyCards.id, id), eq(studyCards.userId, userId)))
        .for("update");
      if (!card) throw new StudyError("card_not_found", 404);
      if (card.suspended) throw new StudyError("card_suspended", 409);
      const [subject] = await tx.select().from(studySubjects).where(eq(studySubjects.id, card.subjectId));

      const before = (await loadDays(tx, userId, [card.subjectId], today, now)).get(card.subjectId)!;
      const entry = before.entries.get(card.id);
      if (!entry) throw new StudyError("not_in_today_plan", 409);
      const status = before.summary.statuses.get(card.id);
      if (status === "FINISHED") throw new StudyError("already_finished_today", 409);
      if (status === "RETURNING_WAIT") throw new StudyError("not_due_yet", 409);

      const next = scheduleCard({
        stage: card.stage,
        dueAt: card.dueAt,
        rating,
        now,
        reviewWeekdays: subject.reviewWeekdays,
        isExtra: isExtraReview(entry.bucket, before.summary.reviewedToday.has(card.id)),
      });
      const [updated] = await tx
        .update(studyCards)
        .set({
          stage: next.stage,
          dueAt: next.dueAt,
          reviewCount: sql`${studyCards.reviewCount} + 1`,
          notYetCount: rating === "NOT_YET" ? sql`${studyCards.notYetCount} + 1` : card.notYetCount,
          lastReviewedAt: now,
        })
        .where(eq(studyCards.id, card.id))
        .returning();
      await tx.insert(studyCardReviews).values({
        userId,
        cardId: card.id,
        reviewedAt: now,
        rating,
        bucket: entry.bucket,
        stageBefore: card.stage,
        stageAfter: next.stage,
        dueAfter: next.dueAt,
      });

      const after = (await loadDays(tx, userId, [card.subjectId], today, now)).get(card.subjectId)!;
      return {
        card: queueCard(updated, entry.bucket, false, now, subject.reviewWeekdays),
        ...dayProgress(after.summary),
      };
    });
    return NextResponse.json(result, { status: 201 });
  });
});
