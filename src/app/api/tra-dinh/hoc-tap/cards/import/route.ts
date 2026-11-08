import { NextResponse } from "next/server";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, importCardsSchema, invalidBody, readJson } from "@/lib/study-input";
import { findOwnedSubject, guardStudy } from "@/lib/study-courses";
import { parseCards } from "@/lib/study-card-parse";
import { findSourceLog } from "@/lib/study-cards";

// Nhập hàng loạt (tối đa 100). Mọi thẻ được kiểm tra lại ở server: có thẻ lỗi → 400, không lưu gì.
// Thẻ lặp trong đầu vào hoặc đã có trong môn thì bỏ qua không báo lỗi; ON CONFLICT DO NOTHING trên
// (subject_id, phrase_key) giữ đúng cả khi hai lần nhập chạy song song.
export const POST = withAuth(async (req, userId) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = importCardsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;

  const subject = await findOwnedSubject(db, d.subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });
  if (d.logId !== undefined) {
    const found = await findSourceLog(db, d.logId, userId, subject.id);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.error === "log_not_found" ? 404 : 400 });
  }

  const result = parseCards(d.cards);
  if (result.errors.length > 0) return NextResponse.json({ error: "invalid_cards", errors: result.errors }, { status: 400 });

  return guardStudy(async () => {
    // Một giao dịch dùng chung now() nên gán created_at tăng dần theo thứ tự nhập: hàng thẻ mới xếp theo thứ tự tạo.
    const base = Date.now();
    const created = await db.transaction(async (tx) =>
      tx
        .insert(studyCards)
        .values(
          result.cards.map((c, i) => ({
            userId,
            subjectId: subject.id,
            sourceLogId: d.logId ?? null,
            phrase: c.phrase,
            phraseKey: c.phraseKey,
            meaning: c.meaning,
            example: c.example,
            note: c.note,
            pronunciation: c.pronunciation,
            kind: c.kind,
            topics: c.topics,
            createdAt: new Date(base + i),
          }))
        )
        .onConflictDoNothing({ target: [studyCards.subjectId, studyCards.phraseKey] })
        .returning({ id: studyCards.id })
    );
    const out = { created: created.length, skipped: d.cards.length - created.length };

    await logActivity({
      userId,
      source: "TRA_DINH",
      action: "study_card.imported",
      title: `Nhập ${out.created} thẻ từ vựng: ${subject.name}`,
      metadata: { subjectId: subject.id, logId: d.logId ?? null, ...out },
    });
    return NextResponse.json(out, { status: 201 });
  });
});
