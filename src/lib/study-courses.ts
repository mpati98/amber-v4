import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, isNull, max, ne } from "drizzle-orm";
import { db } from "@/db";
import { studyCourseSections, studyCourses, studyLogs, studySubjects } from "@/db/schema";
import { forecast } from "@/lib/study-forecast";
import { vnToday } from "@/lib/vn-time";

// Logic dùng chung của khóa học Học tập (Trà Đình). Các hàm ghi nhận tx của db.transaction.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbLike = typeof db | Tx;

export type SubjectRow = typeof studySubjects.$inferSelect;
export type CourseRow = typeof studyCourses.$inferSelect;
export type SectionRow = typeof studyCourseSections.$inferSelect;
export type CourseStatus = CourseRow["status"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/** Lỗi nghiệp vụ ném trong transaction (rollback) rồi đổi thành {error: code} ở route. */
export class StudyError extends Error {
  constructor(
    public code: string,
    public status: number
  ) {
    super(code);
  }
}

/** Chạy [fn]; StudyError → JSON {error} đúng status, lỗi khác ném tiếp cho withApiError. */
export async function guardStudy(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StudyError) return NextResponse.json({ error: e.code }, { status: e.status });
    throw e;
  }
}

/** Dạng môn học API trả về. */
export const subjectView = (s: SubjectRow) => ({
  id: s.id,
  name: s.name,
  dailyGoalMinutes: s.dailyGoalMinutes,
  videoMinutesPerDay: s.videoMinutesPerDay,
  reviewWeekdays: [...s.reviewWeekdays].sort((a, b) => a - b),
  position: s.position,
  createdAt: s.createdAt,
});

export async function findOwnedSubject(dbx: DbLike, id: string, userId: string): Promise<SubjectRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await dbx.select().from(studySubjects).where(and(eq(studySubjects.id, id), eq(studySubjects.userId, userId)));
  return row ?? null;
}

export async function findOwnedCourse(dbx: DbLike, id: string, userId: string): Promise<CourseRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await dbx.select().from(studyCourses).where(and(eq(studyCourses.id, id), eq(studyCourses.userId, userId)));
  return row ?? null;
}

/** Thứ tự học của môn: ACTIVE trước, rồi QUEUED theo queue_position. */
function studyOrder(courses: CourseRow[]): CourseRow[] {
  const rank = (c: CourseRow) => (c.status === "ACTIVE" ? 0 : 1);
  const pos = (c: CourseRow) => c.queuePosition ?? Number.MAX_SAFE_INTEGER;
  return courses
    .filter((c) => c.status === "ACTIVE" || c.status === "QUEUED")
    .sort((a, b) => rank(a) - rank(b) || pos(a) - pos(b) || a.createdAt.getTime() - b.createdAt.getTime());
}

/** Dự báo của môn: khóa ACTIVE/QUEUED, chỉ tính phần chưa xong; bắt đầu từ ngày mai nếu hôm nay đã có log. */
export async function forecastSubject(dbx: DbLike, subject: SubjectRow) {
  const courses = studyOrder(await dbx.select().from(studyCourses).where(eq(studyCourses.subjectId, subject.id)));
  const sections = courses.length
    ? await dbx
        .select()
        .from(studyCourseSections)
        .where(and(inArray(studyCourseSections.courseId, courses.map((c) => c.id)), isNull(studyCourseSections.doneAt)))
        .orderBy(asc(studyCourseSections.position))
    : [];
  const today = vnToday();
  const [todayLog] = await dbx
    .select({ id: studyLogs.id })
    .from(studyLogs)
    .where(and(eq(studyLogs.subjectId, subject.id), eq(studyLogs.logDate, today)))
    .limit(1);
  return {
    courses,
    ...forecast({
      today,
      startFromTomorrow: !!todayLog,
      videoMinutesPerDay: subject.videoMinutesPerDay,
      reviewWeekdays: subject.reviewWeekdays,
      courses: courses.map((c) => ({
        id: c.id,
        sections: sections
          .filter((s) => s.courseId === c.id)
          .map((s) => ({ id: s.id, title: s.title, remainingMinutes: s.durationMinutes })),
      })),
    }),
  };
}

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

export type CourseView = ReturnType<typeof makeView>;

function makeView(c: CourseRow, sections: SectionRow[], forecastFinish: string | null) {
  const forecastFinishDate =
    c.status === "DONE" ? (c.finishedAt ? vnToday(c.finishedAt) : null) : c.status === "WISHLIST" ? null : forecastFinish;
  const done = sections.filter((s) => s.doneAt !== null);
  const next = [...sections].sort((a, b) => a.position - b.position).find((s) => s.doneAt === null);
  return {
    id: c.id,
    subjectId: c.subjectId,
    title: c.title,
    instructor: c.instructor,
    platform: c.platform,
    url: c.url,
    status: c.status,
    queuePosition: c.queuePosition,
    targetPrice: c.targetPrice,
    note: c.note,
    startedAt: c.startedAt,
    finishedAt: c.finishedAt,
    baselineFinishDate: c.baselineFinishDate,
    forecastFinishDate,
    deltaDays: forecastFinishDate && c.baselineFinishDate ? dayNumber(forecastFinishDate) - dayNumber(c.baselineFinishDate) : null,
    progress: {
      doneSections: done.length,
      totalSections: sections.length,
      doneMinutes: done.reduce((n, s) => n + s.durationMinutes, 0),
      totalMinutes: sections.reduce((n, s) => n + s.durationMinutes, 0),
    },
    nextSection: next ? { id: next.id, title: next.title } : null,
  };
}

export const sectionView = (s: SectionRow) => ({
  id: s.id,
  position: s.position,
  title: s.title,
  durationMinutes: s.durationMinutes,
  doneAt: s.doneAt,
  done: s.doneAt !== null,
});

/** courseView cho nhiều khóa (giữ thứ tự [courses]); mỗi môn chỉ dự báo 1 lần. */
export async function courseViews(dbx: DbLike, userId: string, courses: CourseRow[]) {
  if (courses.length === 0) return [];
  const subjectIds = [...new Set(courses.map((c) => c.subjectId))];
  const subjects = await dbx
    .select()
    .from(studySubjects)
    .where(and(eq(studySubjects.userId, userId), inArray(studySubjects.id, subjectIds)));
  const finishBySubject = new Map<string, Record<string, string | null>>();
  for (const s of subjects) finishBySubject.set(s.id, (await forecastSubject(dbx, s)).finishDates);

  const sections = await dbx
    .select()
    .from(studyCourseSections)
    .where(inArray(studyCourseSections.courseId, courses.map((c) => c.id)))
    .orderBy(asc(studyCourseSections.position));
  const byCourse = new Map<string, SectionRow[]>();
  for (const s of sections) byCourse.set(s.courseId, [...(byCourse.get(s.courseId) ?? []), s]);

  return courses.map((c) => makeView(c, byCourse.get(c.id) ?? [], finishBySubject.get(c.subjectId)?.[c.id] ?? null));
}

export async function courseView(dbx: DbLike, userId: string, course: CourseRow) {
  return (await courseViews(dbx, userId, [course]))[0];
}

/** Các phần của khóa theo position (dạng trả về cho client). */
export async function courseSections(dbx: DbLike, courseId: string) {
  const rows = await dbx.select().from(studyCourseSections).where(eq(studyCourseSections.courseId, courseId)).orderBy(asc(studyCourseSections.position));
  return rows.map(sectionView);
}

/** Danh sách courseView của môn theo thứ tự học (ACTIVE, QUEUED) — dùng cho rebaseline / move. */
export async function studyQueueViews(dbx: DbLike, userId: string, subjectId: string) {
  const rows = await dbx.select().from(studyCourses).where(eq(studyCourses.subjectId, subjectId));
  return courseViews(dbx, userId, studyOrder(rows));
}

/** Chốt ngày xong dự kiến làm mốc (baseline) cho khóa ACTIVE/QUEUED của môn. */
export async function snapshotBaselines(tx: DbLike, subjectId: string, opts: { overwrite: boolean }) {
  const [subject] = await tx.select().from(studySubjects).where(eq(studySubjects.id, subjectId));
  if (!subject) return;
  const { courses, finishDates } = await forecastSubject(tx, subject);
  for (const c of courses) {
    const date = finishDates[c.id] ?? null;
    if (opts.overwrite) {
      if (c.baselineFinishDate !== date) await tx.update(studyCourses).set({ baselineFinishDate: date }).where(eq(studyCourses.id, c.id));
    } else if (c.baselineFinishDate === null && date !== null) {
      await tx.update(studyCourses).set({ baselineFinishDate: date }).where(eq(studyCourses.id, c.id));
    }
  }
}

/** Môn đã có khóa ACTIVE thì khóa mới thêm / phần mới thêm cũng cần mốc; chưa học thì chờ khóa đầu vào ACTIVE. */
export async function snapshotBaselinesIfStarted(tx: DbLike, subjectId: string) {
  const [active] = await tx
    .select({ id: studyCourses.id })
    .from(studyCourses)
    .where(and(eq(studyCourses.subjectId, subjectId), eq(studyCourses.status, "ACTIVE")))
    .limit(1);
  if (active) await snapshotBaselines(tx, subjectId, { overwrite: false });
}

/** Đánh số lại hàng chờ 1..n theo thứ tự [orderedIds]. */
export async function renumberQueue(tx: DbLike, orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.update(studyCourses).set({ queuePosition: i + 1, updatedAt: new Date() }).where(eq(studyCourses.id, orderedIds[i]));
  }
}

/** Khóa QUEUED của môn theo hàng chờ. */
export async function queuedCourses(tx: DbLike, subjectId: string, exceptId?: string) {
  const rows = await tx
    .select()
    .from(studyCourses)
    .where(and(eq(studyCourses.subjectId, subjectId), eq(studyCourses.status, "QUEUED"), exceptId ? ne(studyCourses.id, exceptId) : undefined));
  return rows.sort(
    (a, b) =>
      (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
}

async function hasActive(tx: DbLike, subjectId: string, exceptId?: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: studyCourses.id })
    .from(studyCourses)
    .where(and(eq(studyCourses.subjectId, subjectId), eq(studyCourses.status, "ACTIVE"), exceptId ? ne(studyCourses.id, exceptId) : undefined))
    .limit(1);
  return !!row;
}

/** Môn chưa có ACTIVE: khóa QUEUED đứng đầu hàng lên ACTIVE (started_at = now), rồi chốt mốc cho khóa chưa có. */
async function promoteNextQueued(tx: DbLike, subjectId: string, now: Date) {
  if (await hasActive(tx, subjectId)) return;
  const [next] = await queuedCourses(tx, subjectId);
  if (!next) return;
  await tx
    .update(studyCourses)
    .set({ status: "ACTIVE", queuePosition: null, startedAt: now, updatedAt: now })
    .where(eq(studyCourses.id, next.id));
  await renumberQueue(tx, (await queuedCourses(tx, subjectId)).map((c) => c.id));
  await snapshotBaselines(tx, subjectId, { overwrite: false });
}

/**
 * Đồng bộ trạng thái khóa theo tiến độ các phần:
 * - ACTIVE có ≥1 phần và mọi phần đã xong → DONE, rồi khóa QUEUED đầu hàng lên ACTIVE.
 * - DONE mà có phần chưa xong (bỏ tick / thêm phần) → về ACTIVE nếu môn chưa có ACTIVE, ngược lại về đầu hàng chờ.
 */
export async function syncCourseCompletion(tx: DbLike, courseId: string) {
  const [course] = await tx.select().from(studyCourses).where(eq(studyCourses.id, courseId));
  if (!course) return;
  const sections = await tx.select({ doneAt: studyCourseSections.doneAt }).from(studyCourseSections).where(eq(studyCourseSections.courseId, courseId));
  const allDone = sections.length > 0 && sections.every((s) => s.doneAt !== null);
  const now = new Date();

  if (course.status === "ACTIVE" && allDone) {
    await tx.update(studyCourses).set({ status: "DONE", finishedAt: now, queuePosition: null, updatedAt: now }).where(eq(studyCourses.id, courseId));
    await promoteNextQueued(tx, course.subjectId, now);
  } else if (course.status === "DONE" && sections.length > 0 && !allDone) {
    if (!(await hasActive(tx, course.subjectId, courseId))) {
      await tx.update(studyCourses).set({ status: "ACTIVE", finishedAt: null, queuePosition: null, updatedAt: now }).where(eq(studyCourses.id, courseId));
    } else {
      await tx.update(studyCourses).set({ status: "QUEUED", finishedAt: null, updatedAt: now }).where(eq(studyCourses.id, courseId));
      await renumberQueue(tx, [courseId, ...(await queuedCourses(tx, course.subjectId, courseId)).map((c) => c.id)]);
    }
  }
}

/** Vị trí cuối hàng chờ của môn (max+1). */
async function nextQueuePosition(tx: DbLike, subjectId: string): Promise<number> {
  const [row] = await tx
    .select({ m: max(studyCourses.queuePosition) })
    .from(studyCourses)
    .where(and(eq(studyCourses.subjectId, subjectId), eq(studyCourses.status, "QUEUED"), isNotNull(studyCourses.queuePosition)));
  return (row?.m ?? 0) + 1;
}

/**
 * Giá trị cột cho khóa chuyển sang [status] (hoặc tạo mới với status đó). Ném StudyError active_exists
 * nếu môn đã có ACTIVE khác. [courseId] bỏ trống khi tạo mới.
 */
export async function statusColumns(
  tx: DbLike,
  subjectId: string,
  status: CourseStatus,
  current: { id: string; startedAt: Date | null } | null,
  now: Date
): Promise<Partial<typeof studyCourses.$inferInsert>> {
  switch (status) {
    case "ACTIVE":
      if (await hasActive(tx, subjectId, current?.id)) throw new StudyError("active_exists", 409);
      return { status, queuePosition: null, finishedAt: null, startedAt: current?.startedAt ?? now };
    case "QUEUED":
      return { status, queuePosition: await nextQueuePosition(tx, subjectId), finishedAt: null };
    case "WISHLIST":
      return { status, queuePosition: null, finishedAt: null };
    case "DONE":
      return { status, queuePosition: null, finishedAt: now };
  }
}

/** Sau khi đổi trạng thái: ACTIVE lần đầu → chốt mốc; ACTIVE/DONE xong thì khóa chờ đầu hàng lên thay. */
export async function afterStatusChange(tx: DbLike, subjectId: string, status: CourseStatus) {
  if (status === "ACTIVE") await snapshotBaselines(tx, subjectId, { overwrite: false });
  if (status === "DONE") await promoteNextQueued(tx, subjectId, new Date());
}
