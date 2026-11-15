// Validate đầu vào Sức khoẻ (check-in trưa/tối, debuff) — dùng chung route + test.
// Sáng: giấc ngủ ở /api/du-an/sleep, debuff mới ở /api/du-an/debuffs. Bỏ lỡ check-in không bị phạt (kinh tế dùng giá trị trung tính).
import { z } from "zod";
import { dateString } from "@/lib/project-input";
import { sleepDateError } from "@/lib/sleep-input";
import { vnToday } from "@/lib/vn-time";

const minutes = z.number().int().min(0).max(1440).nullable().optional();

// Mỗi mốc chỉ nhận đúng trường của nó (trường thừa bị từ chối).
// Trưa: tự chấm thể lực 1–5 (lưu lại; hiệu chỉnh thể lực theo điểm này làm sau).
// Tối: phút tập, phút thể thao, ngày nghỉ hợp lệ.
export const checkInSchema = z.discriminatedUnion("slot", [
  z.object({ date: dateString, slot: z.literal("noon"), staminaSelf: z.number().int().min(1).max(5) }).strict(),
  z
    .object({ date: dateString, slot: z.literal("evening"), exerciseMinutes: minutes, sportMinutes: minutes, restDay: z.boolean().optional() })
    .strict(),
]);
export type CheckInInput = z.infer<typeof checkInSchema>;

export const checkInSlot = z.enum(["noon", "evening"]);

/** Cùng cửa sổ với giấc ngủ: 60 ngày trước tới hôm nay (lịch VN). */
export const checkInDateError = sleepDateError;

/** Giá trị ghi DB: trường không thuộc mốc để null; ghi lại cùng mốc là thay toàn bộ. */
export function checkInValues(c: CheckInInput) {
  return c.slot === "noon"
    ? { staminaSelf: c.staminaSelf, exerciseMinutes: null, sportMinutes: null, restDay: false }
    : { staminaSelf: null, exerciseMinutes: c.exerciseMinutes ?? null, sportMinutes: c.sportMinutes ?? null, restDay: c.restDay ?? false };
}

export type CheckInRow = {
  date: string;
  slot: string;
  staminaSelf: number | null;
  exerciseMinutes: number | null;
  sportMinutes: number | null;
  restDay: boolean;
  updatedAt: Date;
};
export const checkInJson = (r: CheckInRow) => ({
  date: r.date,
  slot: r.slot,
  staminaSelf: r.staminaSelf,
  exerciseMinutes: r.exerciseMinutes,
  sportMinutes: r.sportMinutes,
  restDay: r.restDay,
  updatedAt: r.updatedAt.toISOString(),
});

// ===== Debuff =====
export const DEBUFF_LEVELS = ["light", "medium", "heavy"] as const;
const isoDateTime = z.iso.datetime({ offset: true });

export const debuffCreateSchema = z
  .object({ level: z.enum(DEBUFF_LEVELS), label: z.string().trim().max(255).nullable().optional(), startedAt: isoDateTime.optional() })
  .strict();

export const debuffPatchSchema = z
  .object({
    level: z.enum(DEBUFF_LEVELS).optional(),
    label: z.string().trim().max(255).nullable().optional(),
    // null = mở lại (còn hiệu lực); bỏ trống = không đổi.
    endedAt: isoDateTime.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "empty patch" });

const MAX_BACK_MS = 60 * 86_400_000;

/** Mốc thời gian hợp lệ: bắt đầu không ở tương lai, không quá 60 ngày; kết thúc không trước bắt đầu, không ở tương lai. */
export function debuffTimeError(startedAt: Date, endedAt: Date | null, now: Date): "future_start" | "too_old" | "ended_before_started" | "future_end" | null {
  if (startedAt.getTime() > now.getTime()) return "future_start";
  if (now.getTime() - startedAt.getTime() > MAX_BACK_MS) return "too_old";
  if (endedAt) {
    if (endedAt.getTime() < startedAt.getTime()) return "ended_before_started";
    if (endedAt.getTime() > now.getTime()) return "future_end";
  }
  return null;
}

const MAX_SKEW_MS = 5 * 60_000;

/** App gửi "bây giờ" theo đồng hồ máy: lệch tới 5 phút về tương lai thì coi là bây giờ của server (không báo future_*). */
export function clampClockSkew(at: Date, now: Date): Date {
  const ahead = at.getTime() - now.getTime();
  return ahead > 0 && ahead <= MAX_SKEW_MS ? now : at;
}

/** Ngày VN sớm nhất mà sổ cái phải dựng lại khi debuff đổi (mọi mốc cũ + mới). */
export function debuffChangedFrom(...times: Array<Date | null | undefined>): string {
  const ms = times.filter((t): t is Date => t instanceof Date).map((t) => t.getTime());
  return vnToday(new Date(Math.min(...ms)));
}

export type DebuffRow = { id: string; level: string; label: string | null; startedAt: Date; endedAt: Date | null };
export const debuffJson = (r: DebuffRow, now: Date) => ({
  id: r.id,
  level: r.level,
  label: r.label,
  startedAt: r.startedAt.toISOString(),
  endedAt: r.endedAt?.toISOString() ?? null,
  active: r.startedAt.getTime() <= now.getTime() && (r.endedAt == null || r.endedAt.getTime() > now.getTime()),
});
