import { NextResponse } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { studyCardReviews, studyCards, studyCourses, studyLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest } from "@/lib/study-input";
import { findOwnedSubject } from "@/lib/study-courses";
import { buildInsights, HARD_GROUP_MIN_CARDS, lessonLabel, periodStart } from "@/lib/study-card-insights";
import { vnToday } from "@/lib/vn-time";

const DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

// Thống kê nhóm khó. HAI MỐC THỜI GIAN KHÁC NHAU:
// - totals (reviews, notYetRate, promotedToWeekly) chỉ tính các lượt ôn trong [days] ngày gần nhất (cả hôm nay, giờ VN);
// - byKind / byTopic / byLesson / hardestCards tính TÍCH LUỸ suốt đời thẻ (cột not_yet_count): thẻ đã từng Chưa nhớ vẫn
//   tính dù sau đó Đã nhớ và dù lượt Chưa nhớ nằm ngoài kỳ. Nhóm dưới ngưỡng minCards không được liệt kê.
export const GET = withAuth(async (req, userId) => {
  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subjectId");
  if (!subjectId) return badRequest("invalid_subject_id");
  const rawDays = sp.get("days");
  const days = rawDays === null ? 30 : DAYS[rawDays];
  if (days === undefined) return badRequest("invalid_days");

  const subject = await findOwnedSubject(db, subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  const cards = await db.select().from(studyCards).where(and(eq(studyCards.userId, userId), eq(studyCards.subjectId, subject.id)));
  const reviews = await db
    .select({ cardId: studyCardReviews.cardId, rating: studyCardReviews.rating, stageBefore: studyCardReviews.stageBefore, stageAfter: studyCardReviews.stageAfter })
    .from(studyCardReviews)
    .innerJoin(studyCards, eq(studyCards.id, studyCardReviews.cardId))
    .where(and(eq(studyCardReviews.userId, userId), eq(studyCards.userId, userId), eq(studyCards.subjectId, subject.id), gte(studyCardReviews.reviewedAt, periodStart(vnToday(), days))));

  // Nhãn buổi học nguồn: "dd/MM · tên khóa" (không khóa → "Ôn tập"). Thẻ không có buổi nguồn không tạo nhóm.
  const logIds = [...new Set(cards.flatMap((c) => (c.sourceLogId ? [c.sourceLogId] : [])))];
  const logs = logIds.length
    ? await db
        .select({ id: studyLogs.id, logDate: studyLogs.logDate, activity: studyLogs.activity, courseTitle: studyCourses.title })
        .from(studyLogs)
        .leftJoin(studyCourses, eq(studyCourses.id, studyLogs.courseId))
        .where(and(eq(studyLogs.userId, userId), inArray(studyLogs.id, logIds)))
    : [];

  const result = buildInsights({
    cards: cards.map((c) => ({ id: c.id, kind: c.kind, topics: c.topics, sourceLogId: c.sourceLogId, notYetCount: c.notYetCount, reviewCount: c.reviewCount })),
    reviews,
    lessonLabels: new Map(logs.map((l) => [l.id, lessonLabel(l.logDate, l.courseTitle, l.activity)])),
  });

  const byId = new Map(cards.map((c) => [c.id, c]));
  return NextResponse.json({
    days,
    minCards: HARD_GROUP_MIN_CARDS,
    totals: result.totals,
    byKind: result.byKind,
    byTopic: result.byTopic,
    byLesson: result.byLesson,
    hardestCards: result.hardestCards.map((h) => {
      const c = byId.get(h.cardId)!;
      return { id: c.id, phrase: c.phrase, meaning: c.meaning, example: c.example, note: c.note, kind: c.kind, topics: c.topics, notYetCount: c.notYetCount, reviewCount: c.reviewCount };
    }),
  });
});
