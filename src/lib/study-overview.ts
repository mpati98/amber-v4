import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";

// Tổng quan Học tập: tuần này + từng môn. Hàm thuần — test ở study-overview.test.ts. Route chỉ tải dữ liệu.

// ----- Tiện ích lịch dùng chung (study-schedule, study-stats) -----

/** Số ngày giữa hai ngày lịch "YYYY-MM-DD" (b − a). */
export function dayDiff(a: string, b: string): number {
  const n = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;
  return n(b) - n(a);
}

/** Mọi ngày trong [from, to] (gồm cả hai đầu), tăng dần. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** Thứ Hai của tuần chứa [date] (tuần = thứ Hai–Chủ nhật). */
export function mondayOf(date: string): string {
  return addDaysIso(date, 1 - isoWeekday(date));
}

/** Tuần chứa [today]: thứ Hai → Chủ nhật. */
export function weekBounds(today: string): { start: string; end: string } {
  const start = mondayOf(today);
  return { start, end: addDaysIso(start, 6) };
}

/** Phút cần học mỗi ngày còn lại để đủ mục tiêu tuần; 0 nếu đã đủ. */
export function suggestedPerDay(remainingMinutes: number, remainingDays: number): number {
  return remainingMinutes <= 0 || remainingDays <= 0 ? 0 : Math.ceil(remainingMinutes / remainingDays);
}

type QueueCourse = { status: string; queuePosition: number | null; deltaDays: number | null };

/** Hàng học của môn: ACTIVE trước, rồi QUEUED theo queue_position. */
export function studyQueue<C extends QueueCourse>(courses: C[]): C[] {
  const rank = (c: C) => (c.status === "ACTIVE" ? 0 : 1);
  return courses
    .filter((c) => c.status === "ACTIVE" || c.status === "QUEUED")
    .sort((a, b) => rank(a) - rank(b) || (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity));
}

/** deltaDays của khóa cuối hàng học có cả baseline và forecast; null nếu không có. */
export function lastQueueDelta(courses: QueueCourse[]): number | null {
  const queue = studyQueue([...courses]);
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].deltaDays !== null) return queue[i].deltaDays;
  return null;
}

// ----- Tổng quan -----

export type OverviewCourse = QueueCourse & {
  id: string;
  title: string;
  nextSection: { id: string; title: string } | null;
};

export type OverviewInput<C extends OverviewCourse> = {
  today: string;
  /** Theo thứ tự hiển thị (position). */
  subjects: { id: string; name: string; dailyGoalMinutes: number | null }[];
  /** subjectId → ngày → phút (phủ ít nhất tuần hiện tại). */
  totals: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** subjectId → số buổi hôm nay. */
  todayLogCounts: ReadonlyMap<string, number>;
  /** subjectId → lý do hôm nay. */
  todayReasons: ReadonlyMap<string, { code: string; text: string | null }>;
  /** Mọi khóa của từng môn (dạng courseView). */
  coursesBySubject: ReadonlyMap<string, C[]>;
};

export function buildOverview<C extends OverviewCourse>(input: OverviewInput<C>) {
  const { today, subjects, totals, todayLogCounts, todayReasons, coursesBySubject } = input;
  const { start, end } = weekBounds(today);
  const weekDates = datesBetween(start, end);
  const minutesOn = (subjectId: string, d: string) => totals.get(subjectId)?.get(d) ?? 0;

  // Chỉ môn có mục tiêu ngày mới tính vào mục tiêu tuần.
  const goalSubjects = subjects.filter((s) => s.dailyGoalMinutes !== null);
  const dailyGoal = goalSubjects.reduce((n, s) => n + (s.dailyGoalMinutes ?? 0), 0);
  const days = weekDates.map((date) => {
    const minutes = goalSubjects.reduce((n, s) => n + minutesOn(s.id, date), 0);
    // done: MỌI môn có mục tiêu đều đủ phần của mình trong ngày (không cộng gộp giữa các môn).
    const done = goalSubjects.length > 0 && goalSubjects.every((s) => minutesOn(s.id, date) >= (s.dailyGoalMinutes ?? 0));
    return { date, minutes, goalMinutes: dailyGoal, done };
  });
  const weekMinutes = days.reduce((n, d) => n + d.minutes, 0);
  const weekGoal = dailyGoal * 7;
  const remainingMinutes = Math.max(0, weekGoal - weekMinutes);
  const remainingDays = dayDiff(today, end) + 1;

  return {
    today,
    week: {
      start,
      end,
      goalMinutes: weekGoal,
      minutes: weekMinutes,
      remainingMinutes,
      remainingDays,
      suggestedPerDay: suggestedPerDay(remainingMinutes, remainingDays),
      days,
      bySubject: goalSubjects.map((s) => ({
        subjectId: s.id,
        name: s.name,
        goalMinutes: (s.dailyGoalMinutes ?? 0) * 7,
        minutes: weekDates.reduce((n, d) => n + minutesOn(s.id, d), 0),
      })),
    },
    subjects: subjects.map((s) => {
      const courses = coursesBySubject.get(s.id) ?? [];
      const queue = studyQueue([...courses]);
      const active = queue.find((c) => c.status === "ACTIVE") ?? null;
      const nextCourse = (active?.nextSection ? active : null) ?? queue.find((c) => c.status === "QUEUED" && c.nextSection) ?? null;
      const minutes = minutesOn(s.id, today);
      return {
        subjectId: s.id,
        name: s.name,
        goalMinutes: s.dailyGoalMinutes,
        today: {
          minutes,
          logCount: todayLogCounts.get(s.id) ?? 0,
          done: s.dailyGoalMinutes !== null && minutes >= s.dailyGoalMinutes,
          reason: todayReasons.get(s.id) ?? null,
        },
        next: nextCourse?.nextSection
          ? { courseId: nextCourse.id, courseTitle: nextCourse.title, sectionId: nextCourse.nextSection.id, sectionTitle: nextCourse.nextSection.title }
          : null,
        activeCourse: active,
        counts: {
          QUEUED: courses.filter((c) => c.status === "QUEUED").length,
          DONE: courses.filter((c) => c.status === "DONE").length,
          WISHLIST: courses.filter((c) => c.status === "WISHLIST").length,
        },
        vsBaseline: lastQueueDelta(courses),
      };
    }),
  };
}
