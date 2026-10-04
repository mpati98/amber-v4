import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { withApiError } from "@/lib/apiError";
import {
  MAX_BODY_BYTES,
  checkRateLimit,
  clientIp,
  hashIp,
  isBot,
  notificationText,
  parseContact,
  sanitizeSubjectName,
  windowStarts,
} from "@/lib/contact";

// Form liên hệ của portfolio (domain khác, CORS trong next.config.ts). Công
// khai — KHÔNG dùng phiên đăng nhập; tự chống lạm dụng: giới hạn kích thước,
// bẫy bot, giới hạn tần suất theo IP (đã hash) và toàn hệ thống.
// Không bao giờ log tên/email/nội dung người gửi, không lưu IP thô.

export const maxDuration = 20;

const RESEND_TIMEOUT_MS = 8000;

const json = (body: unknown, status: number, headers?: HeadersInit) => NextResponse.json(body, { status, headers });
const serverError = () =>
  json({ error: "server_error", message: "Something went wrong. Please try again later, or email me directly." }, 500);

/** Lỗi DB của drizzle kèm cả tham số câu lệnh (dữ liệu người gửi) trong message — chỉ log tên + mã lỗi. */
function logSafe(stage: string, err: unknown) {
  const e = err as { name?: string; code?: string; cause?: { code?: string } };
  console.error(`contact: ${stage} failed`, e?.name ?? "Error", e?.code ?? e?.cause?.code ?? "");
}

/** Đọc thân request, dừng ngay khi vượt [limit] byte. null = quá lớn. */
async function readBodyLimited(req: NextRequest, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function sendNotification(input: { name: string; email: string; message: string }, at: Date) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_NOTIFY_EMAIL;
  if (!apiKey || !to) return "skipped" as const;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Portfolio <onboarding@resend.dev>",
        to: [to],
        reply_to: input.email,
        subject: `New portfolio message from ${sanitizeSubjectName(input.name)}`,
        text: notificationText(input, at),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("contact: email send failed", res.status);
      return "failed" as const;
    }
    return "sent" as const;
  } catch (err) {
    logSafe("email send", err);
    return "failed" as const;
  }
}

export const POST = withApiError(async (req: NextRequest) => {
  // (1) Kiểm tra đầu vào
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType.trim())) {
    return json({ error: "unsupported_media_type", message: "Send the form as JSON." }, 415);
  }
  const raw = await readBodyLimited(req, MAX_BODY_BYTES);
  if (raw === null) return json({ error: "payload_too_large", message: "Your message is too long." }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json", message: "The form data could not be read." }, 400);
  }

  const parsed = parseContact(body);
  if (!parsed.ok) return json({ error: "invalid_input", message: parsed.message }, 400);
  const { name, email, message, botcheck } = parsed.data;

  // Bẫy bot: giả vờ thành công, không lưu, không gửi (không để bot biết bị chặn).
  if (isBot(botcheck)) return json({ ok: true }, 201);

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("contact: AUTH_SECRET missing");
    return serverError();
  }
  const ipHash = hashIp(clientIp(req.headers.get("x-forwarded-for")), secret);

  // (2) Giới hạn tần suất — đếm từ contact_messages trong 24h gần nhất.
  const now = new Date();
  const { hourAgo, dayAgo } = windowStarts(now);
  // Tham số trong sql`` viết tay không gắn với cột nào → drizzle/postgres-js không
  // tự chuyển Date; truyền chuỗi ISO và ép kiểu timestamptz.
  const hourAgoTs = sql`${hourAgo.toISOString()}::timestamptz`;
  const dayAgoTs = sql`${dayAgo.toISOString()}::timestamptz`;
  let usage;
  try {
    const [row] = await db
      .select({
        ipHour: sql<number>`count(*) filter (where ${contactMessages.ipHash} = ${ipHash} and ${contactMessages.createdAt} > ${hourAgoTs})::int`,
        ipHourOldest: sql<Date | null>`min(${contactMessages.createdAt}) filter (where ${contactMessages.ipHash} = ${ipHash} and ${contactMessages.createdAt} > ${hourAgoTs})`,
        ipDay: sql<number>`count(*) filter (where ${contactMessages.ipHash} = ${ipHash})::int`,
        ipDayOldest: sql<Date | null>`min(${contactMessages.createdAt}) filter (where ${contactMessages.ipHash} = ${ipHash})`,
        globalDay: sql<number>`count(*)::int`,
        globalDayOldest: sql<Date | null>`min(${contactMessages.createdAt})`,
      })
      .from(contactMessages)
      .where(sql`${contactMessages.createdAt} > ${dayAgoTs}`);
    const asDate = (v: Date | string | null) => (v == null ? null : new Date(v));
    usage = {
      ipPerHour: { count: row.ipHour, oldest: asDate(row.ipHourOldest) },
      ipPerDay: { count: row.ipDay, oldest: asDate(row.ipDayOldest) },
      globalPerDay: { count: row.globalDay, oldest: asDate(row.globalDayOldest) },
    };
  } catch (err) {
    logSafe("rate limit query", err);
    return serverError();
  }

  const limit = checkRateLimit(usage, now);
  if (limit.limited) {
    return json(
      { error: "rate_limited", message: "Too many messages. Please try again later, or email me directly." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  // (3) Lưu TRƯỚC khi gửi email — mất email vẫn còn tin nhắn trong DB.
  let id: string;
  try {
    const [inserted] = await db
      .insert(contactMessages)
      .values({ name, email, message, ipHash, emailStatus: "skipped", createdAt: now })
      .returning({ id: contactMessages.id });
    id = inserted.id;
  } catch (err) {
    logSafe("insert", err);
    return serverError();
  }

  // (4) Gửi email (lỗi không làm request thất bại) → (5) cập nhật trạng thái.
  const emailStatus = await sendNotification({ name, email, message }, now);
  if (emailStatus !== "skipped") {
    try {
      await db.update(contactMessages).set({ emailStatus }).where(eq(contactMessages.id, id));
    } catch (err) {
      logSafe("email status update", err);
    }
  }

  // (6)
  return json({ ok: true }, 201);
});
