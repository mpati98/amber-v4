// Hàm thuần cho task ats-app — test ở ats-tasks.test.ts. Phần dùng DB: ats-sync.ts.

import type { AtsTask } from "@/lib/ats-client";

export type AtsRawStatus = "DOING" | "WAITING" | "DONE" | null;
/** Trạng thái trả cho client. WAITING là nhãn riêng của ats (chờ người khác), KHÔNG ánh xạ sang REVIEW. */
export type AtsViewStatus = "PREP" | "IN_PROGRESS" | "WAITING" | "DONE";

/** Task DONE có done_at cũ hơn chừng này ngày bị ẩn khỏi danh sách mặc định. */
export const ATS_DONE_VISIBLE_DAYS = 7;

export function mapAtsStatus(raw: string | null): AtsViewStatus {
  switch (raw) {
    case "DOING":
      return "IN_PROGRESS";
    case "WAITING":
      return "WAITING";
    case "DONE":
      return "DONE";
    default:
      return "PREP";
  }
}

/** Chỉ OVERDUE (không IDLE): chưa DONE và due_date < hôm nay. [today] "YYYY-MM-DD" giờ VN. */
export function atsAttention(t: { status: string | null; dueDate: string | null }, today: string): "OVERDUE" | null {
  if (t.status === "DONE") return null;
  return t.dueDate && t.dueDate < today ? "OVERDUE" : null;
}

/** Danh sách mặc định: ẩn project đã lưu trữ và task DONE xong quá [ATS_DONE_VISIBLE_DAYS] ngày (DONE mà không có done_at thì giữ). */
export function isAtsVisibleByDefault(t: { status: string | null; doneAt: Date | null; projectArchived: boolean }, now: Date): boolean {
  if (t.projectArchived) return false;
  if (t.status === "DONE" && t.doneAt) return now.getTime() - t.doneAt.getTime() <= ATS_DONE_VISIBLE_DAYS * 86_400_000;
  return true;
}

/**
 * OVERDUE trước, rồi việc còn mở, DONE cuối. Trong nhóm OVERDUE / mở: due_date tăng dần, null cuối.
 * Trong DONE: xong gần nhất trước. Hoà ⇒ atsId để thứ tự ổn định.
 */
export function compareAtsTasks(
  a: { attention: "OVERDUE" | null; rawStatus: string | null; dueDate: string | null; doneAt: Date | null; atsId: string },
  b: typeof a
): number {
  const group = (t: typeof a) => (t.attention === "OVERDUE" ? 0 : t.rawStatus === "DONE" ? 2 : 1);
  const g = group(a) - group(b);
  if (g !== 0) return g;
  if (group(a) === 2) {
    const d = (b.doneAt?.getTime() ?? -Infinity) - (a.doneAt?.getTime() ?? -Infinity);
    if (d !== 0 && !Number.isNaN(d)) return d;
  } else if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.atsId < b.atsId ? -1 : a.atsId > b.atsId ? 1 : 0;
}

/** Cột bản sao lấy từ một task ats (chưa gồm user_id / status_changed_at / synced_at). */
export function atsTaskToRow(t: AtsTask) {
  return {
    atsId: t.id,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate,
    doneAt: t.doneAt ? new Date(t.doneAt) : null,
    atsCreatedAt: new Date(t.createdAt),
    atsUpdatedAt: new Date(t.updatedAt),
    projectAtsId: t.project?.id ?? null,
    projectName: t.project?.name ?? null,
    projectType: t.project?.type ?? null,
    projectArchived: t.project?.archived ?? false,
  };
}
export type AtsMirrorRow = ReturnType<typeof atsTaskToRow>;

/** Mốc updatedSince cho lần kéo kế tiếp: since − 2 phút (chồng lấn để không sót do lệch thời điểm commit phía ats). */
export const ATS_SINCE_OVERLAP_MS = 2 * 60_000;
export function nextUpdatedSince(since: Date | null): Date | null {
  return since ? new Date(since.getTime() - ATS_SINCE_OVERLAP_MS) : null;
}

/** Gộp các task trùng id trong cùng một lần kéo (giữ bản updatedAt mới nhất) — INSERT nhiều dòng trùng khoá sẽ lỗi. */
export function dedupeAtsTasks(tasks: AtsTask[]): AtsTask[] {
  const byId = new Map<string, AtsTask>();
  for (const t of tasks) {
    const prev = byId.get(t.id);
    if (!prev || Date.parse(t.updatedAt) >= Date.parse(prev.updatedAt)) byId.set(t.id, t);
  }
  return [...byId.values()];
}

/**
 * Chống xoá hàng loạt: idsOnly trả rỗng trong khi bản sao còn dữ liệu ⇒ nghi cấu hình sai (token khác phạm vi, endpoint lỗi),
 * KHÔNG xoá. Muốn xoá hết thật thì xoá tay.
 */
export function shouldSkipDeletion(remoteIdCount: number, localCount: number): boolean {
  return remoteIdCount === 0 && localCount > 0;
}

/** Số giây phải chờ trước lần thử kế tiếp (làm tròn lên, tối thiểu 1). */
export function retryAfterSeconds(lastAttemptAt: Date | null, minIntervalSec: number, now: Date): number {
  if (!lastAttemptAt) return 0;
  const left = lastAttemptAt.getTime() + minIntervalSec * 1000 - now.getTime();
  return left > 0 ? Math.max(1, Math.ceil(left / 1000)) : 0;
}
