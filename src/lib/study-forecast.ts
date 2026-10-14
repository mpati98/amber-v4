import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";

// Dự báo ngày xong của các khóa học của một môn. Hàm thuần — test ở study-forecast.test.ts.

/** Số ngày lịch tối đa dò tới; vượt thì khóa chưa xong có finishDate null. */
export const FORECAST_MAX_DAYS = 1100;

export type ForecastSection = { id: string; title: string; remainingMinutes: number };
export type ForecastCourse = { id: string; sections: ForecastSection[] };
export type ForecastItem = { courseId: string; sectionId: string; title: string; minutes: number };
export type ForecastDay = { date: string; items: ForecastItem[] };
export type ForecastResult = { days: ForecastDay[]; finishDates: Record<string, string | null> };

/**
 * Xếp lần lượt các phần chưa xong của [courses] (đã sắp theo thứ tự học) vào từng ngày, mỗi ngày
 * [videoMinutesPerDay] phút, bỏ các ngày có thứ thuộc [reviewWeekdays] (1 = thứ Hai … 7 = Chủ nhật).
 * Phần 0 phút gắn vào ngày hiện tại mà không tốn phút. Khóa không còn phần nào → finishDate null.
 */
export function forecast(input: {
  today: string;
  startFromTomorrow: boolean;
  videoMinutesPerDay: number;
  reviewWeekdays: number[];
  courses: ForecastCourse[];
}): ForecastResult {
  const { videoMinutesPerDay, reviewWeekdays, courses } = input;
  const first = input.startFromTomorrow ? addDaysIso(input.today, 1) : input.today;
  const lastDate = addDaysIso(first, FORECAST_MAX_DAYS - 1);

  const finishDates: Record<string, string | null> = {};
  const days: ForecastDay[] = [];
  for (const c of courses) finishDates[c.id] = null;

  const isStudyDay = (d: string) => !reviewWeekdays.includes(isoWeekday(d));
  // Ngày học đầu tiên từ [from] trở đi, null nếu vượt giới hạn.
  const nextStudyDay = (from: string): string | null => {
    for (let d = from; d <= lastDate; d = addDaysIso(d, 1)) if (isStudyDay(d)) return d;
    return null;
  };

  if (videoMinutesPerDay <= 0) return { days, finishDates };

  let date = nextStudyDay(first);
  let capLeft = videoMinutesPerDay;
  let current: ForecastDay | null = null;
  const push = (item: ForecastItem) => {
    if (!current || current.date !== date) {
      current = { date: date!, items: [] };
      days.push(current);
    }
    current.items.push(item);
  };

  outer: for (const course of courses) {
    for (const section of course.sections) {
      let remaining = section.remainingMinutes;
      if (remaining <= 0) {
        if (date === null) break outer;
        push({ courseId: course.id, sectionId: section.id, title: section.title, minutes: 0 });
      }
      while (remaining > 0) {
        if (date === null) break outer;
        if (capLeft === 0) {
          date = nextStudyDay(addDaysIso(date, 1));
          capLeft = videoMinutesPerDay;
          continue;
        }
        const take = Math.min(capLeft, remaining);
        push({ courseId: course.id, sectionId: section.id, title: section.title, minutes: take });
        capLeft -= take;
        remaining -= take;
      }
      // Phần vừa xếp xong ở ngày đang đứng; phần cuối cùng của khóa quyết định ngày xong. Vượt giới hạn thì
      // `break outer` ở trên, finishDate của khóa đang dở giữ null.
      finishDates[course.id] = date;
    }
  }

  return { days, finishDates };
}
