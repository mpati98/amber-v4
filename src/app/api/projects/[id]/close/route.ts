import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { documents, financeTransactions, projects, tasks } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { findOwnedStandardProject, listKeyResults } from "@/lib/key-results";
import { buildProjectSummaryDoc } from "@/lib/project-summary-doc";
import { stringifyTags } from "@/lib/tags";

const closeSchema = z.object({ note: z.string().max(5000).optional() });

type RouteParams = { params: Promise<{ id: string }> };

// Đóng dự án: status DONE + closedAt, đồng thời lưu 1 tài liệu tổng kết vào Tàng Kinh Các (cùng transaction).
export const POST = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const project = z.string().uuid().safeParse(id).success ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

  // Body có thể rỗng.
  const body = await req.json().catch(() => ({}));
  const parsed = closeSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (project.status === "DONE") {
    return NextResponse.json({ error: "project_already_done" }, { status: 400 });
  }

  const closedAt = new Date();
  const [keyResults, projectTasks, [money]] = await Promise.all([
    listKeyResults(project.id),
    db.query.tasks.findMany({
      where: and(eq(tasks.projectId, project.id), eq(tasks.userId, userId)),
      columns: { title: true, status: true, statusChangedAt: true },
    }),
    db
      .select({
        income: sql<string>`coalesce(sum(${financeTransactions.amount}) filter (where ${financeTransactions.kind} = 'INCOME'), 0)::text`,
        expense: sql<string>`coalesce(sum(${financeTransactions.amount}) filter (where ${financeTransactions.kind} = 'EXPENSE'), 0)::text`,
      })
      .from(financeTransactions)
      .where(and(eq(financeTransactions.linkedProjectId, project.id), eq(financeTransactions.userId, userId))),
  ]);

  const doc = buildProjectSummaryDoc({
    project,
    keyResults,
    tasks: projectTasks,
    finance: { income: Number(money.income), expense: Number(money.expense) },
    note: parsed.data.note,
    closedAt,
  });

  const { updated, documentId } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set({ status: "DONE", closedAt })
      .where(eq(projects.id, project.id))
      .returning();
    // Tạo tài liệu theo đúng cách route tang-kinh-cac/documents: id UUID, tags JSON, updatedAt phải gán tay.
    const documentId = randomUUID();
    const now = closedAt.toISOString();
    await tx.insert(documents).values({
      id: documentId,
      title: doc.title,
      type: "TEXT",
      content: doc.content,
      attachmentUrl: null,
      tags: stringifyTags(["du-an", "tong-ket"]),
      pinned: false,
      sourceUrl: null,
      topicId: null,
      createdAt: now,
      updatedAt: now,
    });
    return { updated, documentId };
  });

  await logActivity({
    userId,
    source: "DU_AN",
    action: "project.closed",
    title: updated.name,
    metadata: { documentId },
  });
  return NextResponse.json({ project: updated, documentId });
});
