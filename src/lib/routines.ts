import { and, asc, between, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { routineLogs, routines } from "@/db/schema";
import { addDaysIso } from "@/lib/deadline-alert";
import { routineStats, STREAK_LOOKBACK_DAYS } from "@/lib/routine-stats";

type RoutineRow = typeof routines.$inferSelect;

/** Dạng routine API trả về, tính quanh ngày tham chiếu [ref]. */
export function toRoutineView(r: RoutineRow, doneDates: string[], ref: string) {
  return {
    id: r.id,
    name: r.name,
    weekdays: [...r.weekdays].sort((a, b) => a - b),
    ...routineStats(r.weekdays, doneDates, ref),
  };
}

/** Gắn thống kê cho nhiều routine bằng 1 truy vấn log (chỉ cửa sổ nhìn lùi cần cho streak). */
export async function routineViews(rows: RoutineRow[], ref: string) {
  if (rows.length === 0) return [];
  const logs = await db
    .select({ routineId: routineLogs.routineId, logDate: routineLogs.logDate })
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
  return rows.map((r) => toRoutineView(r, byRoutine.get(r.id) ?? [], ref));
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
