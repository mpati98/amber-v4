// Điều kiện cảnh báo "việc sắp hoặc trễ hạn" của Kiều Lâu. Hàm thuần — test ở deadline-alert.test.ts.

/** Số ngày báo trước hạn khi việc bật thông báo mà chưa đặt prepLeadDays. */
export const DEFAULT_NOTIFY_LEAD_DAYS = 3;

/** Cộng [days] ngày vào ngày lịch "YYYY-MM-DD" (không phụ thuộc múi giờ). */
export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Việc cần cảnh báo khi: bật notifyDeadline, chưa DONE, có dueDate và
 * dueDate ≤ hôm nay + prepLeadDays (mặc định 3). Quá hạn thì vẫn cảnh báo tới khi DONE.
 * [today] là "YYYY-MM-DD" theo giờ VN.
 */
export function isDeadlineAlert(
  task: { notifyDeadline: boolean; status: string; dueDate: string | null; prepLeadDays: number | null },
  today: string
): boolean {
  if (!task.notifyDeadline || task.status === "DONE" || !task.dueDate) return false;
  return task.dueDate <= addDaysIso(today, task.prepLeadDays ?? DEFAULT_NOTIFY_LEAD_DAYS);
}
