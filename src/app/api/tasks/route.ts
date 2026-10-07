import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { z } from "zod";
import { logActivity } from "@/lib/activity-log";
import { userOwnsProject } from "@/lib/project-access";
import { dateString } from "@/lib/project-input";
import { krError, prepLeadDaysSchema, taskRuleError, TASK_STATUSES } from "@/lib/task-input";
import { checklistWith, getTaskView, withAttention } from "@/lib/task-view";
import { vnToday } from "@/lib/vn-time";

const createTaskSchema = z.object({
  projectId: z.string().uuid().optional(),
  krId: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).default("PREP"),
  importance: z.number().int().min(1).max(3).default(2),
  urgency: z.number().int().min(1).max(3).default(2),
  durationMinutes: z.number().int().min(5).default(15),
  startDate: dateString.optional(),
  dueDate: dateString.optional(),
  isMilestone: z.boolean().default(false),
  // Bật thì Kiều Lâu báo việc này trước hạn prepLeadDays ngày (mặc định 3).
  notifyDeadline: z.boolean().default(false),
  prepLeadDays: prepLeadDaysSchema.optional(),
});

export const GET = withAuth(async (req, userId) => {
  const kind = req.nextUrl.searchParams.get("kind"); // "gantt" = chỉ task có startDate/dueDate, không lặp
  const projectId = req.nextUrl.searchParams.get("projectId");

  if (projectId && !(z.string().uuid().safeParse(projectId).success && (await userOwnsProject(projectId, userId)))) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }

  const rows = await db.query.tasks.findMany({
    where: (t, { eq, and, isNull, isNotNull }) => {
      const conds = [eq(t.userId, userId)];
      if (projectId) conds.push(eq(t.projectId, projectId));
      if (kind === "gantt") conds.push(isNull(t.rrule), isNotNull(t.startDate), isNotNull(t.dueDate));
      return and(...conds);
    },
    with: { occurrences: true, checklistItems: checklistWith },
  });
  const today = vnToday();
  return NextResponse.json(rows.map((t) => withAttention(t, today)));
});

export const POST = withAuth(async (req, userId) => {
  const body = await req.json();
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // Trước đây gắn được task vào project của người khác (task đó bị tính vào
  // tiến độ dự án của họ trong du-an/overview).
  if (parsed.data.projectId && !(await userOwnsProject(parsed.data.projectId, userId))) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }
  const ruleError = taskRuleError({
    startDate: parsed.data.startDate ?? null,
    dueDate: parsed.data.dueDate ?? null,
    notifyDeadline: parsed.data.notifyDeadline,
  });
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 });
  const krProblem = await krError(parsed.data.krId ?? null, parsed.data.projectId ?? null);
  if (krProblem) return NextResponse.json({ error: krProblem }, { status: 400 });

  const [created] = await db
    .insert(tasks)
    .values({ ...parsed.data, userId })
    .returning();

  await logActivity({
    userId,
    source: "DU_AN",
    action: "task.created",
    title: created.title,
  });

  return NextResponse.json(await getTaskView(created.id), { status: 201 });
});
