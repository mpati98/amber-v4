import { isoWeekday } from "@/lib/routine-stats";
import { datesBetween } from "@/lib/study-overview";
import type { ForecastDay } from "@/lib/study-forecast";
import { dayNeedsReason } from "@/lib/study-pending";

// Lịch học của một môn: quá khứ (đã học) + hôm nay + kế hoạch dự báo. Hàm thuần — test ở study-schedule.test.ts.

export type ScheduleCourse = {
  id: string;
  title: string;
  status: string;
  baselineFinishDate: string | null;
  forecastFinishDate: string | null;
  deltaDays: number | null;
  /** Ngày (giờ VN) khóa xong, chỉ có khi DONE. */
  finishedDate: string | null;
};

export type ScheduleLog = {
  id: string;
  logDate: string;
  courseTitle: string | null;
  minutes: number;
  sections: { title: string; markedDone: boolean }[];
};

export type ScheduleInput = {
  today: string;
  from: string;
  to: string;
  goalMinutes: number | null;
  /** Ngày tạo môn (giờ VN): ngày trước đó không nợ lý do. Mặc định: không giới hạn. */
  subjectCreatedDate?: string;
  /** Routine STUDY chưa lưu trữ của môn (nếu có): thêm ràng buộc ngày tạo routine và thứ đến hạn. */
  routine?: { createdDate: string; weekdays: number[] } | null;
  reviewWeekdays: number[];
  /** ngày → tổng phút (trong [from, to]). */
  totals: ReadonlyMap<string, number>;
  reasons: ReadonlyMap<string, { code: string; text: string | null }>;
  logs: ScheduleLog[];
  courses: ScheduleCourse[];
  /** Kết quả forecast bắt đầu từ hôm nay; truyền [] khi khoảng nằm hoàn toàn trong quá khứ. */
  forecastDays: ForecastDay[];
};

export function buildSchedule(input: ScheduleInput) {
  const { today, from, to, goalMinutes, reviewWeekdays, totals, reasons, logs, courses, forecastDays, subjectCreatedDate, routine } = input;
  // Không giới hạn 14 ngày như pendingReasonDates; chỉ chặn trước ngày tạo môn / routine.
  const notBefore = [subjectCreatedDate, routine?.createdDate].filter((d): d is string => !!d).sort().at(-1);
  const titleOf = new Map(courses.map((c) => [c.id, c.title]));
  const plannedByDate = new Map(forecastDays.map((d) => [d.date, d.items]));
  const live = courses.filter((c) => c.status === "ACTIVE" || c.status === "QUEUED");

  let minutesTotal = 0;
  let plannedMinutes = 0;

  const days = datesBetween(from, to).map((date) => {
    const kind = date < today ? ("past" as const) : date === today ? ("today" as const) : ("planned" as const);
    const isReviewDay = reviewWeekdays.includes(isoWeekday(date));
    const base = { date, kind, isReviewDay, goalMinutes };

    // Cột mốc: khóa xong thật (finished_at) ở quá khứ/hôm nay; khóa dự kiến xong từ hôm nay trở đi.
    const milestones = [
      ...(kind !== "planned" ? courses.filter((c) => c.status === "DONE" && c.finishedDate === date) : []),
      ...(kind !== "past" ? live.filter((c) => c.forecastFinishDate === date) : []),
    ].map((c) => ({ courseId: c.id, courseTitle: c.title, type: "finish" as const }));

    const planned = (plannedByDate.get(date) ?? []).map((i) => ({
      courseId: i.courseId,
      courseTitle: titleOf.get(i.courseId) ?? "",
      sectionId: i.sectionId,
      title: i.title,
      minutes: i.minutes,
    }));

    if (kind === "planned") {
      plannedMinutes += planned.reduce((n, i) => n + i.minutes, 0);
      return { ...base, needsReason: false, plannedItems: isReviewDay ? [] : planned, milestones };
    }

    const minutes = totals.get(date) ?? 0;
    minutesTotal += minutes;
    const dayLogs = logs.filter((l) => l.logDate === date).map((l) => ({ id: l.id, courseTitle: l.courseTitle, minutes: l.minutes, sections: l.sections }));
    const past = {
      ...base,
      minutes,
      done: goalMinutes !== null && minutes >= goalMinutes,
      needsReason:
        kind === "past" && dayNeedsReason({ date, goalMinutes, minutes, hasReason: reasons.has(date), notBefore, weekdays: routine?.weekdays }),
      extraMinutes: goalMinutes === null ? 0 : Math.max(0, minutes - goalMinutes),
      reason: reasons.get(date) ?? null,
      logs: dayLogs,
      milestones,
    };
    if (kind === "past") return past;

    // Hôm nay: chỉ còn kế hoạch khi chưa có buổi nào (forecast đã tự bắt đầu từ ngày mai nếu hôm nay có log).
    if (dayLogs.length > 0) return past;
    const items = isReviewDay ? [] : planned;
    plannedMinutes += items.reduce((n, i) => n + i.minutes, 0);
    return { ...past, plannedItems: items };
  });

  return {
    days,
    summary: {
      minutes: minutesTotal,
      plannedMinutes,
      vsBaseline: live.map((c) => ({
        courseId: c.id,
        courseTitle: c.title,
        status: c.status,
        baselineFinishDate: c.baselineFinishDate,
        forecastFinishDate: c.forecastFinishDate,
        deltaDays: c.deltaDays,
      })),
    },
  };
}

/** Ngày cuối của khoảng cần chạy forecast: không cần nếu cả khoảng nằm trong quá khứ. */
export function needsForecast(today: string, to: string): boolean {
  return to >= today;
}

