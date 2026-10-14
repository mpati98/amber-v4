import { NextResponse } from "next/server";
import { and, between, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { dateString } from "@/lib/project-input";
import { badRequest, createLogSchema, invalidBody, readJson } from "@/lib/study-input";
import { courseView, findOwnedCourse, findOwnedSubject, guardStudy, isUuid } from "@/lib/study-courses";
import { applyDayRule, logViews, todaySummary, validateLogSections, writeLogSections } from "@/lib/study-logs";
import { vnToday } from "@/lib/vn-time";

const MAX_RANGE_DAYS = 400;
const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

export const GET = withAuth(async (req, userId) => {
  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subjectId");
  if (subjectId !== null && !isUuid(subjectId)) return badRequest("invalid_subject_id");
  const from = dateString.safeParse(sp.get("from"));
  const to = dateString.safeParse(sp.get("to"));
  if (!from.success || !to.success) return badRequest("invalid_date");
  if (to.data < from.data) return badRequest("invalid_range");
  if (dayNumber(to.data) - dayNumber(from.data) + 1 > MAX_RANGE_DAYS) return badRequest("range_too_large");

  const rows = await db
    .select({ id: studyLogs.id })
    .from(studyLogs)
    .where(
      and(
        eq(studyLogs.userId, userId),
        between(studyLogs.logDate, from.data, to.data),
        subjectId ? eq(studyLogs.subjectId, subjectId) : undefined
      )
    )
    .orderBy(desc(studyLogs.logDate), desc(studyLogs.createdAt), desc(studyLogs.id));
  return NextResponse.json(await logViews(db, rows.map((r) => r.id)));
});

// Ghi một buổi học HÔM NAY (log_date luôn là vnToday(), không nhận ngày từ client).
export const POST = withAuth(async (req, userId) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = createLogSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;

  const subject = await findOwnedSubject(db, d.subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  let course = null;
  if (d.courseId) {
    course = await findOwnedCourse(db, d.courseId, userId);
    if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 });
    if (course.subjectId !== subject.id) return badRequest("course_not_in_subject");
  }
  const sections = d.sections ?? [];
  const sectionError = await validateLogSections(db, course?.id ?? null, sections);
  if (sectionError) return badRequest(sectionError);

  return guardStudy(async () => {
    const today = vnToday();
    const result = await db.transaction(async (tx) => {
      const [log] = await tx
        .insert(studyLogs)
        .values({ userId, subjectId: subject.id, courseId: course?.id ?? null, logDate: today, minutes: d.minutes, note: d.note || null })
        .returning({ id: studyLogs.id });
      await writeLogSections(tx, log.id, course?.id ?? null, sections);
      await applyDayRule(tx, userId, subject, today, d.stopForToday);

      const [freshCourse] = course ? await tx.select().from(studyCourses).where(eq(studyCourses.id, course.id)) : [null];
      return {
        log: (await logViews(tx, [log.id]))[0],
        today: await todaySummary(tx, subject, today),
        course: freshCourse ? await courseView(tx, userId, freshCourse) : null,
        completed: !!course && course.status !== "DONE" && freshCourse?.status === "DONE",
      };
    });

    logActivity({
      userId,
      source: "TRA_DINH",
      action: "study_log.created",
      title: `Học ${d.minutes} phút: ${subject.name}`,
      metadata: { logId: result.log.id, subjectId: subject.id, courseId: course?.id ?? null, minutes: d.minutes },
    });
    if (result.completed && course) {
      logActivity({ userId, source: "TRA_DINH", action: "study_course.completed", title: `Hoàn thành khóa học: ${course.title}`, metadata: { courseId: course.id, subjectId: subject.id } });
    }
    return NextResponse.json({ log: result.log, today: result.today, course: result.course }, { status: 201 });
  });
});
