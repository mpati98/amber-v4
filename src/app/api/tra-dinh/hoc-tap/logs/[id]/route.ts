import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyLogs, studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, invalidBody, patchLogSchema, readJson } from "@/lib/study-input";
import { courseView, guardStudy, isUuid } from "@/lib/study-courses";
import { applyDayRule, logViews, todaySummary, validateLogSections, writeLogSections } from "@/lib/study-logs";
import { vnToday } from "@/lib/vn-time";

type RouteParams = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "log_not_found" }, { status: 404 });

async function findOwnedLog(id: string, userId: string) {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(studyLogs).where(and(eq(studyLogs.id, id), eq(studyLogs.userId, userId)));
  if (!row) return null;
  const [subject] = await db.select().from(studySubjects).where(eq(studySubjects.id, row.subjectId));
  return subject ? { log: row, subject } : null;
}

// Chỉ sửa được log của HÔM NAY. sections thay cả danh sách; markDone set done_at nếu đang null,
// bỏ markDone KHÔNG xoá done_at của phần.
export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const found = await findOwnedLog(id, userId);
  if (!found) return notFound();
  const { log, subject } = found;
  const today = vnToday();
  if (log.logDate !== today) return badRequest("not_today");

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = patchLogSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;
  if (Object.keys(d).length === 0) return badRequest("empty_patch");

  if (d.sections !== undefined) {
    const sectionError = await validateLogSections(db, log.courseId, d.sections);
    if (sectionError) return badRequest(sectionError);
  }

  return guardStudy(async () => {
    const result = await db.transaction(async (tx) => {
      const [course] = log.courseId ? await tx.select().from(studyCourses).where(eq(studyCourses.id, log.courseId)) : [null];
      await tx
        .update(studyLogs)
        .set({
          ...(d.minutes !== undefined ? { minutes: d.minutes } : {}),
          ...(d.note !== undefined ? { note: d.note || null } : {}),
        })
        .where(eq(studyLogs.id, log.id));
      if (d.sections !== undefined) await writeLogSections(tx, log.id, log.courseId, d.sections);
      await applyDayRule(tx, userId, subject, today, d.stopForToday);

      const [freshCourse] = log.courseId ? await tx.select().from(studyCourses).where(eq(studyCourses.id, log.courseId)) : [null];
      return {
        log: (await logViews(tx, [log.id]))[0],
        today: await todaySummary(tx, subject, today),
        course: freshCourse ? await courseView(tx, userId, freshCourse) : null,
        completed: !!course && course.status !== "DONE" && freshCourse?.status === "DONE",
      };
    });
    if (result.completed && log.courseId) {
      logActivity({ userId, source: "TRA_DINH", action: "study_course.completed", title: "Hoàn thành khóa học", metadata: { courseId: log.courseId, subjectId: subject.id } });
    }
    return NextResponse.json({ log: result.log, today: result.today, course: result.course });
  });
});

// Chỉ xoá log của HÔM NAY; phần đã tick (done_at) giữ nguyên.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const found = await findOwnedLog(id, userId);
  if (!found) return notFound();
  const { log, subject } = found;
  const today = vnToday();
  if (log.logDate !== today) return badRequest("not_today");

  await db.delete(studyLogs).where(eq(studyLogs.id, log.id));
  logActivity({ userId, source: "TRA_DINH", action: "study_log.deleted", title: `Xoá buổi học: ${subject.name}`, metadata: { logId: log.id, subjectId: subject.id } });
  return NextResponse.json({ ok: true, today: await todaySummary(db, subject, today) });
});
