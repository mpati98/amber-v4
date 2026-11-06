// Lịch theo giờ Việt Nam (UTC+7, không có giờ mùa hè) cho các route tính
// "hôm nay" / "tháng này" / "năm nay". Server chạy UTC nên dùng thẳng
// new Date() sẽ lệch ngày trong khoảng 0h–7h sáng giờ VN.

import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Date đã dịch +7h: đọc bằng getUTC*() sẽ ra ngày/tháng/năm theo giờ VN. */
function shiftToVn(at: Date): Date {
  return new Date(at.getTime() + VN_OFFSET_MS);
}

function isoDate(y: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(y, monthIndex, day)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" theo lịch VN. */
export function vnToday(at: Date = new Date()): string {
  return shiftToVn(at).toISOString().slice(0, 10);
}

/** Năm theo lịch VN (vd archivedAt 2026-12-31T20:00Z là năm 2027 ở VN). */
export function vnYear(at: Date = new Date()): number {
  return shiftToVn(at).getUTCFullYear();
}

/** Tháng chứa [at] theo lịch VN: ngày đầu/cuối tháng dạng "YYYY-MM-DD", month 1–12. */
export function vnMonthBounds(at: Date = new Date()): { year: number; month: number; start: string; end: string } {
  const vn = shiftToVn(at);
  const year = vn.getUTCFullYear();
  const monthIndex = vn.getUTCMonth();
  return {
    year,
    month: monthIndex + 1,
    start: isoDate(year, monthIndex, 1),
    end: isoDate(year, monthIndex + 1, 0), // ngày 0 của tháng sau = ngày cuối tháng này
  };
}

/** Thứ ôn mặc định khi môn chưa đặt: chỉ Chủ nhật (1 = thứ Hai … 7 = Chủ nhật). */
export const DEFAULT_REVIEW_WEEKDAYS: readonly number[] = [7];

/** Chỉ giữ thứ hợp lệ 1–7; rỗng thì dùng mặc định (Chủ nhật). */
function validWeekdays(weekdays: readonly number[]): readonly number[] {
  const ok = weekdays.filter((w) => Number.isInteger(w) && w >= 1 && w <= 7);
  return ok.length > 0 ? ok : DEFAULT_REVIEW_WEEKDAYS;
}

/** Thời điểm 00:00 giờ VN của ngày "YYYY-MM-DD". */
export function vnDayStart(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00+07:00`);
}

/** Tháng chứa ngày "YYYY-MM-DD" (lịch dương): ngày đầu/cuối tháng, month 1–12. */
export function monthBoundsOfIso(isoDay: string): { year: number; month: number; start: string; end: string } {
  const year = Number(isoDay.slice(0, 4));
  const monthIndex = Number(isoDay.slice(5, 7)) - 1;
  return { year, month: monthIndex + 1, start: isoDate(year, monthIndex, 1), end: isoDate(year, monthIndex + 1, 0) };
}

/** Quý dương lịch chứa ngày "YYYY-MM-DD": quarter 1–4, ngày đầu/cuối quý. */
export function quarterBoundsOfIso(isoDay: string): { year: number; quarter: number; start: string; end: string } {
  const year = Number(isoDay.slice(0, 4));
  const quarterIndex = Math.floor((Number(isoDay.slice(5, 7)) - 1) / 3);
  return {
    year,
    quarter: quarterIndex + 1,
    start: isoDate(year, quarterIndex * 3, 1),
    end: isoDate(year, quarterIndex * 3 + 3, 0), // ngày 0 của tháng đầu quý sau = ngày cuối quý này
  };
}

/** Quý chứa [at] theo lịch VN: ngày đầu/cuối quý dạng "YYYY-MM-DD", quarter 1–4. */
export function vnQuarterBounds(at: Date = new Date()): { year: number; quarter: number; start: string; end: string } {
  return quarterBoundsOfIso(vnToday(at));
}

/** Ngày đầu tiên trong [periodStart, periodEnd] (gồm hai đầu) có thứ thuộc [reviewWeekdays]; null nếu không có. */
export function firstReviewDayOf(periodStart: string, periodEnd: string, reviewWeekdays: readonly number[] = DEFAULT_REVIEW_WEEKDAYS): string | null {
  const days = validWeekdays(reviewWeekdays);
  for (let d = periodStart; d <= periodEnd; d = addDaysIso(d, 1)) if (days.includes(isoWeekday(d))) return d;
  return null;
}

/** Ngày ôn đầu tiên SAU [afterDate] (không tính chính ngày đó). */
export function nextReviewDay(afterDate: string, reviewWeekdays: readonly number[] = DEFAULT_REVIEW_WEEKDAYS): string {
  const days = validWeekdays(reviewWeekdays);
  for (let i = 1; i <= 7; i++) {
    const d = addDaysIso(afterDate, i);
    if (days.includes(isoWeekday(d))) return d;
  }
  throw new Error("unreachable: weekdays hợp lệ luôn có một ngày trong 7 ngày");
}
