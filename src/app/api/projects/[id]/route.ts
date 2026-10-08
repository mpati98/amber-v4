import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { findOwnedStandardProject, listKeyResults } from "@/lib/key-results";
import { dateString, endBeforeStart, PROJECT_STATUSES } from "@/lib/project-input";

const patchProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  goal: z.string().nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  startDate: dateString.nullable().optional(),
  endDate: dateString.nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "project_not_found" }, { status: 404 });
// id không phải uuid thì không thể là project nào — trả 404 thay vì để DB ném lỗi 500.
const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

export const GET = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const project = isUuid(id) ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return notFound();
  return NextResponse.json({ ...project, keyResults: await listKeyResults(project.id) });
});

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const project = isUuid(id) ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return notFound();

  const parsed = patchProjectSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 });
  }
  // Chuyển sang DONE phải qua POST /close (để lưu tài liệu tổng kết); mở lại (DONE → ACTIVE / PAUSED) vẫn PATCH được.
  if (parsed.data.status === "DONE" && project.status !== "DONE") {
    return NextResponse.json({ error: "use_close_endpoint" }, { status: 400 });
  }
  const startDate = parsed.data.startDate === undefined ? project.startDate : parsed.data.startDate;
  const endDate = parsed.data.endDate === undefined ? project.endDate : parsed.data.endDate;
  if (endBeforeStart(startDate, endDate)) {
    return NextResponse.json({ error: "end_before_start" }, { status: 400 });
  }

  const statusChanged = parsed.data.status !== undefined && parsed.data.status !== project.status;
  const closedAt = !statusChanged ? undefined : parsed.data.status === "DONE" ? new Date() : null;

  const [updated] = await db
    .update(projects)
    .set({ ...parsed.data, ...(closedAt !== undefined ? { closedAt } : {}) })
    .where(eq(projects.id, project.id))
    .returning();

  if (statusChanged) {
    await logActivity({
      userId,
      source: "DU_AN",
      action: "project.status_changed",
      title: updated.name,
      metadata: { from: project.status, to: updated.status },
    });
  }
  return NextResponse.json({ ...updated, keyResults: await listKeyResults(updated.id) });
});

export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const project = isUuid(id) ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return notFound();

  // DB tự xoá theo tasks, key_results, checklist_items và gỡ linked_project_id của giao dịch.
  await db.delete(projects).where(eq(projects.id, project.id));
  await logActivity({ userId, source: "DU_AN", action: "project.deleted", title: project.name });
  return NextResponse.json({ ok: true });
});
