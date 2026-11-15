// Dòng dữ liệu thật → sự kiện kinh tế (thuần). eventId ổn định theo id của nguồn: sửa bản ghi ⇒ cùng eventId,
// sự kiện được cập nhật; xoá bản ghi ⇒ sự kiện biến mất khi đối soát.

import { vnToday } from "@/lib/vn-time";
import type { EconomyEvent } from "@/lib/economy-engine";
import { AMBER_TASK_PREFIX } from "@/lib/economy-tasks";

export const STUDY_LOG_PREFIX = "study-log";
export const ROUTINE_LOG_PREFIX = "routine-log";

/** Các tiền tố do đối soát quản lý (sự kiện mang tiền tố khác — vd "redeem:", "buy-card:" — không bao giờ bị đối soát xoá). */
export const MANAGED_PREFIXES = [`${AMBER_TASK_PREFIX}:`, `${AMBER_TASK_PREFIX}-occ:`, `${STUDY_LOG_PREFIX}:`, `${ROUTINE_LOG_PREFIX}:`] as const;

export const isManagedEventId = (eventId: string) => MANAGED_PREFIXES.some((p) => eventId.startsWith(p));

/** Giờ mặc định cho buổi tập cũ không có created_at: mốc check-in tối 21:30 VN của ngày tập. */
export const WORKOUT_FALLBACK_TIME = "21:30:00";

/** Buổi học (Trà Đình) — chỉ ghi được cho hôm nay nên là nguồn tự động; thời điểm = lúc tạo. */
export function studyLogToEvent(row: { id: string; minutes: number; createdAt: Date }): EconomyEvent {
  return {
    eventId: `${STUDY_LOG_PREFIX}:${row.id}`,
    type: "study.logged",
    source: "auto",
    occurredAt: row.createdAt,
    data: { minutes: row.minutes },
  };
}

/** Buổi tập (routine WORKOUT có phút). Dòng không có phút (CHECK) không sinh sự kiện. Thời điểm luôn nằm trong ngày tập. */
export function routineLogToEvent(row: { id: string; logDate: string; durationMinutes: number | null; createdAt: Date | null }): EconomyEvent | null {
  if (row.durationMinutes == null || row.durationMinutes <= 0) return null;
  return {
    eventId: `${ROUTINE_LOG_PREFIX}:${row.id}`,
    type: "exercise.logged",
    source: "auto",
    // created_at chỉ dùng khi rơi đúng ngày tập (giờ VN). Dòng cũ (null) hoặc ghi bù / nhập thẳng cho ngày khác ⇒ 21:30 VN của ngày tập,
    // không thì buổi tập bị tính vào ngày ghi.
    occurredAt: row.createdAt && vnToday(row.createdAt) === row.logDate ? row.createdAt : new Date(`${row.logDate}T${WORKOUT_FALLBACK_TIME}+07:00`),
    data: { minutes: row.durationMinutes },
  };
}

/** So sánh nội dung hai sự kiện (bỏ qua thứ tự khoá của jsonb). */
export function sameEvent(a: EconomyEvent, b: EconomyEvent): boolean {
  return (
    a.eventId === b.eventId &&
    a.type === b.type &&
    a.source === b.source &&
    a.occurredAt.getTime() === b.occurredAt.getTime() &&
    stableJson(a.data) === stableJson(b.data)
  );
}

function stableJson(x: unknown): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableJson).join(",")}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

export type EventDiff = {
  upsert: EconomyEvent[];
  remove: string[];
  /** Ngày VN sớm nhất bị ảnh hưởng (bản cũ hoặc bản mới), null nếu không đổi gì. */
  earliest: string | null;
};

/**
 * Đối soát sự kiện do nguồn quản lý: `desired` (tính từ dữ liệu thật) với `existing` (đang lưu).
 * Chỉ xét sự kiện có tiền tố trong MANAGED_PREFIXES; `vnDateOf` đổi thời điểm → ngày VN.
 */
export function diffEvents(desired: EconomyEvent[], existing: EconomyEvent[], vnDateOf: (at: Date) => string): EventDiff {
  const want = new Map(desired.map((e) => [e.eventId, e]));
  const have = new Map(existing.filter((e) => isManagedEventId(e.eventId)).map((e) => [e.eventId, e]));
  const upsert: EconomyEvent[] = [];
  const remove: string[] = [];
  let earliest: string | null = null;
  const touch = (at: Date) => {
    const d = vnDateOf(at);
    if (earliest === null || d < earliest) earliest = d;
  };
  for (const [id, e] of want) {
    const old = have.get(id);
    if (old && sameEvent(old, e)) continue;
    upsert.push(e);
    touch(e.occurredAt);
    if (old) touch(old.occurredAt);
  }
  for (const [id, old] of have) {
    if (want.has(id)) continue;
    remove.push(id);
    touch(old.occurredAt);
  }
  return { upsert, remove, earliest };
}

/** Ngày VN nhỏ nhất trong các ứng viên (bỏ null). */
export function minDate(...ds: Array<string | null | undefined>): string | null {
  return ds.reduce<string | null>((m, d) => (d && (m === null || d < m) ? d : m), null);
}
