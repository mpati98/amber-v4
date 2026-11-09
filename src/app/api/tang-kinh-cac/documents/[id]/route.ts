import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { documentJson } from "@/lib/study-course-note";
import { stringifyTags } from "@/lib/tags";
import { withAuth } from "@/lib/withAuth";

export const GET = withAuth(async (_req, _userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const item = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    with: { topic: true, studyCourse: { columns: { title: true } } },
  });
  if (!item) return NextResponse.json({ error: "document_not_found" }, { status: 404 });
  return NextResponse.json(documentJson(item));
});

export const PATCH = withAuth(async (req, _userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  // studyCourseId (nếu client gửi) bị bỏ qua: không đổi gắn khóa của tài liệu qua route này.
  const { title, content, attachmentUrl, tags, pinned, sourceUrl, topicId } = body;

  const [updated] = await db
    .update(documents)
    .set({
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content: content || null } : {}),
      ...(attachmentUrl !== undefined ? { attachmentUrl: attachmentUrl || null } : {}),
      ...(tags !== undefined ? { tags: stringifyTags(tags) } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(sourceUrl !== undefined ? { sourceUrl: sourceUrl || null } : {}),
      ...(topicId !== undefined ? { topicId: topicId || null } : {}),
      // Prisma @updatedAt tự bump trên MỌI update, kể cả khi field khác rỗng — giữ đúng hành vi
      updatedAt: new Date().toISOString(),
    })
    .where(eq(documents.id, id))
    .returning();

  // Prisma.update ném lỗi khi id không tồn tại -> withApiError bắt -> 500. Giữ đúng hành vi cũ,
  // không đổi thành 404 dù đó không phải REST convention lý tưởng.
  if (!updated) {
    throw new Error("document not found");
  }

  const item = await db.query.documents.findFirst({
    where: eq(documents.id, id),
    with: { topic: true, studyCourse: { columns: { title: true } } },
  });

  return NextResponse.json(documentJson(item!));
});

export const DELETE = withAuth(async (_req, _userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const [deleted] = await db.delete(documents).where(eq(documents.id, id)).returning();

  // Cùng lý do như PATCH — giữ đúng hành vi 500 khi không tìm thấy, không đổi thành 404.
  if (!deleted) {
    throw new Error("document not found");
  }

  return NextResponse.json({ success: true });
});
