import { NextResponse } from "next/server";
import { and, between, eq, inArray, min } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyDayReasons, studyLogs, studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest } from "@/lib/study-input";
import { courseViews, findOwnedSubject, isUuid } from "@/lib/study-courses";
import { buildStats, progressPct, statsBounds, type StatsRange } from "@/lib/study-stats";
import { vnToday } from "@/lib/vn-time";

// Thống kê học tập theo khoảng (7 / 30 ngày / tất cả), tuỳ chọn theo một môn. Chỉ đọc.
export const GET = withAuth(async (req, userId) => {
  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subjectId");
  if (subjectId !== null && !isUuid(subjectId)) return badRequest("invalid_subject_id");
  const range = (sp.get("range") ?? "30") as StatsRange;
  if (!["7", "30", "all"].includes(range)) return badRequest("invalid_range");

  let subjects = await db.select().from(studySubjects).where(eq(studySubjects.userId, userId));
  if (subjectId) {
    const owned = await findOwnedSubject(db, subjectId, userId);
    if (!owned) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });
    subjects = [owned];
  }
  const ids = subjects.map((s) => s.id);
  const today = vnToday();

  const firstRows = ids.length
    ? await db.select({ subjectId: studyLogs.subjectId, first: min(studyLogs.logDate) }).from(studyLogs).where(inArray(studyLogs.subjectId, ids)).groupBy(studyLogs.subjectId)
    : [];
  const firstLogDates = new Map(firstRows.flatMap((r) => (r.first ? [[r.subjectId, r.first] as const] : [])));
  const { from, to } = statsBounds(today, range, firstLogDates.values());

  const logs = ids.length
    ? await db
        .select({ subjectId: studyLogs.subjectId, courseId: studyLogs.courseId, courseTitle: studyCourses.title, logDate: studyLogs.logDate, minutes: studyLogs.minutes })
        .from(studyLogs)
        .leftJoin(studyCourses, eq(studyCourses.id, studyLogs.courseId))
        .where(and(inArray(studyLogs.subjectId, ids), between(studyLogs.logDate, from, to)))
    : [];
  const reasons = ids.length
    ? await db
        .select({ subjectId: studyDayReasons.subjectId, date: studyDayReasons.reasonDate, code: studyDayReasons.code })
        .from(studyDayReasons)
        .where(and(inArray(studyDayReasons.subjectId, ids), between(studyDayReasons.reasonDate, from, to)))
    : [];

  const courseRows = ids.length ? await db.select().from(studyCourses).where(and(eq(studyCourses.userId, userId), inArray(studyCourses.subjectId, ids))) : [];
  const views = await courseViews(db, userId, courseRows);

  return NextResponse.json(
    buildStats({
      today,
      range,
      subjects: subjects.map((s) => ({ id: s.id, dailyGoalMinutes: s.dailyGoalMinutes })),
      logs,
      firstLogDates,
      reasons,
      courses: views.map((v) => ({
        id: v.id,
        subjectId: v.subjectId,
        title: v.title,
        status: v.status,
        queuePosition: v.queuePosition,
        progressPct: progressPct(v.status, v.progress),
        baselineFinishDate: v.baselineFinishDate,
        forecastFinishDate: v.forecastFinishDate,
        finishedDate: v.status === "DONE" ? v.forecastFinishDate : null,
        deltaDays: v.deltaDays,
      })),
    })
  );
});
