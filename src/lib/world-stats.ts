// Chỉ số 0–100 của màn chủ 3D (Âm Dương Giới) — hàm thuần, không đụng DB (lib/world-summary.ts nạp dữ liệu).
// Công thức tạm (15/11/2026), chủ dự án sẽ chỉnh sau; mỗi chỉ số trả kèm `src` mô tả nguồn để bảng chi tiết hiện ra.

export type WorldStat = { v: number | null; src: string; sample?: boolean };
export type WorldStatKey = "sinhLuc" | "nganKho" | "triThuc" | "kyNang" | "heThong";

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Giấc ngủ: 7–9 giờ = 100; ít hơn giảm tuyến tính về 0 ở 3 giờ; quá 9 giờ trừ nhẹ (tối đa −30 ở 12 giờ). Chất lượng 1–5 nhân 0,6–1,0. */
export function sleepScore(minutes: number, quality: number | null = null): number {
  const h = minutes / 60;
  let s = h >= 7 && h <= 9 ? 100 : h < 7 ? ((h - 3) / 4) * 100 : 100 - Math.min(30, ((h - 9) / 3) * 30);
  if (quality != null) s *= 0.5 + quality * 0.1;
  return clamp(s);
}

/** Vận động: tổng phút buổi tập 7 ngày gần nhất so với 150 phút/tuần (khuyến nghị WHO). */
export function workoutScore(minutes7d: number): number {
  return clamp((minutes7d / 150) * 100);
}

/** Đêm mẫu dùng khi chưa ghi giấc ngủ 3 ngày gần nhất (chủ dự án: "dữ liệu để sample"). */
export const SAMPLE_SLEEP = { minutes: 7 * 60, quality: 3 } as const;

export function sinhLuc(input: {
  lastSleep: { date: string; minutes: number; quality: number | null } | null;
  today: string;
  workoutMinutes7d: number;
}): WorldStat {
  const daysAgo = input.lastSleep ? daysBetween(input.lastSleep.date, input.today) : Infinity;
  const fresh = input.lastSleep && daysAgo <= 2 ? input.lastSleep : null;
  const sleep = fresh ?? SAMPLE_SLEEP;
  const v = clamp(0.6 * sleepScore(sleep.minutes, sleep.quality) + 0.4 * workoutScore(input.workoutMinutes7d));
  const h = (sleep.minutes / 60).toFixed(1).replace(".", ",");
  const sleepTxt = fresh ? `ngủ ${h} giờ${daysAgo === 0 ? " đêm qua" : ` (${daysAgo} ngày trước)`}` : "giấc ngủ: mẫu, chưa ghi";
  return { v, src: `${sleepTxt} · vận động ${input.workoutMinutes7d} phút/7 ngày`, ...(fresh ? {} : { sample: true }) };
}

/** Ngân khố: phần ngân sách tháng còn lại (chỉ tính các danh mục có ngân sách). Chưa đặt ngân sách → null. */
export function nganKho(input: { limitTotal: number; spentInBudgeted: number; hasMonth: boolean }): WorldStat {
  if (!input.hasMonth) return { v: null, src: "Chưa bắt đầu tháng tài chính" };
  if (input.limitTotal <= 0) return { v: null, src: "Chưa đặt ngân sách tháng" };
  const left = 1 - input.spentInBudgeted / input.limitTotal;
  return { v: clamp(left * 100), src: `Ngân sách tháng còn ${clamp(left * 100)}%` };
}

/** Tri thức: số sách đọc được (sách đang đọc tính theo trang) so với nhịp cần có của mục tiêu năm tới hôm nay. */
export function triThuc(input: { targetBooks: number | null; finished: number; partial: number; dayOfYear: number; daysInYear: number }): WorldStat {
  if (!input.targetBooks) return { v: null, src: "Chưa đặt mục tiêu đọc năm" };
  const progress = input.finished + input.partial;
  const expected = Math.max((input.targetBooks * input.dayOfYear) / input.daysInYear, 0.25);
  return { v: clamp((progress / expected) * 100), src: `Đã đọc ${input.finished}/${input.targetBooks} cuốn trong năm` };
}

/** Kỹ năng: trung bình điểm 6 kỹ năng Trà Đình (bỏ kỹ năng chưa có điểm). */
export function kyNang(scores: Array<number | null>): WorldStat {
  const s = scores.filter((x): x is number => x != null);
  if (!s.length) return { v: null, src: "Chưa có điểm kỹ năng (làm bài test đầu vào ở Trà Đình)" };
  return { v: clamp(s.reduce((a, b) => a + b, 0) / s.length), src: `Trung bình ${s.length} kỹ năng tiếng Anh` };
}

/** Hệ thống: amber-brain đẩy nhật ký gần nhất ≤ 24 giờ = 100, sau đó mỗi ngày −15. Chưa từng đẩy → null. */
export function heThong(lastReceivedAt: Date | null, now: Date): WorldStat {
  if (!lastReceivedAt) return { v: null, src: "amber-brain chưa gửi nhật ký nào" };
  const hours = (now.getTime() - lastReceivedAt.getTime()) / 3_600_000;
  const v = hours <= 24 ? 100 : clamp(100 - ((hours - 24) / 24) * 15);
  const ago = hours < 1 ? "dưới 1 giờ" : hours < 48 ? `${Math.round(hours)} giờ` : `${Math.round(hours / 24)} ngày`;
  return { v, src: `amber-brain gửi nhật ký ${ago} trước` };
}

export type WorldTower = "kieulau" | "tangkinh" | "tradinh" | "nghisu" | "center";
export type WorldEvent = { id: string; from: WorldTower; lvl: "info" | "ok" | "warn" | "bad"; text: string; at: string };

/** activity_logs.source → công trình. LEARN hiện chỉ do đánh giá nhật ký amber-brain (Tàng Kinh Các › Dữ liệu huấn luyện) ghi. */
export const SOURCE_TOWER: Record<string, WorldTower> = {
  DU_AN: "nghisu",
  FINANCE: "nghisu",
  LEARN: "tangkinh",
  TRA_DINH: "tradinh",
  KIEU_LAU: "kieulau",
  MUSIC: "kieulau",
};

export function activityEvent(row: { id: string; source: string; action: string; title: string; createdAt: Date }): WorldEvent {
  const lvl = /deleted|removed|archived/.test(row.action) ? "info" : "ok";
  return { id: row.id, from: SOURCE_TOWER[row.source] ?? "center", lvl, text: row.title, at: row.createdAt.toISOString() };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
