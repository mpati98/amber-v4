import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { lockRemainingSeconds, lockUntil, MAX_FAILED_PASSWORDS } from "@/lib/password-lockout";

// Kiểm mật khẩu của người dùng đang đăng nhập cho thao tác nguy hiểm (xoá khóa học...), có giới hạn thử sai.
// Tính theo người dùng (users.pw_failed_count / pw_locked_until), không theo IP. Dùng lại được cho đăng nhập.

export type PasswordCheck =
  | { ok: true }
  | { ok: false; status: 403 }
  | { ok: false; status: 429; retryAfterSeconds: number };

/**
 * - Đang khoá → 429 ngay, KHÔNG so mật khẩu.
 * - Sai → tăng bộ đếm bằng một UPDATE nguyên tử; đủ MAX_FAILED_PASSWORDS lần thì khoá LOCK_MINUTES phút (xem afterFailure) và đặt bộ đếm về 0
 *   (lần sai làm khoá đó trả 429); chưa đủ → 403.
 * - Đúng → đặt lại bộ đếm.
 * Không ghi mật khẩu ra log hay lỗi.
 */
export async function verifyPasswordWithLockout(userId: string, password: string, now: Date = new Date()): Promise<PasswordCheck> {
  const [user] = await db
    .select({ hash: users.passwordHash, lockedUntil: users.pwLockedUntil, failed: users.pwFailedCount })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return { ok: false, status: 403 };

  const remaining = lockRemainingSeconds(user.lockedUntil, now);
  if (remaining > 0) return { ok: false, status: 429, retryAfterSeconds: remaining };

  if (await bcrypt.compare(password, user.hash)) {
    if (user.failed !== 0 || user.lockedUntil) await db.update(users).set({ pwFailedCount: 0, pwLockedUntil: null }).where(eq(users.id, userId));
    return { ok: true };
  }

  const until = lockUntil(now);
  const [row] = await db
    .update(users)
    .set({
      pwFailedCount: sql`CASE WHEN ${users.pwFailedCount} + 1 >= ${MAX_FAILED_PASSWORDS} THEN 0 ELSE ${users.pwFailedCount} + 1 END`,
      pwLockedUntil: sql`CASE WHEN ${users.pwFailedCount} + 1 >= ${MAX_FAILED_PASSWORDS} THEN ${until.toISOString()}::timestamptz ELSE ${users.pwLockedUntil} END`,
    })
    .where(eq(users.id, userId))
    .returning({ lockedUntil: users.pwLockedUntil });
  const wait = lockRemainingSeconds(row?.lockedUntil ?? null, now);
  return wait > 0 ? { ok: false, status: 429, retryAfterSeconds: wait } : { ok: false, status: 403 };
}

/** Đổi kết quả sai / khoá thành response; undefined nếu mật khẩu đúng. */
export function passwordFailureResponse(check: PasswordCheck): NextResponse | undefined {
  if (check.ok) return undefined;
  if (check.status === 429) {
    return NextResponse.json(
      { error: "password_locked", retryAfterSeconds: check.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(check.retryAfterSeconds) } }
    );
  }
  return NextResponse.json({ error: "wrong_password" }, { status: 403 });
}
