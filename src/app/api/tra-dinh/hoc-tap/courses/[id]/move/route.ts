import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { withAuth } from "@/lib/withAuth";
import { badRequest, invalidBody, readJson } from "@/lib/study-input";
import { findOwnedCourse, queuedCourses, renumberQueue, studyQueueViews } from "@/lib/study-courses";

// Đổi chỗ khóa QUEUED với khóa kề trong hàng chờ; ở đầu/cuối thì giữ nguyên. Trả hàng học của môn (ACTIVE, QUEUED).
export const POST = withAuth(async (req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = z.object({ direction: z.enum(["up", "down"]) }).safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  if (course.status !== "QUEUED") return badRequest("not_queued");

  await db.transaction(async (tx) => {
    const ids = (await queuedCourses(tx, course.subjectId)).map((c) => c.id);
    const i = ids.indexOf(course.id);
    const j = parsed.data.direction === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    await renumberQueue(tx, ids);
  });
  return NextResponse.json(await studyQueueViews(db, userId, course.subjectId));
});
