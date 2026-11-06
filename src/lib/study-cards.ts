import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { studyCards, studyLogs } from "@/db/schema";
import { isUuid, type DbLike } from "@/lib/study-courses";
import type { CardFieldError } from "@/lib/study-card-parse";

// Truy vấn và dạng trả về dùng chung của API kho thẻ từ vựng.

export type CardRow = typeof studyCards.$inferSelect;
export type LogRow = typeof studyLogs.$inferSelect;

/** Dạng thẻ API trả về. */
export const cardView = (c: CardRow) => ({
  id: c.id,
  subjectId: c.subjectId,
  sourceLogId: c.sourceLogId,
  phrase: c.phrase,
  meaning: c.meaning,
  example: c.example,
  note: c.note,
  kind: c.kind,
  topics: c.topics,
  stage: c.stage,
  dueAt: c.dueAt,
  reviewCount: c.reviewCount,
  notYetCount: c.notYetCount,
  lastReviewedAt: c.lastReviewedAt,
  suspended: c.suspended,
  createdAt: c.createdAt,
});

export async function findOwnedCard(dbx: DbLike, id: string, userId: string): Promise<CardRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await dbx.select().from(studyCards).where(and(eq(studyCards.id, id), eq(studyCards.userId, userId)));
  return row ?? null;
}

/** Buổi học nguồn của thẻ: phải của user (log_not_found) và cùng môn (log_subject_mismatch). */
export async function findSourceLog(dbx: DbLike, logId: string, userId: string, subjectId: string): Promise<{ log: LogRow } | { error: "log_not_found" | "log_subject_mismatch" }> {
  if (!isUuid(logId)) return { error: "log_not_found" };
  const [row] = await dbx.select().from(studyLogs).where(and(eq(studyLogs.id, logId), eq(studyLogs.userId, userId)));
  if (!row) return { error: "log_not_found" };
  return row.subjectId === subjectId ? { log: row } : { error: "log_subject_mismatch" };
}

/** 400 cùng dạng với zod flatten để client dùng chung một chỗ đọc lỗi. */
export function invalidCard(errors: CardFieldError[]) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const e of errors) {
    if (e.field === null) formErrors.push(e.reason);
    else (fieldErrors[e.field] ??= []).push(e.reason);
  }
  return NextResponse.json({ error: { formErrors, fieldErrors } }, { status: 400 });
}

/** Vi phạm unique (23505) — drizzle bọc lỗi gốc trong `cause`. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (typeof x === "object" && x !== null ? (x as { code?: unknown }).code : undefined);
  return code(e) === "23505" || code((e as { cause?: unknown })?.cause) === "23505";
}

// Con trỏ phân trang (created_at desc, id desc). created_at giữ nguyên dạng văn bản của Postgres (đủ micro giây):
// đi qua Date của JS sẽ cắt còn mili giây và làm sót thẻ.
export const cursorTsSql = sql<string>`${studyCards.createdAt}::text`;

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: ts, id })).toString("base64url");
}

export function decodeCursor(raw: string): { t: string; id: string } | null {
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof v?.t !== "string" || typeof v?.id !== "string" || !isUuid(v.id) || Number.isNaN(Date.parse(v.t))) return null;
    return { t: v.t, id: v.id };
  } catch {
    return null;
  }
}

/** Thoát ký tự đặc biệt của LIKE để tìm đúng chuỗi người dùng gõ. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
