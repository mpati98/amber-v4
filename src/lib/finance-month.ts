import { vnMonthBounds, vnToday } from "@/lib/vn-time";

// Tìm tháng tài chính (project FINANCE) chứa một thời điểm. Hàm thuần — test ở finance-month.test.ts.
// Tháng được xác định bằng startDate/endDate ("YYYY-MM-DD", ngày đầu / cuối tháng theo giờ VN).

export type FinanceMonthRange = { id: string; startDate: string | null; endDate: string | null };

/** Ngày lịch VN ("YYYY-MM-DD") của một thời điểm. Giao dịch 23:30 UTC ngày 30 là sáng ngày 1 tháng sau ở VN. */
export function vnDateOf(at: Date): string {
  return vnToday(at);
}

/** Tháng có startDate ≤ [vnDate] ≤ endDate; không có thì null. */
export function findMonthForDate<T extends FinanceMonthRange>(months: T[], vnDate: string): T | null {
  return months.find((m) => m.startDate && m.endDate && m.startDate <= vnDate && vnDate <= m.endDate) ?? null;
}

/** [at] có nằm trong tháng hiện tại (theo giờ VN, so với [now]) không. */
export function isInCurrentVnMonth(at: Date, now: Date = new Date()): boolean {
  return vnMonthBounds(at).start === vnMonthBounds(now).start;
}
