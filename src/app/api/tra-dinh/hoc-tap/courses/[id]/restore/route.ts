import { NextResponse } from "next/server";
import { db } from "@/db";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { courseView, findOwnedCourse, restoreCourse } from "@/lib/study-courses";
import { trashCutoff } from "@/lib/study-trash";
import { and, eq } from "drizzle-orm";
import { studyCourses } from "@/db/schema";

// Khôi phục khóa trong Thùng rác (không cần mật khẩu). ACTIVE/QUEUED → QUEUED cuối hàng chờ; WISHLIST, DONE giữ nguyên.
export const POST = withAuth(async (_req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId, { includeDeleted: true });
  if (!course || !course.deletedAt) return NextResponse.json({ error: "course_not_found" }, { status: 404 });
  if (course.deletedAt < trashCutoff(new Date())) return NextResponse.json({ error: "course_not_found" }, { status: 404 }); // quá hạn, chờ dọn lười

  const view = await db.transaction(async (tx) => {
    await restoreCourse(tx, course, new Date());
    const [fresh] = await tx.select().from(studyCourses).where(and(eq(studyCourses.id, course.id), eq(studyCourses.userId, userId)));
    return courseView(tx, userId, fresh);
  });
  logActivity({ userId, source: "TRA_DINH", action: "study_course.restored", title: `Khôi phục khóa học: ${course.title}`, metadata: { courseId: course.id, subjectId: course.subjectId } });
  return NextResponse.json(view);
});
