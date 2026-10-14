import { and, asc, between, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { routineLogs, routines, workoutExercises } from "@/db/schema";
import { findOwnedSubject } from "@/lib/study-courses";
import { addDaysIso } from "@/lib/deadline-alert";
import { routineStats, STREAK_LOOKBACK_DAYS } from "@/lib/routine-stats";
import { studyRoutineExtras } from "@/lib/study-days";

type RoutineRow = typeof routines.$inferSelect;
type ExerciseRow = typeof workoutExercises.$inferSelect;

export type ExerciseView = {
  position: number;
  name: string;
  measure: ExerciseRow["measure"];
  sets: number | null;
  reps: number | null;
  durationSeconds: number | null;
};

/** Log của ngày tham chiếu: số phút (null với CHECK) + bài tập theo position. */
export type TodayLogView = { durationMinutes: number | null; exercises: ExerciseView[] };

export const toExerciseView = (e: ExerciseRow): ExerciseView => ({
  position: e.position,
  name: e.name,
  measure: e.measure,
  sets: e.sets,
  reps: e.reps,
  durationSeconds: e.durationSeconds,
});

type Extras = { todayLog: TodayLogView | null; lastWorkout?: ExerciseView[] | null };

/** Dạng routine API trả về, tính quanh ngày tham chiếu [ref]. */
export function toRoutineView(r: RoutineRow, doneDates: string[], ref: string, extras: Extras = { todayLog: null }) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    weekdays: [...r.weekdays].sort((a, b) => a - b),
    ...routineStats(r.weekdays, doneDates, ref),
    todayLog: extras.todayLog,
    // Chỉ routine WORKOUT có lastWorkout (null nếu chưa có buổi nào trước ngày tham chiếu).
    ...(r.kind === "WORKOUT" ? { lastWorkout: extras.lastWorkout ?? null } : {}),
  };
}

/** Bài tập của các log [logIds], gom theo log, đã sắp theo position. */
async function exercisesByLog(logIds: string[]) {
  const map = new Map<string, ExerciseView[]>();
  if (logIds.length === 0) return map;
  const rows = await db
    .select()
    .from(workoutExercises)
    .where(inArray(workoutExercises.routineLogId, logIds))
    .orderBy(asc(workoutExercises.position), asc(workoutExercises.id));
  for (const e of rows) map.set(e.routineLogId, [...(map.get(e.routineLogId) ?? []), toExerciseView(e)]);
  return map;
}

/**
 * Gắn thống kê cho nhiều routine. CHECK/WORKOUT: 1 truy vấn routine_logs (chỉ cửa sổ nhìn lùi cần cho streak).
 * STUDY không dùng routine_logs: tổng phút học theo ngày (study_logs) ≥ mục tiêu của môn mới tính là đã làm.
 */
export async function routineViews(rows: RoutineRow[], ref: string) {
  const studyRows = rows.filter((r) => r.kind === "STUDY");
  const study = await studyRoutineExtras(db, studyRows, ref, STREAK_LOOKBACK_DAYS);
  const plain = new Map((await logRoutineViews(rows.filter((r) => r.kind !== "STUDY"), ref)).map((v) => [v.id, v]));
  return rows.map((r) => {
    if (r.kind !== "STUDY") return plain.get(r.id)!;
    const { doneDates, ...extra } = study.get(r.id)!;
    return { ...toRoutineView(r, doneDates, ref), ...extra };
  });
}

async function logRoutineViews(rows: RoutineRow[], ref: string) {
  if (rows.length === 0) return [];
  const logs = await db
    .select({ id: routineLogs.id, routineId: routineLogs.routineId, logDate: routineLogs.logDate, durationMinutes: routineLogs.durationMinutes })
    .from(routineLogs)
    .where(
      and(
        inArray(
          routineLogs.routineId,
          rows.map((r) => r.id)
        ),
        between(routineLogs.logDate, addDaysIso(ref, -STREAK_LOOKBACK_DAYS), ref)
      )
    );
  const byRoutine = new Map<string, string[]>();
  for (const l of logs) byRoutine.set(l.routineId, [...(byRoutine.get(l.routineId) ?? []), l.logDate]);

  // Buổi gần nhất TRƯỚC ref của từng routine WORKOUT (có thể nằm ngoài cửa sổ streak → truy vấn riêng).
  const lastLogId = new Map<string, string>();
  for (const r of rows.filter((x) => x.kind === "WORKOUT")) {
    const [last] = await db
      .select({ id: routineLogs.id })
      .from(routineLogs)
      .where(and(eq(routineLogs.routineId, r.id), lt(routineLogs.logDate, ref)))
      .orderBy(desc(routineLogs.logDate))
      .limit(1);
    if (last) lastLogId.set(r.id, last.id);
  }

  const todayLogs = new Map(logs.filter((l) => l.logDate === ref).map((l) => [l.routineId, l]));
  const exercises = await exercisesByLog([...[...todayLogs.values()].map((l) => l.id), ...lastLogId.values()]);

  return rows.map((r) => {
    const t = todayLogs.get(r.id);
    const lastId = lastLogId.get(r.id);
    return toRoutineView(r, byRoutine.get(r.id) ?? [], ref, {
      todayLog: t ? { durationMinutes: t.durationMinutes, exercises: exercises.get(t.id) ?? [] } : null,
      lastWorkout: lastId ? (exercises.get(lastId) ?? []) : null,
    });
  });
}

/** Routine chưa archived của user, cũ → mới. */
export async function listRoutines(userId: string) {
  return db.query.routines.findMany({
    where: and(eq(routines.userId, userId), isNull(routines.archivedAt)),
    orderBy: [asc(routines.createdAt), asc(routines.id)],
  });
}

/** Routine [id] của user (chưa archived); null nếu id sai định dạng hoặc không phải của user. */
export async function findOwnedRoutine(id: string, userId: string): Promise<RoutineRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const row = await db.query.routines.findFirst({
    where: and(eq(routines.id, id), eq(routines.userId, userId), isNull(routines.archivedAt)),
  });
  return row ?? null;
}

/**
 * Kiểm tra môn học gắn vào routine STUDY: phải của user (404), có mục tiêu ngày (400 goal_missing), mỗi môn
 * tối đa 1 routine STUDY (409 study_routine_exists; [exceptRoutineId] bỏ qua chính routine đang sửa).
 * Trả response lỗi, hoặc null nếu hợp lệ.
 */
export async function checkStudySubject(subjectId: string, userId: string, exceptRoutineId?: string): Promise<NextResponse | null> {
  const subject = await findOwnedSubject(db, subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });
  if (subject.dailyGoalMinutes === null) return NextResponse.json({ error: "goal_missing" }, { status: 400 });
  const [existing] = await db
    .select({ id: routines.id })
    .from(routines)
    .where(
      and(
        eq(routines.studySubjectId, subject.id),
        eq(routines.kind, "STUDY"),
        isNull(routines.archivedAt),
        exceptRoutineId ? ne(routines.id, exceptRoutineId) : undefined
      )
    )
    .limit(1);
  if (existing) return NextResponse.json({ error: "study_routine_exists" }, { status: 409 });
  return null;
}
