import { NextResponse } from "next/server";
import { db } from "@/db";
import { withAuth } from "@/lib/withAuth";
import { findOwnedSubject, snapshotBaselines, studyQueueViews } from "@/lib/study-courses";

// Chốt lại ngày xong dự kiến hiện tại làm mốc mới cho mọi khóa ACTIVE/QUEUED của môn.
export const POST = withAuth(async (_req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const subject = await findOwnedSubject(db, id, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  await db.transaction((tx) => snapshotBaselines(tx, subject.id, { overwrite: true }));
  return NextResponse.json(await studyQueueViews(db, userId, subject.id));
});
