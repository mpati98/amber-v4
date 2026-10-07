import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "@/lib/activity-log";
import { userOwnsProject } from "@/lib/project-access";
import { dateString } from "@/lib/project-input";
import { krError, prepLeadDaysSchema, taskRuleError, TASK_STATUSES } from "@/lib/task-input";
import { getTaskView } from "@/lib/task-view";

const patchTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  projectId: z.string().uuid().nullable().optional(),
  krId: z.string().uuid().nullable().optional(),
  importance: z.number().int().min(1).max(3).optional(),
  urgency: z.number().int().min(1).max(3).optional(),
  startDate: dateString.nullable().optional(),
  dueDate: dateString.nullable().optional(),
  isMilestone: z.boolean().optional(),
  notifyDeadline: z.boolean().optional(),
  prepLeadDays: prepLeadDaysSchema.nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const body = await req.json();
  const parsed = patchTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 });
  }
  // Như POST: không cho chuyển task sang project của người khác (null = bỏ khỏi project, hợp lệ).
  if (parsed.data.projectId && !(await userOwnsProject(parsed.data.projectId, userId))) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }

  // Đọc bản hiện tại để gộp thay đổi rồi kiểm tra các quy tắc chéo trường.
  // id không phải uuid thì không thể là task nào (tránh DB ném 500).
  const existing = z.string().uuid().safeParse(id).success
    ? await db.query.tasks.findFirst({ where: and(eq(tasks.id, id), eq(tasks.userId, userId)) })
    : undefined;
  if (!existing) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const data = parsed.data;
  const projectId = data.projectId !== undefined ? data.projectId : existing.projectId;
  // Đổi project mà không gửi krId thì KR cũ (thuộc project cũ) không còn hợp lệ → gỡ.
  const krId = data.krId !== undefined ? data.krId : projectId !== existing.projectId ? null : existing.krId;

  const ruleError = taskRuleError({
    startDate: data.startDate !== undefined ? data.startDate : existing.startDate,
    dueDate: data.dueDate !== undefined ? data.dueDate : existing.dueDate,
    notifyDeadline: data.notifyDeadline ?? existing.notifyDeadline,
  });
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 });
  // Chỉ kiểm lại KR khi krId hoặc project thật sự đổi (KR cũ hợp lệ thì để yên).
  if (krId !== existing.krId || projectId !== existing.projectId) {
    const krProblem = await krError(krId, projectId);
    if (krProblem) return NextResponse.json({ error: krProblem }, { status: 400 });
  }

  const statusChanged = data.status !== undefined && data.status !== existing.status;

  // and(...) đảm bảo chỉ sửa được task của chính user đang đăng nhập, không đoán ID người khác được
  const [updated] = await db
    .update(tasks)
    .set({ ...data, krId, ...(statusChanged ? { statusChangedAt: new Date() } : {}) })
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  if (data.status === "DONE") {
    await logActivity({
      userId,
      source: "DU_AN",
      action: "task.completed",
      title: updated.title,
    });
  }

  return NextResponse.json(await getTaskView(updated.id));
});

export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const [deleted] = await db
    .delete(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
    .returning();
  if (!deleted) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
