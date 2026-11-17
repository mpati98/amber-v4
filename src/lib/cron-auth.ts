import { createHash, timingSafeEqual } from "crypto";

// Xác thực request của Vercel Cron: header `Authorization: Bearer $CRON_SECRET`. Hàm thuần — test ở cron-auth.test.ts.

export type CronAuthResult = "ok" | "unauthorized" | "not_configured";

/**
 * So sánh timing-safe. Băm SHA-256 cả hai vế trước khi so để độ dài luôn bằng nhau
 * (timingSafeEqual ném lỗi khi khác độ dài, và so độ dài trước sẽ lộ độ dài secret).
 */
export function checkCronAuth(authorization: string | null, secret: string | undefined): CronAuthResult {
  if (!secret?.trim()) return "not_configured";
  if (!authorization) return "unauthorized";
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret.trim()}`)) ? "ok" : "unauthorized";
}
