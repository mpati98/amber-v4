import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest, invalidBody, parseCardsSchema, readJson } from "@/lib/study-input";
import { findOwnedSubject } from "@/lib/study-courses";
import { parseCardsText } from "@/lib/study-card-parse";

// Xem trước nhập thẻ: đọc JSON dán vào, báo lỗi / trùng, KHÔNG lưu gì.
// cards = thẻ hợp lệ sẽ được tạo (đã bỏ thẻ lặp trong đầu vào và thẻ đã có trong môn);
// duplicates = lặp trong đầu vào; existing = đã có trong môn (theo phrase_key).
export const POST = withAuth(async (req, userId) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = parseCardsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const subject = await findOwnedSubject(db, parsed.data.subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  const result = parseCardsText(parsed.data.text);
  const keys = result.cards.map((c) => c.phraseKey);
  const found = keys.length
    ? await db
        .select({ key: studyCards.phraseKey })
        .from(studyCards)
        .where(and(eq(studyCards.userId, userId), eq(studyCards.subjectId, subject.id), inArray(studyCards.phraseKey, keys)))
    : [];
  const have = new Set(found.map((r) => r.key));

  return NextResponse.json({
    cards: result.cards.filter((c) => !have.has(c.phraseKey)),
    errors: result.errors,
    duplicates: result.duplicates,
    existing: result.cards.filter((c) => have.has(c.phraseKey)).map((c) => ({ index: c.index, phrase: c.phrase })),
  });
});
