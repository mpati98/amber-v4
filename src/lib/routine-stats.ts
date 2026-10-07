import { addDaysIso } from "@/lib/deadline-alert";

// Thống kê một việc hằng ngày quanh ngày tham chiếu. Hàm thuần — test ở routine-stats.test.ts.

/** Số ngày nhìn lùi tối đa khi đếm streak. */
export const STREAK_LOOKBACK_DAYS = 400;

export type RoutineDay = { date: string; due: boolean; done: boolean };
export type RoutineStats = {
  dueToday: boolean;
  doneToday: boolean;
  streak: number;
  last7: RoutineDay[];
};

/** Thứ của ngày lịch "YYYY-MM-DD": 1 = thứ Hai … 7 = Chủ nhật. */
export function isoWeekday(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật
  return d === 0 ? 7 : d;
}

/**
 * streak = số ngày ĐẾN HẠN liên tiếp đã làm, đếm lùi từ [ref]. Ngày không đến hạn bỏ qua
 * (không đứt chuỗi). Ngày ref đến hạn mà chưa làm thì bắt đầu từ ngày đến hạn liền trước.
 */
export function routineStats(weekdays: number[], doneDates: Iterable<string>, ref: string): RoutineStats {
  const done = new Set(doneDates);
  const due = (d: string) => weekdays.includes(isoWeekday(d));

  let streak = 0;
  for (let i = 0; i <= STREAK_LOOKBACK_DAYS; i++) {
    const d = addDaysIso(ref, -i);
    if (!due(d)) continue;
    if (done.has(d)) streak++;
    else if (i === 0) continue;
    else break;
  }

  const last7: RoutineDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDaysIso(ref, -i);
    last7.push({ date: d, due: due(d), done: done.has(d) });
  }

  return { dueToday: due(ref), doneToday: done.has(ref), streak, last7 };
}
