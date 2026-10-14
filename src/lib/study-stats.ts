import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";
import { datesBetween, dayDiff, lastQueueDelta, mondayOf } from "@/lib/study-overview";

// Thống kê học tập theo khoảng. Hàm thuần — test ở study-stats.test.ts. Route chỉ tải dữ liệu.

/** Khoảng dài hơn số ngày này (chỉ với range=all) thì gom theo tuần. */
export const WEEK_BUCKET_THRESHOLD_DAYS = 92;
export const REVIEW_COURSE_TITLE = "Ôn tập";

export type StatsRange = "7" | "30" | "all";

export type StatsLog = { subjectId: string; courseId: string | null; courseTitle: string | null; logDate: string; minutes: number };
export type StatsCourse = {
  id: string;
  subjectId: string;
  title: string;
  status: string;
  queuePosition: number | null;
  progressPct: number;
  baselineFinishDate: string | null;
  forecastFinishDate: string | null;
  /** Ngày (giờ VN) khóa xong, chỉ có khi DONE. */
  finishedDate: string | null;
  deltaDays: number | null;
};

export type StatsInput = {
  today: string;
  range: StatsRange;
  /** Các môn trong phạm vi thống kê. */
  subjects: { id: string; dailyGoalMinutes: number | null }[];
  /** Log nằm trong khoảng (đã lọc theo môn). */
  logs: StatsLog[];
  /** Ngày log đầu tiên từ trước tới nay của từng môn (không bị cắt theo khoảng). */
  firstLogDates: ReadonlyMap<string, string>;
  reasons: { subjectId: string; date: string; code: string }[];
  courses: StatsCourse[];
};

/** Khóa ACTIVE/QUEUED: forecast − baseline; DONE: finishedDate − baseline; thiếu một vế → null. */
export function planDelta(c: Pick<StatsCourse, "status" | "baselineFinishDate" | "forecastFinishDate" | "finishedDate">): number | null {
  const end = c.status === "DONE" ? c.finishedDate : c.forecastFinishDate;
  return end && c.baselineFinishDate ? dayDiff(c.baselineFinishDate, end) : null;
}

/** Khoảng thống kê [from, to]; range=all bắt đầu từ log đầu tiên, không có log → chỉ hôm nay. */
export function statsBounds(today: string, range: StatsRange, firstLogDates: Iterable<string>): { from: string; to: string } {
  if (range === "7") return { from: addDaysIso(today, -6), to: today };
  if (range === "30") return { from: addDaysIso(today, -29), to: today };
  const first = [...firstLogDates].sort()[0];
  return { from: first ?? today, to: today };
}

export function buildStats(input: StatsInput) {
  const { today, range, subjects, logs, firstLogDates, reasons, courses } = input;
  const { from, to } = statsBounds(today, range, firstLogDates.values());
  const numDays = dayDiff(from, to) + 1;

  // range=all mà chưa có log nào: không có khoảng thật để vẽ → series rỗng.
  const noHistory = range === "all" && logs.length === 0;
  const totalMinutes = logs.reduce((n, l) => n + l.minutes, 0);

  // phút theo môn → ngày
  const bySubjectDay = new Map<string, Map<string, number>>();
  const byDay = new Map<string, number>();
  for (const l of logs) {
    const m = bySubjectDay.get(l.subjectId) ?? new Map<string, number>();
    m.set(l.logDate, (m.get(l.logDate) ?? 0) + l.minutes);
    bySubjectDay.set(l.subjectId, m);
    byDay.set(l.logDate, (byDay.get(l.logDate) ?? 0) + l.minutes);
  }

  // Chỉ môn có mục tiêu: tính từ ngày có log đầu tiên của môn; hôm nay chưa đủ thì chưa tính (còn cả ngày để học).
  let met = 0;
  let total = 0;
  for (const s of subjects) {
    if (s.dailyGoalMinutes === null) continue;
    const first = firstLogDates.get(s.id);
    if (!first) continue;
    for (const d of datesBetween(first > from ? first : from, to)) {
      const reached = (bySubjectDay.get(s.id)?.get(d) ?? 0) >= s.dailyGoalMinutes;
      if (d === today && !reached) continue;
      total++;
      if (reached) met++;
    }
  }

  const bucket: "day" | "week" = range === "all" && numDays > WEEK_BUCKET_THRESHOLD_DAYS ? "week" : "day";
  const dailyGoalSum = subjects.reduce((n, s) => n + (s.dailyGoalMinutes ?? 0), 0);
  const series: { start: string; minutes: number; goalMinutes: number }[] = [];
  if (!noHistory) {
    if (bucket === "day") {
      for (const d of datesBetween(from, to)) series.push({ start: d, minutes: byDay.get(d) ?? 0, goalMinutes: dailyGoalSum });
    } else {
      const weeks = new Map<string, { minutes: number; days: number }>();
      for (const d of datesBetween(from, to)) {
        const w = mondayOf(d);
        const cur = weeks.get(w) ?? { minutes: 0, days: 0 };
        weeks.set(w, { minutes: cur.minutes + (byDay.get(d) ?? 0), days: cur.days + 1 });
      }
      for (const [start, v] of weeks) series.push({ start, minutes: v.minutes, goalMinutes: dailyGoalSum * v.days });
    }
  }

  const courseAgg = new Map<string | null, { title: string; minutes: number; logCount: number }>();
  for (const l of logs) {
    const cur = courseAgg.get(l.courseId) ?? { title: l.courseId === null ? REVIEW_COURSE_TITLE : (l.courseTitle ?? ""), minutes: 0, logCount: 0 };
    courseAgg.set(l.courseId, { ...cur, minutes: cur.minutes + l.minutes, logCount: cur.logCount + 1 });
  }
  const byCourse = [...courseAgg].map(([courseId, v]) => ({ courseId, ...v })).sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title));

  let longestDay: { date: string; minutes: number } | null = null;
  for (const [date, minutes] of byDay) {
    if (!longestDay || minutes > longestDay.minutes || (minutes === longestDay.minutes && date < longestDay.date)) longestDay = { date, minutes };
  }

  const byWeekday = new Map<number, number>();
  for (const [date, minutes] of byDay) byWeekday.set(isoWeekday(date), (byWeekday.get(isoWeekday(date)) ?? 0) + minutes);
  let topWeekday: { weekday: number; minutes: number } | null = null;
  for (const [weekday, minutes] of byWeekday) {
    if (!topWeekday || minutes > topWeekday.minutes || (minutes === topWeekday.minutes && weekday < topWeekday.weekday)) topWeekday = { weekday, minutes };
  }

  const reasonCounts = { BUSY: 0, TIRED: 0, AWAY: 0, OTHER: 0 };
  for (const r of reasons) if (r.date >= from && r.date <= to && r.code in reasonCounts) reasonCounts[r.code as keyof typeof reasonCounts]++;

  const vsPlan = courses
    .filter((c) => c.status === "ACTIVE" || c.status === "QUEUED" || c.status === "DONE")
    .map((c) => ({
      courseId: c.id,
      title: c.title,
      status: c.status,
      progressPct: c.progressPct,
      baselineFinishDate: c.baselineFinishDate,
      forecastFinishDate: c.forecastFinishDate,
      finishedDate: c.finishedDate,
      deltaDays: planDelta(c),
    }));

  const overallDeltaDays = subjects.map((s) => ({
    subjectId: s.id,
    deltaDays: lastQueueDelta(courses.filter((c) => c.subjectId === s.id).map((c) => ({ ...c, deltaDays: planDelta(c) }))),
  }));

  return {
    from,
    to,
    totalMinutes,
    logCount: logs.length,
    avgPerDay: Math.round(totalMinutes / numDays),
    goalDays: { met, total },
    bucket,
    series,
    byCourse,
    vsPlan,
    overallDeltaDays,
    longestDay,
    topWeekday,
    reasonCounts,
  };
}

/** Phần trăm tiến độ khóa theo phút (không có phút thì theo số phần); khóa DONE = 100. */
export function progressPct(status: string, p: { doneSections: number; totalSections: number; doneMinutes: number; totalMinutes: number }): number {
  if (status === "DONE") return 100;
  if (p.totalMinutes > 0) return Math.round((p.doneMinutes / p.totalMinutes) * 100);
  return p.totalSections > 0 ? Math.round((p.doneSections / p.totalSections) * 100) : 0;
}
