import { and, between, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { routines, studyDayReasons, studyLogs, studySubjects } from "@/db/schema";
import { addDaysIso } from "@/lib/deadline-alert";
import { routineStats, STREAK_LOOKBACK_DAYS } from "@/lib/routine-stats";
import { computePendingReasonDates, PENDING_REASON_LOOKBACK_DAYS } from "@/lib/study-pending";
import { vnToday } from "@/lib/vn-time";

// Tổng phút học theo ngày + ngày còn thiếu lý do. Phần tính thuần tách riêng để test không cần DB.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;
type SubjectRow = typeof studySubjects.$inferSelect;
type RoutineRow = typeof routines.$inferSelect;

/** Tổng phút theo môn → ngày, trong [from, to] (gồm cả hai đầu), một truy vấn GROUP BY. */
export async function dayTotals(dbx: DbLike, subjectIds: string[], from: string, to: string): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (subjectIds.length === 0) return result;
  const rows = await dbx
    .select({ subjectId: studyLogs.subjectId, logDate: studyLogs.logDate, total: sql<number>`sum(${studyLogs.minutes})::int` })
    .from(studyLogs)
    .where(and(inArray(studyLogs.subjectId, subjectIds), between(studyLogs.logDate, from, to)))
    .groupBy(studyLogs.subjectId, studyLogs.logDate);
  for (const r of rows) {
    const byDate = result.get(r.subjectId) ?? new Map<string, number>();
    byDate.set(r.logDate, r.total);
    result.set(r.subjectId, byDate);
  }
  return result;
}

/** Ngày thiếu lý do của một routine STUDY (hôm nay theo giờ VN). */
export async function pendingReasonDates(dbx: DbLike, subject: SubjectRow, routine: RoutineRow, today = vnToday()): Promise<string[]> {
  const from = addDaysIso(today, -PENDING_REASON_LOOKBACK_DAYS);
  const totals = (await dayTotals(dbx, [subject.id], from, today)).get(subject.id) ?? new Map<string, number>();
  const reasons = await dbx
    .select({ d: studyDayReasons.reasonDate })
    .from(studyDayReasons)
    .where(and(eq(studyDayReasons.subjectId, subject.id), between(studyDayReasons.reasonDate, from, today)));
  return computePendingReasonDates({
    today,
    createdDate: vnToday(routine.createdAt),
    weekdays: routine.weekdays,
    goalMinutes: subject.dailyGoalMinutes,
    totals,
    reasonDates: new Set(reasons.map((r) => r.d)),
  });
}

/** Tổng phút của môn trong một ngày. */
export async function dayTotal(dbx: DbLike, subjectId: string, date: string): Promise<number> {
  return (await dayTotals(dbx, [subjectId], date, date)).get(subjectId)?.get(date) ?? 0;
}

export type StudyRoutineExtras = {
  doneDates: string[];
  studySubjectId: string | null;
  studySubjectName: string | null;
  todayMinutes: number;
  goalMinutes: number | null;
  pendingReasonDates: string[];
};

/**
 * Số liệu cho nhiều routine STUDY quanh ngày tham chiếu [ref]: gọi dayTotals một lần cho cả cửa sổ streak
 * ([ref − lookbackDays, ref]); doneDates = ngày tổng phút ≥ mục tiêu của môn.
 */
export async function studyRoutineExtras(dbx: DbLike, rows: RoutineRow[], ref: string, lookbackDays: number): Promise<Map<string, StudyRoutineExtras>> {
  const out = new Map<string, StudyRoutineExtras>();
  if (rows.length === 0) return out;
  const subjectIds = [...new Set(rows.flatMap((r) => (r.studySubjectId ? [r.studySubjectId] : [])))];
  const subjects = subjectIds.length ? await dbx.select().from(studySubjects).where(inArray(studySubjects.id, subjectIds)) : [];
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const from = addDaysIso(ref, -lookbackDays);
  const totals = await dayTotals(dbx, subjectIds, from, ref);
  const reasonRows = subjectIds.length
    ? await dbx
        .select({ subjectId: studyDayReasons.subjectId, d: studyDayReasons.reasonDate })
        .from(studyDayReasons)
        .where(and(inArray(studyDayReasons.subjectId, subjectIds), between(studyDayReasons.reasonDate, from, ref)))
    : [];
  const reasonsBySubject = new Map<string, Set<string>>();
  for (const r of reasonRows) reasonsBySubject.set(r.subjectId, (reasonsBySubject.get(r.subjectId) ?? new Set()).add(r.d));

  for (const r of rows) {
    const subject = r.studySubjectId ? subjectById.get(r.studySubjectId) : undefined;
    const byDate = (subject && totals.get(subject.id)) || new Map<string, number>();
    const goal = subject?.dailyGoalMinutes ?? null;
    out.set(r.id, {
      doneDates: goal === null ? [] : [...byDate].filter(([, minutes]) => minutes >= goal).map(([d]) => d),
      studySubjectId: r.studySubjectId,
      studySubjectName: subject?.name ?? null,
      todayMinutes: byDate.get(ref) ?? 0,
      goalMinutes: goal,
      pendingReasonDates: subject
        ? computePendingReasonDates({
            today: ref,
            createdDate: vnToday(r.createdAt),
            weekdays: r.weekdays,
            goalMinutes: goal,
            totals: byDate,
            reasonDates: reasonsBySubject.get(subject.id) ?? new Set(),
          })
        : [],
    });
  }
  return out;
}

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Chuỗi ngày + ngày thiếu lý do THEO MÔN, tính đúng như thẻ routine STUDY (cùng `studyRoutineExtras` và `routineStats`).
 * Môn có routine STUDY (chưa lưu trữ) thì dùng routine đó (thứ đến hạn, ngày tạo); môn chưa có thì coi như routine
 * ảo mọi ngày trong tuần, tính từ ngày tạo môn.
 */
export async function subjectStudyStats(dbx: DbLike, userId: string, subjects: SubjectRow[], ref: string): Promise<Map<string, { streak: number; pendingReasonDates: string[] }>> {
  const out = new Map<string, { streak: number; pendingReasonDates: string[] }>();
  if (subjects.length === 0) return out;
  const real = await dbx
    .select()
    .from(routines)
    .where(and(eq(routines.userId, userId), eq(routines.kind, "STUDY"), isNull(routines.archivedAt), inArray(routines.studySubjectId, subjects.map((s) => s.id))));
  const realBySubject = new Map(real.flatMap((r) => (r.studySubjectId ? [[r.studySubjectId, r] as const] : [])));
  // Khoá routine ảo = id môn (id routine thật là uuid khác nên không đụng nhau).
  const rows: RoutineRow[] = subjects.map((s) => realBySubject.get(s.id) ?? ({ id: s.id, studySubjectId: s.id, weekdays: ALL_WEEKDAYS, createdAt: s.createdAt } as RoutineRow));
  const extras = await studyRoutineExtras(dbx, rows, ref, STREAK_LOOKBACK_DAYS);
  for (const [i, s] of subjects.entries()) {
    const extra = extras.get(rows[i].id)!;
    out.set(s.id, { streak: routineStats(rows[i].weekdays, extra.doneDates, ref).streak, pendingReasonDates: extra.pendingReasonDates });
  }
  return out;
}
