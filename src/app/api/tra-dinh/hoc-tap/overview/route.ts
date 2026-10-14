import { NextResponse } from "next/server";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyDayReasons, studyLogs, studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { courseViews } from "@/lib/study-courses";
import { dayTotals } from "@/lib/study-days";
import { buildOverview, weekBounds } from "@/lib/study-overview";
import { vnToday } from "@/lib/vn-time";

// Tổng quan Học tập: mục tiêu tuần + từng môn (hôm nay, phần kế tiếp, khóa đang học). Chỉ đọc.
export const GET = withAuth(async (_req, userId) => {
  const today = vnToday();
  const { start, end } = weekBounds(today);

  const subjects = await db
    .select()
    .from(studySubjects)
    .where(eq(studySubjects.userId, userId))
    .orderBy(asc(studySubjects.position), asc(studySubjects.createdAt), asc(studySubjects.id));
  const ids = subjects.map((s) => s.id);

  const totals = await dayTotals(db, ids, start, end);
  const todayCounts = ids.length
    ? await db
        .select({ subjectId: studyLogs.subjectId, n: count() })
        .from(studyLogs)
        .where(and(inArray(studyLogs.subjectId, ids), eq(studyLogs.logDate, today)))
        .groupBy(studyLogs.subjectId)
    : [];
  const todayReasons = ids.length
    ? await db
        .select({ subjectId: studyDayReasons.subjectId, code: studyDayReasons.code, text: studyDayReasons.text })
        .from(studyDayReasons)
        .where(and(inArray(studyDayReasons.subjectId, ids), eq(studyDayReasons.reasonDate, today)))
    : [];

  const courses = ids.length ? await db.select().from(studyCourses).where(and(eq(studyCourses.userId, userId), inArray(studyCourses.subjectId, ids))) : [];
  const views = await courseViews(db, userId, courses);
  const coursesBySubject = new Map<string, typeof views>();
  for (const v of views) coursesBySubject.set(v.subjectId, [...(coursesBySubject.get(v.subjectId) ?? []), v]);

  return NextResponse.json(
    buildOverview({
      today,
      subjects: subjects.map((s) => ({ id: s.id, name: s.name, dailyGoalMinutes: s.dailyGoalMinutes })),
      totals,
      todayLogCounts: new Map(todayCounts.map((r) => [r.subjectId, r.n])),
      todayReasons: new Map(todayReasons.map((r) => [r.subjectId, { code: r.code, text: r.text }])),
      coursesBySubject,
    })
  );
});

