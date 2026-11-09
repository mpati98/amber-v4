// Phần thuần của giới hạn thử mật khẩu (không chạm DB) — dùng bởi lib/password-guard.ts, có unit test riêng.
// UPDATE nguyên tử trong password-guard.ts phải khớp với afterFailure bên dưới.

export const MAX_FAILED_PASSWORDS = 5;
export const LOCK_MINUTES = 15;

/** Số giây còn lại của lần khoá (làm tròn lên); 0 nếu không khoá hoặc đã hết hạn. */
export function lockRemainingSeconds(lockedUntil: Date | null, now: Date): number {
  if (!lockedUntil) return 0;
  const ms = lockedUntil.getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** Thời điểm hết khoá nếu bắt đầu khoá tại [now]. */
export const lockUntil = (now: Date): Date => new Date(now.getTime() + LOCK_MINUTES * 60_000);

/** Trạng thái sau một lần sai: đủ MAX_FAILED_PASSWORDS thì khoá và đặt bộ đếm về 0, chưa đủ thì tăng 1 và giữ nguyên khoá cũ. */
export function afterFailure(prevCount: number, prevLockedUntil: Date | null, now: Date): { failedCount: number; lockedUntil: Date | null } {
  const count = prevCount + 1;
  return count >= MAX_FAILED_PASSWORDS ? { failedCount: 0, lockedUntil: lockUntil(now) } : { failedCount: count, lockedUntil: prevLockedUntil };
}
