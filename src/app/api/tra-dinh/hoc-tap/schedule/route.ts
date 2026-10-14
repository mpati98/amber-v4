import { NextResponse } from "next/server";
import { and, between, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyDayReasons, studyLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { dateString } from "@/lib/project-input";
import { badRequest } from "@/lib/study-input";
import { courseViews, findOwnedSubject, forecastSubject, isUuid } from "@/lib/study-courses";
import { dayTotals } from "@/lib/study-days";
import { logViews } from "@/lib/study-logs";
import { dayDiff } from "@/lib/study-overview";
import { buildSchedule, needsForecast } from "@/lib/study-schedule";
import { vnToday } from "@/lib/vn-time";

const MAX_RANGE_DAYS = 62;

// Lịch một môn: quá khứ/hôm nay (đã học, lý do) + kế hoạch dự báo. Chỉ đọc.
export const GET = withAuth(async (req, userId) => {
  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subjectId");
  if (!subjectId || !isUuid(subjectId)) return badRequest("subject_required");
  const from = dateString.safeParse(sp.get("from"));
  const to = dateString.safeParse(sp.get("to"));
  if (!from.success || !to.success) return badRequest("invalid_date");
  if (to.data < from.data) return badRequest("invalid_range");
  if (dayDiff(from.data, to.data) + 1 > MAX_RANGE_DAYS) return badRequest("range_too_large");

  const subject = await findOwnedSubject(db, subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  const today = vnToday();
  const totals = (await dayTotals(db, [subject.id], from.data, to.data)).get(subject.id) ?? new Map<string, number>();
  const logRows = await db
    .select({ id: studyLogs.id })
    .from(studyLogs)
    .where(and(eq(studyLogs.subjectId, subject.id), between(studyLogs.logDate, from.data, to.data)));
  const logs = await logViews(db, logRows.map((r) => r.id));
  const reasonRows = await db
    .select({ d: studyDayReasons.reasonDate, code: studyDayReasons.code, text: studyDayReasons.text })
    .from(studyDayReasons)
    .where(and(eq(studyDayReasons.subjectId, subject.id), between(studyDayReasons.reasonDate, from.data, to.data)));

  const courseRows = await db.select().from(studyCourses).where(eq(studyCourses.subjectId, subject.id));
  const views = await courseViews(db, userId, courseRows);
  // Khoảng nằm hoàn toàn trong quá khứ thì không chạy forecast; forecast luôn bắt đầu từ hôm nay.
  const forecastDays = needsForecast(today, to.data) ? (await forecastSubject(db, subject)).days : [];

  return NextResponse.json(
    buildSchedule({
      today,
      from: from.data,
      to: to.data,
      goalMinutes: subject.dailyGoalMinutes,
      reviewWeekdays: subject.reviewWeekdays,
      totals,
      reasons: new Map(reasonRows.map((r) => [r.d, { code: r.code, text: r.text }])),
      logs,
      courses: views.map((v) => ({
        id: v.id,
        title: v.title,
        status: v.status,
        baselineFinishDate: v.baselineFinishDate,
        forecastFinishDate: v.forecastFinishDate,
        deltaDays: v.deltaDays,
        finishedDate: v.status === "DONE" ? v.forecastFinishDate : null,
      })),
      forecastDays,
    })
  );
});
