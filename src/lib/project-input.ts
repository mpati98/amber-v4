import { z } from "zod";

/** Ngày lịch "YYYY-MM-DD" (có kiểm tra ngày thật, vd 2026-02-30 bị loại). */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, { message: "invalid date" });

export const PROJECT_STATUSES = ["ACTIVE", "PAUSED", "DONE"] as const;

/** endDate < startDate → sai (so chuỗi ISO được). Thiếu một trong hai thì hợp lệ. */
export function endBeforeStart(startDate?: string | null, endDate?: string | null): boolean {
  return !!startDate && !!endDate && endDate < startDate;
}
