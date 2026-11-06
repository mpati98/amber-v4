import { NextResponse } from "next/server";
import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest, createCardSchema, invalidBody, listCardsQuerySchema, readJson } from "@/lib/study-input";
import { findOwnedSubject, guardStudy } from "@/lib/study-courses";
import { CARD_KINDS, validateCard, type CardKind } from "@/lib/study-card-parse";
import { cardCounts, cardView, cursorTsSql, decodeCursor, encodeCursor, findSourceLog, invalidCard, likePattern } from "@/lib/study-cards";

// Kho thẻ: danh sách (lọc + phân trang) kèm số đếm theo giai đoạn; thêm một thẻ.
export const GET = withAuth(async (req, userId) => {
  // Tham số rỗng (?topic=) coi như không có.
  const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = listCardsQuerySchema.safeParse(raw);
  if (!parsed.success) return invalidBody(parsed.error);
  const { subjectId, stage, topic, q, limit } = parsed.data;
  if (parsed.data.kind !== undefined && !(CARD_KINDS as readonly string[]).includes(parsed.data.kind)) return badRequest("invalid_kind");
  const cursor = parsed.data.cursor !== undefined ? decodeCursor(parsed.data.cursor) : undefined;
  if (cursor === null) return badRequest("invalid_cursor");

  const subject = await findOwnedSubject(db, subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  const rows = await db
    .select({ card: getTableColumns(studyCards), ts: cursorTsSql })
    .from(studyCards)
    .where(
      and(
        eq(studyCards.userId, userId),
        eq(studyCards.subjectId, subject.id),
        stage ? eq(studyCards.stage, stage) : undefined,
        parsed.data.kind ? eq(studyCards.kind, parsed.data.kind as CardKind) : undefined,
        topic ? sql`${topic.trim().toLowerCase()} = any(${studyCards.topics})` : undefined,
        q ? or(ilike(studyCards.phrase, likePattern(q)), ilike(studyCards.meaning, likePattern(q))) : undefined,
        cursor ? sql`(${studyCards.createdAt}, ${studyCards.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined
      )
    )
    .orderBy(desc(studyCards.createdAt), desc(studyCards.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);

  return NextResponse.json({
    cards: page.map((r) => cardView(r.card)),
    counts: await cardCounts(db, userId, subject.id),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].ts, page[page.length - 1].card.id) : null,
  });
});

export const POST = withAuth(async (req, userId) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = createCardSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;

  const valid = validateCard(d);
  if (!valid.ok) return invalidCard(valid.errors);

  const subject = await findOwnedSubject(db, d.subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });
  if (d.logId !== undefined) {
    const found = await findSourceLog(db, d.logId, userId, subject.id);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.error === "log_not_found" ? 404 : 400 });
  }

  return guardStudy(async () => {
    // Thẻ mới: stage NEW, dueAt null (mặc định của bảng). Trùng (môn, phrase_key) → không chèn → 409.
    const [row] = await db
      .insert(studyCards)
      .values({ ...valid.card, userId, subjectId: subject.id, sourceLogId: d.logId ?? null })
      .onConflictDoNothing({ target: [studyCards.subjectId, studyCards.phraseKey] })
      .returning();
    if (!row) return NextResponse.json({ error: "duplicate_phrase" }, { status: 409 });
    return NextResponse.json(cardView(row), { status: 201 });
  });
});
