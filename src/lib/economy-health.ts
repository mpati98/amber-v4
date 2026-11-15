// Sức khoẻ (nền chậm) và Thể lực (pin trong ngày) — hàm thuần theo mục 4 của đặc tả kinh tế.
// Ngày = lịch VN "YYYY-MM-DD". Thiếu dữ liệu một thành phần ⇒ dùng giá trị trung tính = nền hôm trước
// (nền giữ nguyên, không phạt vì bỏ lỡ check-in).

import { addDaysIso } from "@/lib/deadline-alert";
import { vnDayStart } from "@/lib/vn-time";
import type { RuleSetParams } from "@/lib/economy-rules";

export type DebuffLevel = "light" | "medium" | "heavy";
export type DebuffSpan = { level: DebuffLevel; startedAt: Date; endedAt: Date | null };

/** Đầu vào sức khoẻ của một ngày; trường null = không có dữ liệu. */
export type HealthDayInput = {
  sleepMinutes: number | null;
  sleepQuality: number | null; // 1–5
  exerciseMinutes: number | null;
  sportMinutes: number | null;
  restDay: boolean;
};

type HealthParams = RuleSetParams["health"];
type StaminaParams = RuleSetParams["stamina"];

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Điểm ngủ 0–100: 0,6 × điểm giờ + 0,4 × 20q. Thiếu chất lượng ⇒ chỉ dùng điểm giờ. */
export function sleepScore(hours: number, quality: number | null, p: HealthParams): number {
  const off = hours < p.sleep_ok_min_hours ? p.sleep_ok_min_hours - hours : hours > p.sleep_ok_max_hours ? hours - p.sleep_ok_max_hours : 0;
  const hourScore = Math.max(0, 100 - p.sleep_penalty_per_hour * off);
  if (quality == null) return hourScore;
  return p.sleep_hours_weight * hourScore + (1 - p.sleep_hours_weight) * (20 * quality);
}

/** Điểm vận động 0–100; ngày nghỉ hợp lệ ⇒ rest_day_score. Null nếu không có dữ liệu. */
export function activityScore(input: HealthDayInput, p: HealthParams): number | null {
  if (input.restDay) return p.rest_day_score;
  if (input.exerciseMinutes == null && input.sportMinutes == null) return null;
  const eq = (input.exerciseMinutes ?? 0) + p.sport_factor * (input.sportMinutes ?? 0);
  return Math.min(100, (eq / p.exercise_target_minutes) * 100);
}

export function debuffPenalty(spans: DebuffSpan[], at: Date, p: HealthParams): number {
  return spans
    .filter((d) => d.startedAt <= at && (d.endedAt == null || d.endedAt > at))
    .reduce((sum, d) => sum + p.debuff[d.level], 0);
}

export function debuffActiveAt(spans: DebuffSpan[], at: Date): boolean {
  return spans.some((d) => d.startedAt <= at && (d.endedAt == null || d.endedAt > at));
}

export const staminaMax = (health: number, p: StaminaParams) => p.base + p.per_health * health;

export type HealthDay = {
  date: string;
  sleepScore: number | null;
  activityScore: number | null;
  base: number; // nền đã làm mượt cuối ngày
  health: number; // nền − debuff còn hiệu lực lúc cuối ngày (00:00 VN hôm sau)
};

/**
 * Chuỗi Sức khoẻ từ `from` tới `to` (gồm cả hai đầu). Ngày trước `from` coi như nền = initial_base.
 * Một ngày thiếu thành phần nào thì thành phần đó lấy nền hôm trước (trung tính).
 */
export function buildHealthSeries(
  from: string,
  to: string,
  inputs: Map<string, HealthDayInput>,
  debuffs: DebuffSpan[],
  p: HealthParams,
): HealthDay[] {
  const out: HealthDay[] = [];
  let prev = p.initial_base;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const inp = inputs.get(d);
    const sleep = inp?.sleepMinutes != null ? sleepScore(inp.sleepMinutes / 60, inp.sleepQuality, p) : null;
    const act = inp ? activityScore(inp, p) : null;
    const dayScore = p.sleep_weight * (sleep ?? prev) + (1 - p.sleep_weight) * (act ?? prev);
    const base = p.smoothing * prev + (1 - p.smoothing) * dayScore;
    const endOfDay = vnDayStart(addDaysIso(d, 1));
    out.push({
      date: d,
      sleepScore: sleep == null ? null : round2(sleep),
      activityScore: act == null ? null : round2(act),
      base: round2(base),
      health: round2(Math.max(0, base - debuffPenalty(debuffs, endOfDay, p))),
    });
    prev = base;
  }
  return out;
}

/** Ngữ cảnh mỗi ngày mà bộ thi hành luật cần. */
export type DayContext = {
  /** Sức khoẻ chốt cuối ngày hôm trước — dùng cho biến `health` (vd thưởng +10%) và trần thể lực. */
  healthPrev: number;
  staminaMax: number;
  morningStamina: number;
};

export type EconomyContext = {
  day: (date: string) => DayContext;
  debuffActive: (at: Date) => boolean;
};

/** Ghép chuỗi sức khoẻ thành ngữ cảnh cho replay. `series` phải phủ từ trước ngày sớm nhất cần hỏi. */
export function buildEconomyContext(series: HealthDay[], debuffs: DebuffSpan[], params: RuleSetParams): EconomyContext {
  const byDate = new Map(series.map((h, i) => [h.date, { h, prev: i > 0 ? series[i - 1] : null }]));
  return {
    day(date) {
      const row = byDate.get(date);
      // Ngoài chuỗi: trước ngày đầu ⇒ nền khởi điểm; sau ngày cuối ⇒ Sức khoẻ ngày cuối.
      const after = !row && series.length > 0 && date > series[series.length - 1].date;
      const healthPrev = row ? row.prev?.health ?? params.health.initial_base : after ? series[series.length - 1].health : params.health.initial_base;
      const max = staminaMax(healthPrev, params.stamina);
      const prevBase = row ? row.prev?.base ?? params.health.initial_base : after ? series[series.length - 1].base : params.health.initial_base;
      const sleep = row?.h.sleepScore ?? prevBase;
      const ratio = Math.min(1, Math.max(params.stamina.morning_min_ratio, sleep / 100));
      return { healthPrev, staminaMax: round2(max), morningStamina: round2(max * ratio) };
    },
    debuffActive: (at) => debuffActiveAt(debuffs, at),
  };
}
