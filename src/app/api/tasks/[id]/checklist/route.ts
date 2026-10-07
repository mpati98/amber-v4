import { NextResponse } from "next/server";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { checklistItems, tasks } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";

const MAX_ITEMS = 50;

const putChecklistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        text: z.string().min(1).max(500),
        done: z.boolean(),
      })
    )
    .max(MAX_ITEMS),
});

type RouteParams = { params: Promise<{ id: string }> };

// Thay toàn bộ checklist của việc trong 1 transaction: có id thì cập nhật, không id
// thì tạo, mục cũ vắng mặt thì xoá; position = thứ tự trong mảng.
export const PUT = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const task = z.string().uuid().safeParse(id).success
    ? await db.query.tasks.findFirst({ where: and(eq(tasks.id, id), eq(tasks.userId, userId)), columns: { id: true } })
    : undefined;
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  const parsed = putChecklistSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { items } = parsed.data;

  const keepIds = items.flatMap((i) => (i.id ? [i.id] : []));
  if (new Set(keepIds).size !== keepIds.length) {
    return NextResponse.json({ error: "duplicate_item_id" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    if (keepIds.length > 0) {
      const owned = await tx
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(and(eq(checklistItems.taskId, task.id), inArray(checklistItems.id, keepIds)));
      if (owned.length !== keepIds.length) return "item_not_in_task" as const;
    }

    await tx
      .delete(checklistItems)
      .where(
        keepIds.length > 0
          ? and(eq(checklistItems.taskId, task.id), notInArray(checklistItems.id, keepIds))
          : eq(checklistItems.taskId, task.id)
      );

    for (const [position, item] of items.entries()) {
      if (item.id) {
        await tx
          .update(checklistItems)
          .set({ text: item.text, done: item.done, position })
          .where(and(eq(checklistItems.id, item.id), eq(checklistItems.taskId, task.id)));
      } else {
        await tx.insert(checklistItems).values({ taskId: task.id, text: item.text, done: item.done, position });
      }
    }

    return tx
      .select({ id: checklistItems.id, text: checklistItems.text, done: checklistItems.done, position: checklistItems.position })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, task.id))
      .orderBy(asc(checklistItems.position), asc(checklistItems.createdAt));
  });

  if (result === "item_not_in_task") {
    return NextResponse.json({ error: "item_not_in_task" }, { status: 400 });
  }
  return NextResponse.json(result);
});
