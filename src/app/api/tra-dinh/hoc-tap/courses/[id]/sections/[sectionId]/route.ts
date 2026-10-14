import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { studyCourseSections, studyCourses } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, invalidBody, readJson } from "@/lib/study-input";
import { courseSections, courseView, findOwnedCourse, isUuid, syncCourseCompletion } from "@/lib/study-courses";

// Tick / bỏ tick một phần; khóa ACTIVE xong hết phần → DONE (khóa chờ đầu hàng lên ACTIVE).
export const PATCH = withAuth(async (req, userId, { params }: { params: Promise<{ id: string; sectionId: string }> }) => {
  const { id, sectionId } = await params;
  const course = await findOwnedCourse(db, id, userId);
  if (!course || !isUuid(sectionId)) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = z.object({ done: z.boolean() }).safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const result = await db.transaction(async (tx) => {
    const [section] = await tx
      .select()
      .from(studyCourseSections)
      .where(and(eq(studyCourseSections.id, sectionId), eq(studyCourseSections.courseId, course.id)));
    if (!section) return null;

    await tx
      .update(studyCourseSections)
      .set({ doneAt: parsed.data.done ? (section.doneAt ?? new Date()) : null })
      .where(eq(studyCourseSections.id, section.id));
    await syncCourseCompletion(tx, course.id);

    const [fresh] = await tx.select().from(studyCourses).where(eq(studyCourses.id, course.id));
    return { fresh, view: { ...(await courseView(tx, userId, fresh)), sections: await courseSections(tx, course.id) } };
  });
  if (!result) return NextResponse.json({ error: "section_not_found" }, { status: 404 });

  if (course.status !== "DONE" && result.fresh.status === "DONE") {
    logActivity({ userId, source: "TRA_DINH", action: "study_course.completed", title: `Hoàn thành khóa học: ${course.title}`, metadata: { courseId: course.id, subjectId: course.subjectId } });
  }
  return NextResponse.json(result.view);
});
