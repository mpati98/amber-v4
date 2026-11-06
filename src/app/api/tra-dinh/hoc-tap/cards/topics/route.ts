import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCards } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest } from "@/lib/study-input";
import { findOwnedSubject } from "@/lib/study-courses";
import { countTopics } from "@/lib/study-card-insights";

// Các chủ đề đang có trong môn (để prompt cho Claude dùng lại chủ đề cũ). Đếm mọi thẻ, kể cả thẻ tạm dừng.
export const GET = withAuth(async (req, userId) => {
  const subjectId = req.nextUrl.searchParams.get("subjectId");
  if (!subjectId) return badRequest("invalid_subject_id");
  const subject = await findOwnedSubject(db, subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  const rows = await db.select({ topics: studyCards.topics }).from(studyCards).where(and(eq(studyCards.userId, userId), eq(studyCards.subjectId, subject.id)));
  return NextResponse.json({ topics: countTopics(rows) });
});
