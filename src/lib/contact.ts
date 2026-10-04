import { createHmac } from "crypto";
import { z } from "zod";

// Hàm thuần cho POST /api/public/contact (form liên hệ trên portfolio) — tách
// khỏi route để test được không cần DB/mạng. Xem src/lib/contact.test.ts.

/** Thân request tối đa 10 KB. */
export const MAX_BODY_BYTES = 10 * 1024;

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(100, "Your name is too long (100 characters max)."),
  email: z
    .string()
    .trim()
    .max(254, "Your email address is too long.")
    .pipe(z.email("Please enter a valid email address.")),
  message: z
    .string()
    .trim()
    .min(1, "Please enter a message.")
    .max(2000, "Your message is too long (2000 characters max)."),
  botcheck: z.union([z.boolean(), z.string()]).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** Kết quả kiểm tra đầu vào: thông điệp lỗi tiếng Anh dễ hiểu, không lộ chi tiết nội bộ. */
export function parseContact(body: unknown): { ok: true; data: ContactInput } | { ok: false; message: string } {
  const parsed = contactSchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  // Lỗi kiểu dữ liệu (thiếu trường, sai type) dùng thông điệp chung.
  const friendly = issue?.code === "invalid_type" ? null : issue?.message;
  return { ok: false, message: friendly || "Please fill in your name, email and message." };
}

/** Bẫy bot: checkbox ẩn bị tích (true) hoặc có chuỗi không rỗng. */
export function isBot(botcheck: ContactInput["botcheck"]): boolean {
  return botcheck === true || (typeof botcheck === "string" && botcheck.trim() !== "");
}

/** IP client: phần tử đầu của x-forwarded-for (proxy Vercel đặt), thiếu thì "unknown". */
export function clientIp(forwardedFor: string | null | undefined): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || "unknown";
}

/** HMAC-SHA256(IP, secret) dạng hex — không lưu IP thô. */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/**
 * Tên người gửi → an toàn để đặt vào subject email: bỏ CR/LF và ký tự điều
 * khiển (chống chèn header như "\r\nBcc: ..."), gộp khoảng trắng, tối đa 100 ký tự.
 */
export function sanitizeSubjectName(name: string): string {
  return name
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
}

// ===== Giới hạn tần suất (đếm từ chính bảng contact_messages) =====

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RATE_LIMITS = {
  ipPerHour: { limit: 3, windowMs: HOUR_MS },
  ipPerDay: { limit: 10, windowMs: DAY_MS },
  // Ngắt mạch toàn hệ thống — cũng giữ trong hạn mức 100 email/ngày của Resend.
  globalPerDay: { limit: 30, windowMs: DAY_MS },
} as const;

export type RateKey = keyof typeof RATE_LIMITS;
/** Số tin trong cửa sổ + thời điểm tin cũ nhất trong cửa sổ đó (null nếu chưa có). */
export type WindowUsage = { count: number; oldest: Date | null };

/**
 * Vượt giới hạn nào thì trả số giây nên chờ (Retry-After): tới lúc tin cũ nhất
 * trong cửa sổ hết hạn — ước lượng đủ dùng (khi đúng bằng giới hạn thì chính xác).
 * Nhiều cửa sổ cùng vượt thì lấy thời gian chờ dài nhất. Tối thiểu 1 giây.
 */
export function checkRateLimit(
  usage: Record<RateKey, WindowUsage>,
  now: Date,
): { limited: false } | { limited: true; retryAfterSeconds: number; exceeded: RateKey[] } {
  const exceeded: RateKey[] = [];
  let waitMs = 0;
  for (const key of Object.keys(RATE_LIMITS) as RateKey[]) {
    const { limit, windowMs } = RATE_LIMITS[key];
    const { count, oldest } = usage[key];
    if (count < limit) continue;
    exceeded.push(key);
    const freeAt = oldest ? oldest.getTime() + windowMs : now.getTime() + windowMs;
    waitMs = Math.max(waitMs, freeAt - now.getTime());
  }
  if (exceeded.length === 0) return { limited: false };
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)), exceeded };
}

/** Mốc bắt đầu từng cửa sổ, để truy vấn DB đếm đúng khoảng. */
export function windowStarts(now: Date): { hourAgo: Date; dayAgo: Date } {
  return { hourAgo: new Date(now.getTime() - HOUR_MS), dayAgo: new Date(now.getTime() - DAY_MS) };
}

/** Thân email thông báo — văn bản thuần, không HTML. */
export function notificationText(input: { name: string; email: string; message: string }, at: Date): string {
  return [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Received: ${at.toISOString()}`,
    "",
    "Message:",
    input.message,
  ].join("\n");
}
