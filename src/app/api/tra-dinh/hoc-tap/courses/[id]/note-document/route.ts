import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { findOwnedCourse } from "@/lib/study-courses";
import { documentJson, noteDocumentContent, noteDocumentTitle } from "@/lib/study-course-note";
import { stringifyTags } from "@/lib/tags";

const readNote = (courseId: string) =>
  db.query.documents.findFirst({
    where: eq(documents.studyCourseId, courseId),
    with: { topic: true, studyCourse: { columns: { title: true } } },
  });

// "Ghi chú khóa": lần đầu tạo tài liệu TEXT gắn khóa (201), các lần sau trả đúng tài liệu đó (200). Khóa đã xoá mềm / của người khác → 404.
// Đồng thời: chỉ mục duy nhất một phần documents(study_course_id) + INSERT ... ON CONFLICT DO NOTHING, rồi đọc lại — request thua cuộc trả tài liệu đã có (200).
export const POST = withAuth(async (_req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  const existing = await readNote(course.id);
  if (existing) return NextResponse.json(documentJson(existing));

  const now = new Date().toISOString();
  // Cùng cách điền trường như projects/[id]/close: id UUID, tags JSON, updatedAt phải gán tay.
  const inserted = await db
    .insert(documents)
    .values({
      id: randomUUID(),
      title: noteDocumentTitle(course.title),
      type: "TEXT",
      content: noteDocumentContent(course.title),
      attachmentUrl: null,
      tags: stringifyTags(["khoa-hoc", "ghi-chu"]),
      pinned: false,
      sourceUrl: null,
      topicId: null,
      studyCourseId: course.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: documents.id });

  const item = await readNote(course.id);
  if (!item) throw new Error("note document missing after insert"); // không xảy ra: hoặc ta vừa tạo, hoặc request song song đã tạo
  if (inserted.length === 0) return NextResponse.json(documentJson(item));

  logActivity({ userId, source: "TRA_DINH", action: "study_course.note_created", title: `Tạo ghi chú khóa học: ${course.title}`, metadata: { courseId: course.id, documentId: item.id } });
  return NextResponse.json(documentJson(item), { status: 201 });
});
