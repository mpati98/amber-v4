import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { invalidBody } from "@/lib/study-input";
import { guardStudy, StudyError, isUuid } from "@/lib/study-courses";
import { isExtraReview } from "@/lib/study-card-day";
import { cardCounts } from "@/lib/study-cards";
import { dayProgress, ensureDayPlan, loadDays, queueCard } from "@/lib/study-card-plan";
import { vnToday } from "@/lib/vn-time";
import { z } from "zod";

// Hàng ôn hôm nay: tạo kế hoạch lần đầu trong ngày (hoặc bù thêm nếu còn chỗ), rồi trả các thẻ cần ôn ngay.
// Gọi lại không đổi kế hoạch đã có ngoài việc bù thêm.
export const GET = withAuth(async (req, userId) => {
  const parsed = z.object({ subjectId: z.string() }).safeParse({ subjectId: req.nextUrl.searchParams.get("subjectId") ?? undefined });
  if (!parsed.success) return invalidBody(parsed.error);
  const subjectId = parsed.data.subjectId;

  return guardStudy(async () => {
    const today = vnToday();
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      if (!isUuid(subjectId)) throw new StudyError("subject_not_found", 404);
      // Khoá dòng môn: hai yêu cầu đầu ngày song song xếp hàng, người sau thấy kế hoạch người trước đã lưu.
      const [subject] = await tx.select().from(studySubjects).where(eq(studySubjects.id, subjectId)).for("no key update");
      if (!subject || subject.userId !== userId) throw new StudyError("subject_not_found", 404);

      await ensureDayPlan(tx, userId, subject, today, now);
      const day = (await loadDays(tx, userId, [subject.id], today, now)).get(subject.id)!;
      return {
        date: today,
        quota: subject.cardDailyQuota,
        cards: day.summary.queue.map((id) => {
          const e = day.entries.get(id)!;
          return queueCard(e.card, e.bucket, isExtraReview(e.bucket, day.summary.reviewedToday.has(id)), now, subject.reviewWeekdays);
        }),
        ...dayProgress(day.summary),
        counts: await cardCounts(tx, userId, subject.id),
      };
    });
    return NextResponse.json(result);
  });
});
