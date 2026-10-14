import { NextResponse } from "next/server";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { studyCourseSections, studyCourses } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { badRequest, invalidBody, putSectionsSchema, readJson } from "@/lib/study-input";
import { courseSections, courseView, findOwnedCourse, snapshotBaselinesIfStarted, syncCourseCompletion } from "@/lib/study-courses";

// Thay cả danh sách phần: có id → giữ done_at; không id → thêm mới; id cũ vắng mặt → xoá. Position đánh lại 0..n-1.
// Body: mảng [{id?, title, durationMinutes}] (hoặc {sections: [...]}).
export const PUT = withAuth(async (req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = putSectionsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const input = parsed.data;

  const keptIds = input.flatMap((s) => (s.id ? [s.id] : []));
  if (new Set(keptIds).size !== keptIds.length) return badRequest("duplicate_section_id");

  const result = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: studyCourseSections.id }).from(studyCourseSections).where(eq(studyCourseSections.courseId, course.id));
    const existingIds = new Set(existing.map((e) => e.id));
    if (keptIds.some((k) => !existingIds.has(k))) return "unknown_section" as const;

    // Xoá phần vắng mặt, rồi đẩy phần còn lại sang position âm tạm để unique (course_id, position) không vướng khi đánh lại.
    await tx
      .delete(studyCourseSections)
      .where(keptIds.length ? and(eq(studyCourseSections.courseId, course.id), notInArray(studyCourseSections.id, keptIds)) : eq(studyCourseSections.courseId, course.id));
    await tx.update(studyCourseSections).set({ position: sql`-1 - ${studyCourseSections.position}` }).where(eq(studyCourseSections.courseId, course.id));

    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      if (s.id) {
        await tx.update(studyCourseSections).set({ position: i, title: s.title, durationMinutes: s.durationMinutes }).where(eq(studyCourseSections.id, s.id));
      } else {
        await tx.insert(studyCourseSections).values({ courseId: course.id, position: i, title: s.title, durationMinutes: s.durationMinutes });
      }
    }
    await tx.update(studyCourses).set({ updatedAt: new Date() }).where(eq(studyCourses.id, course.id));
    await syncCourseCompletion(tx, course.id);
    await snapshotBaselinesIfStarted(tx, course.subjectId);

    const [fresh] = await tx.select().from(studyCourses).where(eq(studyCourses.id, course.id));
    return { ...(await courseView(tx, userId, fresh)), sections: await courseSections(tx, course.id) };
  });

  if (result === "unknown_section") return badRequest("unknown_section");
  return NextResponse.json(result);
});
