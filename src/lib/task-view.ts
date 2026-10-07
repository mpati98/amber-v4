import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { checklistItems, tasks } from "@/db/schema";

/** Phần `with` dùng chung: checklist xếp theo position, chỉ các cột API trả ra. */
export const checklistWith = {
  columns: { id: true as const, text: true as const, done: true as const, position: true as const },
  orderBy: [asc(checklistItems.position), asc(checklistItems.createdAt)],
};

/** 1 việc kèm checklistItems (đúng dạng POST/PATCH trả về). */
export async function getTaskView(id: string) {
  return db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: { checklistItems: checklistWith },
  });
}
