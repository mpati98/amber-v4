import { NextResponse } from "next/server";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { studyCards, studyCourses, studyDayReasons, studyLogs, studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { courseViews } from "@/lib/study-courses";
import { dayTotals, subjectStudyStats } from "@/lib/study-days";
import { buildOverview, weekBounds, type ActivityKey } from "@/lib/study-overview";
import { loadDays } from "@/lib/study-card-plan";
import { nextReviewDay, vnToday } from "@/lib/vn-time";

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
  const todayActivity = ids.length
    ? await db
        .select({ subjectId: studyLogs.subjectId, activity: studyLogs.activity, minutes: sql<number>`sum(${studyLogs.minutes})::int` })
        .from(studyLogs)
        .where(and(inArray(studyLogs.subjectId, ids), eq(studyLogs.logDate, today)))
        .groupBy(studyLogs.subjectId, studyLogs.activity)
    : [];
  const todayByActivity = new Map<string, Partial<Record<ActivityKey, number>>>();
  for (const r of todayActivity) todayByActivity.set(r.subjectId, { ...todayByActivity.get(r.subjectId), [r.activity]: r.minutes });
  const stats = await subjectStudyStats(db, userId, subjects, today);
  const cardTotals = ids.length
    ? await db
        .select({ subjectId: studyCards.subjectId, n: count() })
        .from(studyCards)
        .where(and(inArray(studyCards.subjectId, ids), eq(studyCards.userId, userId), eq(studyCards.suspended, false)))
        .groupBy(studyCards.subjectId)
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

  const overview = buildOverview({
    today,
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, dailyGoalMinutes: s.dailyGoalMinutes })),
    totals,
    todayLogCounts: new Map(todayCounts.map((r) => [r.subjectId, r.n])),
    todayReasons: new Map(todayReasons.map((r) => [r.subjectId, { code: r.code, text: r.text }])),
    coursesBySubject,
    todayByActivity,
    streaks: new Map([...stats].map(([id, v]) => [id, v.streak])),
    pendingReasonDates: new Map([...stats].map(([id, v]) => [id, v.pendingReasonDates])),
  });

  // Khối thẻ từ vựng: chỉ đọc, KHÔNG tạo kế hoạch — môn chưa mở hàng ôn hôm nay thì planned = finished = 0.
  const days = await loadDays(db, userId, ids, today, new Date());
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const totalBySubject = new Map(cardTotals.map((r) => [r.subjectId, r.n]));
  return NextResponse.json({
    ...overview,
    subjects: overview.subjects.map((o) => {
      const s = subjectById.get(o.subjectId)!;
      const { planned, finished } = days.get(s.id)!.summary.progress;
      return { ...o, cards: { planned, finished, total: totalBySubject.get(s.id) ?? 0, quota: s.cardDailyQuota, nextReviewDay: nextReviewDay(today, s.reviewWeekdays) } };
    }),
  });
});
