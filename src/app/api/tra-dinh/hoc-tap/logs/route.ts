import { NextResponse } from "next/server";
import { and, between, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, studyCourses, studyLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { dateString } from "@/lib/project-input";
import { badRequest, createLogSchema, invalidBody, readJson } from "@/lib/study-input";
import { courseView, findOwnedCourse, findOwnedSubject, guardStudy, isUuid, StudyError } from "@/lib/study-courses";
import { applyDayRule, logViews, todaySummary, validateLogSections, writeLogSections } from "@/lib/study-logs";
import { vnToday } from "@/lib/vn-time";

const MAX_RANGE_DAYS = 400;
const ACTIVITY_VERB = { LESSON: "Học", CARD_REVIEW: "Ôn thẻ", PRACTICE: "Luyện AI" } as const;

/** Lỗi trùng unique của Postgres (23505), kể cả khi drizzle bọc lỗi gốc trong `cause`. */
function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (typeof x === "object" && x !== null ? (x as { code?: unknown }).code : undefined);
  return code(e) === "23505" || code((e as { cause?: unknown } | null)?.cause) === "23505";
}
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
  // Thiếu activity (app cũ) = LESSON. CARD_REVIEW / PRACTICE không gắn khóa và không có phần.
  const activity = d.activity ?? "LESSON";
  if (activity === "CARD_REVIEW") {
    if (d.courseId) return badRequest("card_review_no_course");
    if (d.sections !== undefined) return badRequest("card_review_no_sections");
  }
  if (activity === "PRACTICE") {
    if (d.courseId) return badRequest("practice_no_course");
    if (d.sections !== undefined) return badRequest("practice_no_sections");
  } else if (d.practiceSessionId !== undefined) {
    return badRequest("practice_session_only_practice");
  }

  const subject = await findOwnedSubject(db, d.subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  // Phiên chat phải là buổi luyện (projects.type = PRACTICE) của user; mỗi phiên chỉ ghi một lần.
  let practiceSessionId: string | null = null;
  if (d.practiceSessionId !== undefined) {
    const [session] = isUuid(d.practiceSessionId)
      ? await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, d.practiceSessionId), eq(projects.userId, userId), eq(projects.type, "PRACTICE")))
      : [];
    if (!session) return NextResponse.json({ error: "practice_session_not_found" }, { status: 404 });
    const [logged] = await db.select({ id: studyLogs.id }).from(studyLogs).where(eq(studyLogs.practiceSessionId, session.id)).limit(1);
    if (logged) return NextResponse.json({ error: "practice_already_logged" }, { status: 409 });
    practiceSessionId = session.id;
  }

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
        .values({ userId, subjectId: subject.id, courseId: course?.id ?? null, logDate: today, minutes: d.minutes, note: d.note || null, activity, practiceSessionId })
        .returning({ id: studyLogs.id })
        // Hai yêu cầu song song cùng phiên: bản ghi sau đụng unique index → trả 409 như kiểm tra ở trên.
        .catch((e: unknown) => {
          throw isUniqueViolation(e) && practiceSessionId ? new StudyError("practice_already_logged", 409) : e;
        });
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
      title: `${ACTIVITY_VERB[activity]} ${d.minutes} phút: ${subject.name}`,
      metadata: {
        logId: result.log.id,
        subjectId: subject.id,
        courseId: course?.id ?? null,
        minutes: d.minutes,
        ...(activity !== "LESSON" ? { activity } : {}),
        ...(practiceSessionId ? { practiceSessionId } : {}),
      },
    });
    if (result.completed && course) {
      logActivity({ userId, source: "TRA_DINH", action: "study_course.completed", title: `Hoàn thành khóa học: ${course.title}`, metadata: { courseId: course.id, subjectId: subject.id } });
    }
    return NextResponse.json({ log: result.log, today: result.today, course: result.course }, { status: 201 });
  });
});
