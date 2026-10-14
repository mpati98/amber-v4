import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, invalidBody, patchCourseSchema, readJson } from "@/lib/study-input";
import {
  afterStatusChange,
  courseSections,
  courseView,
  findOwnedCourse,
  guardStudy,
  queuedCourses,
  renumberQueue,
  statusColumns,
} from "@/lib/study-courses";
import { logViews } from "@/lib/study-logs";

type RouteParams = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "course_not_found" }, { status: 404 });

export const GET = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course) return notFound();

  // 10 buổi gần nhất của khóa, cùng dạng GET /logs (kèm các phần đã học trong buổi).
  const recentIds = await db
    .select({ id: studyLogs.id })
    .from(studyLogs)
    .where(and(eq(studyLogs.courseId, course.id), eq(studyLogs.userId, userId)))
    .orderBy(desc(studyLogs.logDate), desc(studyLogs.createdAt))
    .limit(10);
  const recentLogs = await logViews(db, recentIds.map((r) => r.id));

  return NextResponse.json({
    ...(await courseView(db, userId, course)),
    sections: await courseSections(db, course.id),
    recentLogs,
  });
});

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course) return notFound();

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = patchCourseSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;
  if (Object.keys(d).length === 0) return badRequest("empty_patch");

  return guardStudy(async () => {
    const view = await db.transaction(async (tx) => {
      const now = new Date();
      const statusChanged = d.status !== undefined && d.status !== course.status;
      await tx
        .update(studyCourses)
        .set({
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.instructor !== undefined ? { instructor: d.instructor } : {}),
          ...(d.platform !== undefined ? { platform: d.platform } : {}),
          ...(d.url !== undefined ? { url: d.url } : {}),
          ...(d.targetPrice !== undefined ? { targetPrice: d.targetPrice } : {}),
          ...(d.note !== undefined ? { note: d.note } : {}),
          ...(statusChanged ? await statusColumns(tx, course.subjectId, d.status!, course, now) : {}),
          updatedAt: now,
        })
        .where(eq(studyCourses.id, course.id));
      if (statusChanged) {
        // Rời hàng chờ để lại lỗ trống → đánh số lại 1..n.
        await renumberQueue(tx, (await queuedCourses(tx, course.subjectId)).map((c) => c.id));
        await afterStatusChange(tx, course.subjectId, d.status!);
      }
      const [fresh] = await tx.select().from(studyCourses).where(eq(studyCourses.id, course.id));
      return courseView(tx, userId, fresh);
    });
    return NextResponse.json(view);
  });
});

// Xoá khóa: phần xoá theo (cascade); log giữ lại với course_id = null.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course) return notFound();
  await db.delete(studyCourses).where(and(eq(studyCourses.id, course.id), eq(studyCourses.userId, userId)));
  logActivity({ userId, source: "TRA_DINH", action: "study_course.deleted", title: `Xoá khóa học: ${course.title}`, metadata: { courseId: course.id, subjectId: course.subjectId } });
  return NextResponse.json({ ok: true });
});
