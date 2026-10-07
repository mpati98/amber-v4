import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { checklistItems, tasks } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";

const patchItemSchema = z.object({
  done: z.boolean().optional(),
  text: z.string().min(1).max(500).optional(),
});

type RouteParams = { params: Promise<{ id: string; itemId: string }> };

const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

// Sửa một mục. Việc phải của user và mục phải thuộc việc đó, không thì 404.
export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id, itemId } = await params;
  const task = isUuid(id)
    ? await db.query.tasks.findFirst({ where: and(eq(tasks.id, id), eq(tasks.userId, userId)), columns: { id: true } })
    : undefined;
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  const parsed = patchItemSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 });
  }

  const [updated] = isUuid(itemId)
    ? await db
        .update(checklistItems)
        .set(parsed.data)
        .where(and(eq(checklistItems.id, itemId), eq(checklistItems.taskId, task.id)))
        .returning({ id: checklistItems.id, text: checklistItems.text, done: checklistItems.done, position: checklistItems.position })
    : [];
  if (!updated) return NextResponse.json({ error: "item not found" }, { status: 404 });
  return NextResponse.json(updated);
});
