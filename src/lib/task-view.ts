import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { checklistItems, tasks } from "@/db/schema";
import { taskAttention } from "@/lib/task-attention";
import { vnToday } from "@/lib/vn-time";

/** Phần `with` dùng chung: checklist xếp theo position, chỉ các cột API trả ra. */
export const checklistWith = {
  columns: { id: true as const, text: true as const, done: true as const, position: true as const },
  orderBy: [asc(checklistItems.position), asc(checklistItems.createdAt)],
};

/** Thêm cờ `attention` (OVERDUE | IDLE | null) vào việc, tính theo ngày hôm nay giờ VN. */
export function withAttention<T extends { status: string; dueDate: string | null; statusChangedAt: Date | string }>(
  task: T,
  today: string = vnToday()
) {
  return { ...task, attention: taskAttention(task, today) };
}

/** 1 việc kèm checklistItems và attention (đúng dạng POST/PATCH trả về). */
export async function getTaskView(id: string) {
  const row = await db.query.tasks.findFirst({
    where: eq(tasks.id, id),
    with: { checklistItems: checklistWith },
  });
  return row ? withAttention(row) : row;
}
