import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest, invalidBody, patchCardSchema, readJson } from "@/lib/study-input";
import { guardStudy } from "@/lib/study-courses";
import { validateCard } from "@/lib/study-card-parse";
import { cardView, findOwnedCard, invalidCard, isUniqueViolation } from "@/lib/study-cards";

type RouteParams = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "card_not_found" }, { status: 404 });
const duplicate = () => NextResponse.json({ error: "duplicate_phrase" }, { status: 409 });

export const GET = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const card = await findOwnedCard(db, id, userId);
  return card ? NextResponse.json(cardView(card)) : notFound();
});

// Chỉ sửa nội dung (phrase, meaning, example, note, kind, topics) và suspended. Môn, giai đoạn, hạn, số đếm
// không đổi được ở đây: khoá lạ trong body bị bỏ qua.
export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const card = await findOwnedCard(db, id, userId);
  if (!card) return notFound();

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = patchCardSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;
  if (Object.keys(d).length === 0) return badRequest("empty_patch");

  const set: Partial<typeof studyCards.$inferInsert> = {};
  if (d.suspended !== undefined) set.suspended = d.suspended;

  const touchesContent = ["phrase", "meaning", "example", "note", "kind", "topics"].some((k) => k in d);
  if (touchesContent) {
    // Kiểm tra cả thẻ sau khi gộp để luật nội dung (cụm ≥ 2 từ, tối đa 3 chủ đề...) áp dụng như lúc tạo.
    const valid = validateCard({ ...cardView(card), ...d });
    if (!valid.ok) return invalidCard(valid.errors);
    const c = valid.card;
    if (d.phrase !== undefined) {
      set.phrase = c.phrase;
      set.phraseKey = c.phraseKey;
    }
    if (d.meaning !== undefined) set.meaning = c.meaning;
    if (d.example !== undefined) set.example = c.example;
    if (d.note !== undefined) set.note = c.note;
    if (d.kind !== undefined) set.kind = c.kind;
    if (d.topics !== undefined) set.topics = c.topics;

    if (set.phraseKey !== undefined && set.phraseKey !== card.phraseKey) {
      const [clash] = await db
        .select({ id: studyCards.id })
        .from(studyCards)
        .where(and(eq(studyCards.subjectId, card.subjectId), eq(studyCards.phraseKey, set.phraseKey), ne(studyCards.id, card.id)));
      if (clash) return duplicate();
    }
  }

  return guardStudy(async () => {
    try {
      const [row] = await db.update(studyCards).set(set).where(and(eq(studyCards.id, card.id), eq(studyCards.userId, userId))).returning();
      return row ? NextResponse.json(cardView(row)) : notFound();
    } catch (e) {
      if (isUniqueViolation(e)) return duplicate(); // hai yêu cầu sửa song song cùng đổi thành một cụm
      throw e;
    }
  });
});

// Xoá thẻ: lượt ôn và mục kế hoạch ngày xoá theo (ON DELETE CASCADE).
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const card = await findOwnedCard(db, id, userId);
  if (!card) return notFound();
  await db.delete(studyCards).where(and(eq(studyCards.id, card.id), eq(studyCards.userId, userId)));
  return NextResponse.json({ ok: true });
});
