import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { keyResults, projects, tasks } from "@/db/schema";
import { krProgress } from "@/lib/kr-progress";

type KeyResultRow = typeof keyResults.$inferSelect;
export type KeyResultView = KeyResultRow & { linkedTotal: number; linkedDone: number; progress: number };

/** Dự án STANDARD [projectId] của [userId]; null nếu không thấy, không phải của user hoặc khác type. */
export async function findOwnedStandardProject(projectId: string, userId: string) {
  const row = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId), eq(projects.type, "STANDARD")),
  });
  return row ?? null;
}

/** Gắn linkedTotal / linkedDone / progress vào các KR (1 truy vấn đếm việc cho cả nhóm). */
export async function withKrStats(rows: KeyResultRow[]): Promise<KeyResultView[]> {
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      krId: tasks.krId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${tasks.status} = 'DONE'))::int`,
    })
    .from(tasks)
    .where(
      inArray(
        tasks.krId,
        rows.map((r) => r.id)
      )
    )
    .groupBy(tasks.krId);
  const byKr = new Map(counts.map((c) => [c.krId, c]));
  return rows.map((r) => {
    const c = byKr.get(r.id);
    const linkedTotal = c?.total ?? 0;
    const linkedDone = c?.done ?? 0;
    return { ...r, linkedTotal, linkedDone, progress: krProgress(r, linkedTotal, linkedDone) };
  });
}

/** Danh sách KR của dự án, cũ → mới, kèm số liệu. */
export async function listKeyResults(projectId: string): Promise<KeyResultView[]> {
  const rows = await db.query.keyResults.findMany({
    where: eq(keyResults.projectId, projectId),
    orderBy: [asc(keyResults.createdAt), asc(keyResults.id)],
  });
  return withKrStats(rows);
}
