import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, invalidBody, passwordBodySchema, readJson } from "@/lib/study-input";
import { passwordFailureResponse, verifyPasswordWithLockout } from "@/lib/password-guard";
import { findOwnedCourse } from "@/lib/study-courses";

// Xoá HẲN khóa đã nằm trong Thùng rác (bắt buộc mật khẩu). Phần xoá theo (cascade); buổi học giữ lại với course_id = null; thẻ và tài liệu không đụng.
export const DELETE = withAuth(async (req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const course = await findOwnedCourse(db, id, userId, { includeDeleted: true });
  if (!course || !course.deletedAt) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = passwordBodySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const failure = passwordFailureResponse(await verifyPasswordWithLockout(userId, parsed.data.password));
  if (failure) return failure;

  await db.delete(studyCourses).where(and(eq(studyCourses.id, course.id), eq(studyCourses.userId, userId)));
  logActivity({ userId, source: "TRA_DINH", action: "study_course.purged", title: `Xoá hẳn khóa học: ${course.title}`, metadata: { courseId: course.id, subjectId: course.subjectId } });
  return NextResponse.json({ ok: true });
});
