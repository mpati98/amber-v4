import { addDaysIso } from "@/lib/deadline-alert";
import { DEFAULT_REVIEW_WEEKDAYS, firstReviewDayOf, monthBoundsOfIso, nextReviewDay, quarterBoundsOfIso, vnDayStart, vnToday } from "@/lib/vn-time";

// Lịch ôn thẻ theo giai đoạn (mục 2 của kế hoạch thẻ từ vựng). Hàm thuần, mọi ngày theo giờ VN —
// test ở study-card-schedule.test.ts.

export type CardStage = "NEW" | "LEARNING" | "WEEKLY" | "MONTHLY" | "QUARTERLY";
export type CardRating = "NOT_YET" | "REVIEW_AGAIN" | "REMEMBERED";
export const CARD_RATINGS: readonly CardRating[] = ["NOT_YET", "REVIEW_AGAIN", "REMEMBERED"];

/** Chưa nhớ quay lại sau chừng này phút (vẫn là cùng một thẻ trong kế hoạch ngày). */
export const NOT_YET_DELAY_MINUTES = 5;

export type ScheduleCard = { stage: CardStage; dueAt: Date | null };
export type ScheduleInput = ScheduleCard & {
  rating: CardRating;
  now: Date;
  reviewWeekdays?: readonly number[];
  /** Ôn thêm (thẻ HARD/RANDOM): Đã nhớ không đổi giai đoạn và hạn. */
  isExtra?: boolean;
};
export type ScheduleResult = { stage: CardStage; dueAt: Date | null };

/** Ngày ôn đầu tiên của tháng dương lịch kế tiếp [today]. */
function firstReviewDayNextMonth(today: string, weekdays: readonly number[]): string {
  const next = monthBoundsOfIso(addDaysIso(monthBoundsOfIso(today).end, 1));
  return firstReviewDayOf(next.start, next.end, weekdays)!;
}

/** Ngày ôn đầu tiên của quý dương lịch kế tiếp [today]. */
function firstReviewDayNextQuarter(today: string, weekdays: readonly number[]): string {
  const next = quarterBoundsOfIso(addDaysIso(quarterBoundsOfIso(today).end, 1));
  return firstReviewDayOf(next.start, next.end, weekdays)!;
}

/** Giai đoạn mới và thời điểm đến hạn sau một lượt đánh giá. dueAt chỉ null khi thẻ giữ nguyên ở NEW (ôn thêm). */
export function scheduleCard(input: ScheduleInput): ScheduleResult {
  const { stage, rating, now, isExtra = false } = input;
  const weekdays = input.reviewWeekdays ?? DEFAULT_REVIEW_WEEKDAYS;
  const today = vnToday(now);

  if (rating === "NOT_YET") return { stage: "LEARNING", dueAt: new Date(now.getTime() + NOT_YET_DELAY_MINUTES * 60_000) };
  if (rating === "REVIEW_AGAIN") return { stage: "LEARNING", dueAt: vnDayStart(addDaysIso(today, 1)) };

  if (isExtra) return { stage, dueAt: input.dueAt };
  switch (stage) {
    case "NEW":
    case "LEARNING":
      return { stage: "WEEKLY", dueAt: vnDayStart(nextReviewDay(today, weekdays)) };
    case "WEEKLY":
      return { stage: "MONTHLY", dueAt: vnDayStart(firstReviewDayNextMonth(today, weekdays)) };
    case "MONTHLY":
    case "QUARTERLY":
      return { stage: "QUARTERLY", dueAt: vnDayStart(firstReviewDayNextQuarter(today, weekdays)) };
  }
}

/** Kết quả (giai đoạn + hạn) nếu chọn từng mức — server trả kèm mỗi thẻ để nút hiện đúng nhãn. */
export function nextFor(card: ScheduleCard, now: Date, reviewWeekdays?: readonly number[], isExtra = false): Record<CardRating, ScheduleResult> {
  const at = (rating: CardRating) => scheduleCard({ ...card, rating, now, reviewWeekdays, isExtra });
  return { NOT_YET: at("NOT_YET"), REVIEW_AGAIN: at("REVIEW_AGAIN"), REMEMBERED: at("REMEMBERED") };
}
