// Validate giấc ngủ tự ghi (PUT /api/du-an/sleep) — dùng chung route + test.
import { z } from "zod";
import { dateString } from "@/lib/project-input";

export const sleepLogSchema = z.object({
  date: dateString,
  sleepMinutes: z.number().int().min(0).max(1440),
  quality: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

/** Chỉ cho ghi từ 60 ngày trước tới hôm nay (lịch VN). */
export function sleepDateError(date: string, today: string): "future_date" | "too_old" | null {
  if (date > today) return "future_date";
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
  return days > 60 ? "too_old" : null;
}

export type SleepRow = { date: string; sleepMinutes: number; quality: number | null; note: string | null; updatedAt: Date };
export const sleepJson = (r: SleepRow) => ({ date: r.date, sleepMinutes: r.sleepMinutes, quality: r.quality, note: r.note, updatedAt: r.updatedAt.toISOString() });
