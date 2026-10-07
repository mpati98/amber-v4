import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { financeTransactions, keyResults, projects, tasks } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { withKrStats } from "@/lib/key-results";
import { taskAttention } from "@/lib/task-attention";
import { vnToday } from "@/lib/vn-time";

// Dữ liệu màn Tổng quan: mọi dự án STANDARD kèm số liệu + danh sách việc cần chú ý.
// Gom bằng 4 truy vấn (dự án, KR, việc, thu-chi) — không truy vấn theo từng dự án.
export const GET = withAuth(async (_req, userId) => {
  const today = vnToday();

  const projectRows = await db.query.projects.findMany({
    where: and(eq(projects.userId, userId), eq(projects.type, "STANDARD")),
    orderBy: [desc(projects.createdAt), desc(projects.id)],
  });
  if (projectRows.length === 0) return NextResponse.json({ projects: [], attention: [] });
  const ids = projectRows.map((p) => p.id);

  const krRows = await db.query.keyResults.findMany({ where: inArray(keyResults.projectId, ids) });
  const krViews = await withKrStats(krRows);
  const krByProject = new Map<string, number[]>();
  for (const k of krViews) krByProject.set(k.projectId, [...(krByProject.get(k.projectId) ?? []), k.progress]);

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      projectId: tasks.projectId,
      dueDate: tasks.dueDate,
      statusChangedAt: tasks.statusChangedAt,
      isMilestone: tasks.isMilestone,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), inArray(tasks.projectId, ids)));

  // Tổng thu / chi theo dự án (numeric → chuỗi "123.00" như các API finance).
  const moneyRows = await db
    .select({
      projectId: financeTransactions.linkedProjectId,
      income: sql<string>`coalesce(sum(${financeTransactions.amount}) filter (where ${financeTransactions.kind} = 'INCOME'), 0)::numeric(14,2)::text`,
      expense: sql<string>`coalesce(sum(${financeTransactions.amount}) filter (where ${financeTransactions.kind} = 'EXPENSE'), 0)::numeric(14,2)::text`,
      net: sql<string>`(coalesce(sum(${financeTransactions.amount}) filter (where ${financeTransactions.kind} = 'INCOME'), 0) - coalesce(sum(${financeTransactions.amount}) filter (where ${financeTransactions.kind} = 'EXPENSE'), 0))::numeric(14,2)::text`,
    })
    .from(financeTransactions)
    .where(and(eq(financeTransactions.userId, userId), inArray(financeTransactions.linkedProjectId, ids)))
    .groupBy(financeTransactions.linkedProjectId);
  const moneyByProject = new Map(moneyRows.map((m) => [m.projectId, m]));

  const tasksByProject = new Map<string, typeof taskRows>();
  for (const t of taskRows) {
    if (t.projectId) tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t]);
  }

  const attention: { taskId: string; title: string; status: string; projectId: string; projectName: string; kind: "OVERDUE" | "IDLE"; days: number }[] = [];

  const projectViews = projectRows.map((p) => {
    const ts = tasksByProject.get(p.id) ?? [];
    let attentionCount = 0;
    for (const t of ts) {
      const a = taskAttention(t, today);
      if (!a) continue;
      attentionCount++;
      if (p.status === "ACTIVE") {
        attention.push({ taskId: t.id, title: t.title, status: t.status, projectId: p.id, projectName: p.name, kind: a.kind, days: a.days });
      }
    }
    const milestone = ts
      .filter((t) => t.isMilestone && t.status !== "DONE" && t.dueDate)
      .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string))[0];
    const progresses = krByProject.get(p.id);
    const money = moneyByProject.get(p.id);
    return {
      id: p.id,
      name: p.name,
      goal: p.goal,
      color: p.color,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      closedAt: p.closedAt,
      krProgress: progresses && progresses.length > 0 ? progresses.reduce((a, b) => a + b, 0) / progresses.length : null,
      taskTotal: ts.length,
      taskDone: ts.filter((t) => t.status === "DONE").length,
      taskDoing: ts.filter((t) => t.status === "IN_PROGRESS").length,
      attentionCount,
      nextMilestone: milestone ? { id: milestone.id, title: milestone.title, dueDate: milestone.dueDate } : null,
      finance: { income: money?.income ?? "0.00", expense: money?.expense ?? "0.00", net: money?.net ?? "0.00" },
    };
  });

  // OVERDUE trước IDLE, trong mỗi nhóm số ngày giảm dần.
  attention.sort((a, b) => (a.kind === b.kind ? b.days - a.days : a.kind === "OVERDUE" ? -1 : 1));

  return NextResponse.json({ projects: projectViews, attention });
});
