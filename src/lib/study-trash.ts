// Phần thuần của Thùng rác khóa học (không chạm DB).

export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

/** Số ngày còn lại trước khi xoá hẳn: TRASH_DAYS trừ số NGÀY NGUYÊN đã qua, tối thiểu 0. */
export function trashDaysLeft(deletedAt: Date, now: Date): number {
  const passed = Math.floor((now.getTime() - deletedAt.getTime()) / DAY_MS);
  return Math.max(0, TRASH_DAYS - Math.max(0, passed));
}

/** Mốc deleted_at cũ hơn mốc này thì hết hạn Thùng rác. */
export const trashCutoff = (now: Date): Date => new Date(now.getTime() - TRASH_DAYS * DAY_MS);
