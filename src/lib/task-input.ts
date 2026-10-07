import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { keyResults } from "@/db/schema";
import { endBeforeStart } from "@/lib/project-input";

export const TASK_STATUSES = ["PREP", "IN_PROGRESS", "REVIEW", "DONE"] as const;

/** Số ngày báo trước hạn của thông báo: 0–60. */
export const prepLeadDaysSchema = z.number().int().min(0).max(60);

/**
 * Quy tắc chéo giữa các trường của việc, áp lên giá trị SAU KHI gộp thay đổi.
 * Trả mã lỗi 400 hoặc null nếu hợp lệ. (kr ↔ project kiểm riêng ở [krError].)
 */
export function taskRuleError(t: {
  startDate: string | null;
  dueDate: string | null;
  notifyDeadline: boolean;
}): "end_before_start" | "notify_requires_due_date" | null {
  if (endBeforeStart(t.startDate, t.dueDate)) return "end_before_start";
  if (t.notifyDeadline && !t.dueDate) return "notify_requires_due_date";
  return null;
}

/** KR phải thuộc đúng dự án của việc; có KR mà không có dự án cũng là lỗi. */
export async function krError(krId: string | null, projectId: string | null): Promise<"kr_requires_project" | "kr_not_in_project" | null> {
  if (!krId) return null;
  if (!projectId) return "kr_requires_project";
  const kr = await db.query.keyResults.findFirst({
    where: and(eq(keyResults.id, krId), eq(keyResults.projectId, projectId)),
    columns: { id: true },
  });
  return kr ? null : "kr_not_in_project";
}
