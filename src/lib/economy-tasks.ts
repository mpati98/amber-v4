// Nguồn task cho kinh tế. Giai đoạn 1: task của chính amber-v4 (`tasks`, `task_occurrences`).
// Giai đoạn 2: ats-app cắm vào cùng interface. Mỗi nguồn có tiền tố eventId riêng ⇒ không đếm trùng giữa các nguồn.
//
// Thưởng tính theo giờ ƯỚC LƯỢNG (độ khó); giờ THỰC TẾ chỉ làm hao Thể lực — thưởng theo giờ thực tế
// sẽ khuyến khích kéo dài task.

import { addDaysIso } from "@/lib/deadline-alert";
import { vnDayStart } from "@/lib/vn-time";
import type { EconomyEvent } from "@/lib/economy-engine";

export type TaskDue = { kind: "date"; date: string } | { kind: "timestamp"; at: Date };

export type SourceTask = {
  /** Định danh đã gắn tiền tố nguồn, vd "amber-task:<uuid>", "amber-task-occ:<uuid>:2026-11-15", "ats-task:<id>". */
  ref: string;
  title: string;
  done: boolean;
  completedAt: Date | null;
  due: TaskDue | null;
  estHours: number | null;
  actualHours: number | null;
};

export interface TaskSource {
  /** Tiền tố eventId, duy nhất giữa các nguồn. */
  readonly prefix: string;
  /** Task của user đã đổi sau `since` (null = tất cả). Trả cả task mở lại để bên gọi xoá sự kiện cũ. */
  listChanged(userId: string, since: Date | null): Promise<SourceTask[]>;
}

/** Đúng hạn? Hạn kiểu ngày ⇒ so với cuối ngày đó giờ VN (trước 00:00 VN hôm sau); hạn kiểu thời điểm ⇒ so UTC. */
export function isOnTime(completedAt: Date, due: TaskDue | null): boolean {
  if (!due) return true;
  if (due.kind === "timestamp") return completedAt.getTime() <= due.at.getTime();
  return completedAt.getTime() < vnDayStart(addDaysIso(due.date, 1)).getTime();
}

export const taskEventId = (ref: string) => `${ref}:done`;

/** Task đã xong ⇒ một sự kiện task.completed; chưa xong (hoặc mở lại) ⇒ null (bên gọi xoá sự kiện cũ nếu có). */
export function taskToEvent(t: SourceTask, cardTaskRefs: ReadonlySet<string>): EconomyEvent | null {
  if (!t.done || !t.completedAt) return null;
  const est = t.estHours && t.estHours > 0 ? t.estHours : 1;
  const hours = t.actualHours != null && t.actualHours >= 0 ? t.actualHours : est;
  return {
    eventId: taskEventId(t.ref),
    type: "task.completed",
    source: "auto",
    occurredAt: t.completedAt,
    data: { on_time: isOnTime(t.completedAt, t.due), est_hours: est, hours, card_used: cardTaskRefs.has(t.ref) },
  };
}

export const AMBER_TASK_PREFIX = "amber-task";

/** Dòng `tasks` (chỉ các cột cần) → SourceTask. Task lặp (`rrule`) KHÔNG đi qua đây mà theo từng occurrence. */
export function amberTaskToSource(row: {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  durationMinutes: number;
  actualMinutes: number | null;
  statusChangedAt: Date;
}): SourceTask {
  const done = row.status === "DONE";
  return {
    ref: `${AMBER_TASK_PREFIX}:${row.id}`,
    title: row.title,
    done,
    completedAt: done ? row.statusChangedAt : null,
    due: row.dueDate ? { kind: "date", date: row.dueDate } : null,
    estHours: row.durationMinutes / 60,
    actualHours: row.actualMinutes == null ? null : row.actualMinutes / 60,
  };
}

/** Một lần xảy ra của task lặp → SourceTask; hạn = chính ngày xảy ra. Không có giờ thực tế theo lần. */
export function amberOccurrenceToSource(
  task: { id: string; title: string; durationMinutes: number },
  occ: { occurrenceDate: string; completedAt: Date | null },
): SourceTask {
  return {
    ref: `${AMBER_TASK_PREFIX}-occ:${task.id}:${occ.occurrenceDate}`,
    title: task.title,
    done: occ.completedAt != null,
    completedAt: occ.completedAt,
    due: { kind: "date", date: occ.occurrenceDate },
    estHours: task.durationMinutes / 60,
    actualHours: null,
  };
}
