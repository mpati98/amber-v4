import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";

// Phần tính thuần của "ngày còn thiếu lý do" — không đụng DB, test ở study-pending.test.ts.

/** Số ngày nhìn lùi tối đa để tìm ngày thiếu lý do. */
export const PENDING_REASON_LOOKBACK_DAYS = 14;

/**
 * Một ngày đã qua có "nợ lý do" không: có mục tiêu, tổng phút < mục tiêu, chưa có lý do, d ≥ [notBefore]
 * (ngày tạo môn / routine) và — nếu có [weekdays] của routine — d thuộc các thứ đó. Hàm thuần dùng chung cho
 * `pendingReasonDates` (routine, giới hạn 14 ngày) và `needsReason` của lịch (không giới hạn).
 */
export function dayNeedsReason(input: {
  date: string;
  goalMinutes: number | null;
  minutes: number;
  hasReason: boolean;
  notBefore?: string;
  weekdays?: readonly number[] | null;
}): boolean {
  const { date, goalMinutes, minutes, hasReason, notBefore, weekdays } = input;
  if (goalMinutes === null) return false;
  if (notBefore !== undefined && date < notBefore) return false;
  if (weekdays && !weekdays.includes(isoWeekday(date))) return false;
  return minutes < goalMinutes && !hasReason;
}

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
    if (dayNeedsReason({ date: d, goalMinutes, minutes: totals.get(d) ?? 0, hasReason: reasonDates.has(d), weekdays })) result.push(d);
  }
  return result;
}
