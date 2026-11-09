import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentType } from "@/db/schema";
import { documentJson } from "@/lib/study-course-note";
import { stringifyTags } from "@/lib/tags";
import { withAuth } from "@/lib/withAuth";

const CONTENT_TYPES = ["TEXT", "CHECKLIST", "MINDMAP"];
const ATTACHMENT_TYPES = ["IMAGE", "FILE"];

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const topicId = searchParams.get("topicId");
  const pinned = searchParams.get("pinned");
  const search = searchParams.get("search");

  const conditions = [
    type ? eq(documents.type, type as (typeof documentType.enumValues)[number]) : undefined,
    topicId ? eq(documents.topicId, topicId) : undefined,
    pinned === "true" ? eq(documents.pinned, true) : undefined,
    search ? or(like(documents.title, `%${search}%`), like(documents.content, `%${search}%`)) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const items = await db.query.documents.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: { topic: true, studyCourse: { columns: { title: true } } },
    orderBy: desc(documents.updatedAt),
  });

  return NextResponse.json(items.map(documentJson));
});

export const POST = withAuth(async (req) => {
  const body = await req.json();
  const { title, type, content, attachmentUrl, tags, pinned, sourceUrl, topicId } = body;

  if (!title || !type) {
    return NextResponse.json({ error: "title and type are required" }, { status: 400 });
  }
  if (CONTENT_TYPES.includes(type) && !content?.trim()) {
    return NextResponse.json({ error: `content is required for type ${type}` }, { status: 400 });
  }
  if (ATTACHMENT_TYPES.includes(type) && !attachmentUrl) {
    return NextResponse.json({ error: `attachmentUrl is required for type ${type}` }, { status: 400 });
  }

  // Không nhận studyCourseId từ client: chỉ route courses/[id]/note-document được gắn tài liệu với khóa.
  // ID mới dùng UUID, dữ liệu cũ có thể còn dạng cuid từ Prisma — không ảnh hưởng vì cột là text
  const [created] = await db
    .insert(documents)
    .values({
      id: randomUUID(),
      title,
      type,
      content: content || null,
      attachmentUrl: attachmentUrl || null,
      tags: stringifyTags(tags || []),
      pinned: !!pinned,
      sourceUrl: sourceUrl || null,
      topicId: topicId || null,
      // Prisma @updatedAt tự set lúc create — không có DB default nên phải set tay ở đây
      updatedAt: new Date().toISOString(),
    })
    .returning();

  const item = await db.query.documents.findFirst({
    where: eq(documents.id, created.id),
    with: { topic: true, studyCourse: { columns: { title: true } } },
  });

  return NextResponse.json(documentJson(item!));
});
