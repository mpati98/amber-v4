import { vnToday } from "@/lib/vn-time";

// Cờ "cần chú ý" của một việc. Hàm thuần — test ở task-attention.test.ts.

/** Việc đang làm / thẩm định mà không đổi trạng thái từ chừng này ngày thì bị coi là nằm im. */
export const ATTENTION_IDLE_DAYS = 5;

export type TaskAttention = { kind: "OVERDUE" | "IDLE"; days: number } | null;

/** Số ngày lịch từ [from] đến [to] (cả hai "YYYY-MM-DD"); to sau from thì dương. */
export function diffDaysIso(from: string, to: string): number {
  const ms = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/**
 * DONE → null. Quá hạn (dueDate < hôm nay) → OVERDUE. Không thì IN_PROGRESS/REVIEW
 * đã ≥ ATTENTION_IDLE_DAYS ngày (lịch VN) kể từ statusChangedAt → IDLE. Còn lại null.
 * [today] "YYYY-MM-DD" theo giờ VN.
 */
export function taskAttention(
  task: { status: string; dueDate: string | null; statusChangedAt: Date | string },
  today: string
): TaskAttention {
  if (task.status === "DONE") return null;
  if (task.dueDate && task.dueDate < today) {
    return { kind: "OVERDUE", days: diffDaysIso(task.dueDate, today) };
  }
  if (task.status === "IN_PROGRESS" || task.status === "REVIEW") {
    const days = diffDaysIso(vnToday(new Date(task.statusChangedAt)), today);
    if (days >= ATTENTION_IDLE_DAYS) return { kind: "IDLE", days };
  }
  return null;
}
