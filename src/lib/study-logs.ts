import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { studyCourseSections, studyCourses, studyDayReasons, studyLogSections, studyLogs } from "@/db/schema";
import { dayTotal } from "@/lib/study-days";
import { StudyError, syncCourseCompletion, type DbLike, type SubjectRow } from "@/lib/study-courses";

// Logic dùng chung của nhật ký học: dạng trả về, quy tắc tổng ngày / lý do, ghi phần của buổi.

export type LogSectionInput = { sectionId: string; markDone?: boolean };
export type StopForToday = { code: "BUSY" | "TIRED" | "AWAY" | "OTHER"; text?: string | null };

/** Dạng log API trả về, mới nhất trước theo thứ tự [logIds] đã sắp sẵn bởi nơi gọi. */
export async function logViews(dbx: DbLike, logIds: string[]) {
  if (logIds.length === 0) return [];
  const rows = await dbx
    .select({
      id: studyLogs.id,
      subjectId: studyLogs.subjectId,
      courseId: studyLogs.courseId,
      courseTitle: studyCourses.title,
      logDate: studyLogs.logDate,
      minutes: studyLogs.minutes,
      note: studyLogs.note,
      createdAt: studyLogs.createdAt,
    })
    .from(studyLogs)
    .leftJoin(studyCourses, eq(studyCourses.id, studyLogs.courseId))
    .where(inArray(studyLogs.id, logIds))
    .orderBy(desc(studyLogs.logDate), desc(studyLogs.createdAt), desc(studyLogs.id));
  const sections = await dbx
    .select({ logId: studyLogSections.logId, sectionId: studyLogSections.sectionId, title: studyCourseSections.title, markedDone: studyLogSections.markedDone, position: studyCourseSections.position })
    .from(studyLogSections)
    .innerJoin(studyCourseSections, eq(studyCourseSections.id, studyLogSections.sectionId))
    .where(inArray(studyLogSections.logId, logIds));
  return rows.map((r) => ({
    ...r,
    sections: sections
      .filter((s) => s.logId === r.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ sectionId: s.sectionId, title: s.title, markedDone: s.markedDone })),
  }));
}

/** Tổng hôm nay của môn: {minutes, goalMinutes, done, reason}. goal null → done = false. */
export async function todaySummary(dbx: DbLike, subject: SubjectRow, today: string) {
  const minutes = await dayTotal(dbx, subject.id, today);
  const [reason] = await dbx
    .select({ code: studyDayReasons.code, text: studyDayReasons.text })
    .from(studyDayReasons)
    .where(and(eq(studyDayReasons.subjectId, subject.id), eq(studyDayReasons.reasonDate, today)));
  return {
    minutes,
    goalMinutes: subject.dailyGoalMinutes,
    done: subject.dailyGoalMinutes !== null && minutes >= subject.dailyGoalMinutes,
    reason: reason ?? null,
  };
}

/** Ghi / sửa lý do một ngày; OTHER mà text rỗng → StudyError reason_text_required. */
export async function upsertReason(dbx: DbLike, userId: string, subjectId: string, date: string, code: StopForToday["code"], text: string | null | undefined) {
  const cleaned = text?.trim() || null;
  if (code === "OTHER" && !cleaned) throw new StudyError("reason_text_required", 400);
  await dbx
    .insert(studyDayReasons)
    .values({ userId, subjectId, reasonDate: date, code, text: cleaned })
    .onConflictDoUpdate({ target: [studyDayReasons.subjectId, studyDayReasons.reasonDate], set: { code, text: cleaned } });
}

/**
 * Áp quy tắc sau khi ghi/sửa log hôm nay: tổng ≥ goal → xoá lý do hôm nay, bỏ qua [stop];
 * tổng < goal và có [stop] → upsert lý do; goal null → bỏ qua [stop]. Ném StudyError để rollback cả log.
 */
export async function applyDayRule(dbx: DbLike, userId: string, subject: SubjectRow, today: string, stop: StopForToday | undefined) {
  const goal = subject.dailyGoalMinutes;
  if (goal === null) return;
  const total = await dayTotal(dbx, subject.id, today);
  if (total >= goal) {
    await dbx.delete(studyDayReasons).where(and(eq(studyDayReasons.subjectId, subject.id), eq(studyDayReasons.reasonDate, today)));
  } else if (stop) {
    await upsertReason(dbx, userId, subject.id, today, stop.code, stop.text);
  }
}

/** Mọi section phải thuộc [courseId], không trùng — lỗi trả mã để route đổi thành 400. */
export async function validateLogSections(dbx: DbLike, courseId: string | null, sections: LogSectionInput[]): Promise<string | null> {
  if (sections.length === 0) return null;
  if (!courseId) return "sections_without_course";
  const ids = sections.map((s) => s.sectionId);
  if (new Set(ids).size !== ids.length) return "duplicate_section";
  const found = await dbx
    .select({ id: studyCourseSections.id })
    .from(studyCourseSections)
    .where(and(eq(studyCourseSections.courseId, courseId), inArray(studyCourseSections.id, ids)));
  return found.length === ids.length ? null : "section_not_in_course";
}

/** Ghi study_log_sections của [logId] (thay cả danh sách); markDone → set done_at nếu đang null, rồi đồng bộ khóa. */
export async function writeLogSections(dbx: DbLike, logId: string, courseId: string | null, sections: LogSectionInput[]) {
  await dbx.delete(studyLogSections).where(eq(studyLogSections.logId, logId));
  if (sections.length === 0) return;
  await dbx.insert(studyLogSections).values(sections.map((s) => ({ logId, sectionId: s.sectionId, markedDone: s.markDone === true })));
  const toMark = sections.filter((s) => s.markDone).map((s) => s.sectionId);
  if (toMark.length > 0 && courseId) {
    await dbx
      .update(studyCourseSections)
      .set({ doneAt: new Date() })
      .where(and(inArray(studyCourseSections.id, toMark), isNull(studyCourseSections.doneAt)));
    await syncCourseCompletion(dbx, courseId);
  }
}
