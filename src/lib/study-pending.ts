import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";

// Phần tính thuần của "ngày còn thiếu lý do" — không đụng DB, test ở study-pending.test.ts.

/** Số ngày nhìn lùi tối đa để tìm ngày thiếu lý do. */
export const PENDING_REASON_LOOKBACK_DAYS = 14;

/**
 * Ngày d với max(today − 14, ngày tạo routine) ≤ d < today, d thuộc [weekdays], tổng phút < [goalMinutes]
 * và chưa có lý do. Tăng dần. goal null → không có ngày nào. Hàm thuần.
 */
export function computePendingReasonDates(input: {
  today: string;
  createdDate: string;
  weekdays: number[];
  goalMinutes: number | null;
  totals: ReadonlyMap<string, number>;
  reasonDates: ReadonlySet<string>;
}): string[] {
  const { today, createdDate, weekdays, goalMinutes, totals, reasonDates } = input;
  if (goalMinutes === null) return [];
  const earliest = addDaysIso(today, -PENDING_REASON_LOOKBACK_DAYS);
  const start = createdDate > earliest ? createdDate : earliest;
  const result: string[] = [];
  for (let d = start; d < today; d = addDaysIso(d, 1)) {
    if (!weekdays.includes(isoWeekday(d))) continue;
    if ((totals.get(d) ?? 0) >= goalMinutes) continue;
    if (reasonDates.has(d)) continue;
    result.push(d);
  }
  return result;
}
