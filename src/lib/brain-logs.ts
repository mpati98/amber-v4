// Nhật ký lượt gọi mô hình của amber-brain (bảng agent_logs): kiểm tra đầu vào, con trỏ phân trang, quy tắc gộp
// outcome và điều kiện "đủ điều kiện làm mẫu huấn luyện". Phần thuần (không đụng DB) có test ở brain-logs.test.ts.
import { z } from "zod";

export const OUTCOMES = ["unknown", "accepted", "corrected", "rejected", "retried"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const FEEDBACK_OUTCOMES = ["accepted", "rejected"] as const;

export const INGEST_MAX_ROWS = 25; // mỗi request: messages mỗi dòng có thể vài chục KB, Vercel giới hạn body ~4.5MB
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;
export const EXPORT_PAGE = 100;
export const UNKNOWN_GRACE_DAYS = 3; // dòng outcome unknown chỉ thành mẫu sau ngần ấy ngày không bị sửa (khớp export_dataset.py)

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "invalid date" });

/** Một dòng log brain đẩy lên. Chỉ các trường này được nhận: userId lấy từ token, exclude_from_training do app đặt. */
export const ingestLogSchema = z.object({
  id: z.string().uuid(),
  createdAt: isoDate,
  sessionId: z.string().max(128).nullish(),
  turnIndex: z.number().int().nullish(),
  agent: z.string().min(1).max(32),
  source: z.enum(["agent", "manual"]).default("agent"),
  lang: z.enum(["vi", "en", "mixed"]).nullish(),
  modelName: z.string().max(256).nullish(),
  adapterVersion: z.string().max(256).nullish(),
  promptVersion: z.string().max(64).nullish(),
  userInput: z.string().max(20000).default(""),
  retrievedContext: z.unknown().optional(),
  messages: z.unknown().optional(),
  tools: z.unknown().optional(),
  rawOutput: z.string().nullish(),
  parsedOutput: z.unknown().optional(),
  parseOk: z.boolean().nullish(),
  toolName: z.string().max(128).nullish(),
  toolArgs: z.unknown().optional(),
  toolResult: z.unknown().optional(),
  toolOk: z.boolean().nullish(),
  error: z.string().nullish(),
  entityType: z.string().max(64).nullish(),
  entityId: z.string().max(128).nullish(),
  latencyMs: z.number().int().nullish(),
  promptTokens: z.number().int().nullish(),
  completionTokens: z.number().int().nullish(),
  outcome: z.enum(OUTCOMES).default("unknown"),
  outcomeAt: isoDate.nullish(),
  correctedOutput: z.unknown().optional(),
  correctedAt: isoDate.nullish(),
});
export type IngestLog = z.infer<typeof ingestLogSchema>;

export const feedbackSchema = z.object({ outcome: z.enum(FEEDBACK_OUTCOMES) }).strict();
export const patchSchema = z.object({ excludeFromTraining: z.boolean() }).strict(); // app KHÔNG sửa nội dung log

/** Bản mới hơn thắng khi brain và app cùng đặt outcome. Brain không có mốc (chưa từng đặt) thì không bao giờ đè. */
export function shouldApplyOutcome(existingAt: Date | null, incomingAt: Date | null): boolean {
  if (!incomingAt) return false;
  return !existingAt || incomingAt.getTime() > existingAt.getTime();
}

// --- con trỏ phân trang: (createdAt, id) giảm dần --------------------------------------------------------

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
    const createdAt = new Date(iso);
    if (!iso || !id || Number.isNaN(createdAt.getTime()) || !z.string().uuid().safeParse(id).success) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// --- bộ lọc danh sách ------------------------------------------------------------------------------------

const VN_OFFSET = "+07:00";

/** Mốc đầu ngày (giờ VN) của "YYYY-MM-DD". */
export function vnDayStart(day: string): Date {
  return new Date(`${day}T00:00:00${VN_OFFSET}`);
}

export const listQuerySchema = z.object({
  agent: z.string().min(1).max(32).optional(),
  outcome: z.enum(OUTCOMES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
  cursor: z.string().max(200).optional(),
});

export function parseListQuery(sp: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (v !== "") raw[k] = v;
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "invalid_query" };
  const q = parsed.data;
  const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
  if (q.cursor && !cursor) return { ok: false as const, error: "invalid_cursor" };
  const from = q.from ? vnDayStart(q.from) : undefined;
  const toExclusive = q.to ? new Date(vnDayStart(q.to).getTime() + 24 * 3600 * 1000) : undefined; // gồm cả ngày `to`
  if ((from && Number.isNaN(from.getTime())) || (toExclusive && Number.isNaN(toExclusive.getTime()))) {
    return { ok: false as const, error: "invalid_query" };
  }
  return { ok: true as const, value: { agent: q.agent, outcome: q.outcome, from, toExclusive, limit: q.limit, cursor: cursor ?? undefined } };
}
