// Đồng bộ MỘT CHIỀU task ats-app → bảng ats_tasks (bản sao chỉ đọc). Không bao giờ ghi ngược về ats-app.
//
// Một lần đồng bộ:
//   1. Giành lượt: UPDATE nguyên tử sync_cursors.last_attempt_at nếu lần thử trước đã quá minIntervalSec
//      (vừa giới hạn tần suất vừa chống chạy chồng giữa các instance serverless).
//   2. Kéo task đổi từ since − 2 phút (lần đầu / full: kéo hết), rồi kéo idsOnly=1 — gọi mạng NGOÀI transaction.
//   3. Một transaction (+ advisory lock theo user): upsert idempotent, xoá dòng không còn trong ats, ghi since = serverTime.
// Lỗi (thiếu env, mạng, 401, sai dạng) ⇒ ghi last_error, KHÔNG đụng dữ liệu đã có.

import { and, count, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { atsTasks, syncCursors, users } from "@/db/schema";
import { logActivity } from "@/lib/activity-log";
import { AtsError, fetchAtsTaskIds, fetchAtsTasks, readAtsConfig } from "@/lib/ats-client";
import {
  atsAttention,
  atsTaskToRow,
  compareAtsTasks,
  dedupeAtsTasks,
  isAtsVisibleByDefault,
  mapAtsStatus,
  nextUpdatedSince,
  retryAfterSeconds,
  shouldSkipDeletion,
} from "@/lib/ats-tasks";
import { vnToday } from "@/lib/vn-time";

export const ATS_SOURCE = "ats";
/** GET danh sách tự đồng bộ nền khi lần thử trước đã quá 5 phút. */
export const ATS_AUTO_SYNC_INTERVAL_SEC = 5 * 60;
/** Nút "Đồng bộ ngay" và cron: tối thiểu 30 giây giữa hai lần. */
export const ATS_MANUAL_SYNC_INTERVAL_SEC = 30;

const UPSERT_CHUNK = 500;
const MAX_ERROR_LEN = 500;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AtsSyncState = { lastSuccessAt: string | null; lastAttemptAt: string | null; lastError: string | null };
export type AtsSyncCounts = { fetched: number; inserted: number; updated: number; deleted: number; deletionSkipped: boolean };
export type AtsSyncOutcome =
  | { status: "ok"; counts: AtsSyncCounts; state: AtsSyncState }
  | { status: "throttled"; retryAfterSeconds: number; state: AtsSyncState }
  | { status: "error"; error: { code: string; message: string }; state: AtsSyncState };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function getAtsSyncState(userId: string): Promise<AtsSyncState & { lastAttemptDate: Date | null }> {
  const [row] = await db
    .select()
    .from(syncCursors)
    .where(and(eq(syncCursors.userId, userId), eq(syncCursors.source, ATS_SOURCE)))
    .limit(1);
  return {
    lastSuccessAt: iso(row?.lastSuccessAt),
    lastAttemptAt: iso(row?.lastAttemptAt),
    lastError: row?.lastError ?? null,
    lastAttemptDate: row?.lastAttemptAt ?? null,
  };
}

const publicState = ({ lastSuccessAt, lastAttemptAt, lastError }: AtsSyncState): AtsSyncState => ({ lastSuccessAt, lastAttemptAt, lastError });

/** Giành lượt đồng bộ. Trả `since` hiện tại nếu giành được, null nếu lần thử trước còn trong khoảng minIntervalSec. */
async function claim(userId: string, minIntervalSec: number): Promise<{ since: Date | null } | null> {
  const rows = await db
    .insert(syncCursors)
    .values({ userId, source: ATS_SOURCE, lastAttemptAt: sql`now()` })
    .onConflictDoUpdate({
      target: [syncCursors.userId, syncCursors.source],
      set: { lastAttemptAt: sql`now()` },
      setWhere: sql`${syncCursors.lastAttemptAt} is null or ${syncCursors.lastAttemptAt} < now() - make_interval(secs => ${minIntervalSec})`,
    })
    .returning({ since: syncCursors.since });
  return rows[0] ?? null;
}

// Cột bản sao (tên cột SQL) — upsert chỉ ghi khi ít nhất một cột khác bản đang lưu, nên lần kéo chồng lấn không đếm là "sửa".
const MIRROR_COLUMNS = [
  "title",
  "status",
  "due_date",
  "done_at",
  "ats_created_at",
  "ats_updated_at",
  "project_ats_id",
  "project_name",
  "project_type",
  "project_archived",
] as const;
const excluded = (c: string) => sql.raw(`excluded."${c}"`);
const current = (c: string) => sql.raw(`"ats_tasks"."${c}"`);
const changedWhere = sql.join(
  MIRROR_COLUMNS.map((c) => sql`${current(c)} is distinct from ${excluded(c)}`),
  sql` or `
);

async function writeSnapshot(
  tx: Tx,
  userId: string,
  rows: ReturnType<typeof atsTaskToRow>[],
  remoteIds: string[] | null,
  serverTime: Date
): Promise<Omit<AtsSyncCounts, "fetched">> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ats-sync:${userId}`}, 0))`);
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const set: Record<string, SQL> = {
      title: excluded("title"),
      status: excluded("status"),
      dueDate: excluded("due_date"),
      doneAt: excluded("done_at"),
      atsCreatedAt: excluded("ats_created_at"),
      atsUpdatedAt: excluded("ats_updated_at"),
      projectAtsId: excluded("project_ats_id"),
      projectName: excluded("project_name"),
      projectType: excluded("project_type"),
      projectArchived: excluded("project_archived"),
      // Chỉ đổi khi status khác bản đang lưu; mốc = updatedAt của ats (sát lúc đổi hơn giờ đồng bộ, vốn có thể trễ cả ngày).
      statusChangedAt: sql`case when ${current("status")} is distinct from ${excluded("status")} then ${excluded("ats_updated_at")} else ${current("status_changed_at")} end`,
      syncedAt: sql`now()`,
    };
    const res = await tx
      .insert(atsTasks)
      .values(chunk.map((r) => ({ ...r, userId, statusChangedAt: r.atsUpdatedAt })))
      .onConflictDoUpdate({ target: [atsTasks.userId, atsTasks.atsId], set, setWhere: changedWhere })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of res) {
      if (r.inserted) inserted++;
      else updated++;
    }
  }

  let deleted = 0;
  let deletionSkipped = false;
  if (remoteIds) {
    const [{ n }] = await tx.select({ n: count() }).from(atsTasks).where(eq(atsTasks.userId, userId));
    if (shouldSkipDeletion(remoteIds.length, n)) {
      deletionSkipped = true;
    } else {
      const gone = await tx
        .delete(atsTasks)
        .where(and(eq(atsTasks.userId, userId), notInArray(atsTasks.atsId, remoteIds)))
        .returning({ id: atsTasks.id });
      deleted = gone.length;
    }
  }

  await tx
    .update(syncCursors)
    .set({
      since: serverTime,
      lastSuccessAt: sql`now()`,
      ...(remoteIds && !deletionSkipped ? { lastIdsCheckAt: sql`now()` } : {}),
      lastError: deletionSkipped ? "deletion_skipped: ats-app trả danh sách id rỗng trong khi bản sao còn dữ liệu — không xoá gì" : null,
    })
    .where(and(eq(syncCursors.userId, userId), eq(syncCursors.source, ATS_SOURCE)));
  return { inserted, updated, deleted, deletionSkipped };
}

function describeError(err: unknown): { code: string; message: string } {
  if (err instanceof AtsError) return { code: err.code, message: err.message };
  // Lỗi DB / lỗi lạ: chỉ lấy thông báo, không lấy tham số truy vấn.
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return { code: "internal", message: cause?.message ?? (err instanceof Error ? err.message : String(err)) };
}

/**
 * Một lần đồng bộ cho [userId]. Không ném lỗi — mọi kết cục nằm trong giá trị trả về.
 * `full`: bỏ qua since, kéo toàn bộ (cron dùng — bắt cả thay đổi project không làm đổi updatedAt của task).
 */
export async function runAtsSync(userId: string, opts: { minIntervalSec: number; full?: boolean }): Promise<AtsSyncOutcome> {
  let claimed: { since: Date | null } | null;
  try {
    claimed = await claim(userId, opts.minIntervalSec);
  } catch (err) {
    const e = describeError(err);
    console.error("Đồng bộ ats-app: không giành được lượt:", e.code, e.message);
    return { status: "error", error: e, state: { lastSuccessAt: null, lastAttemptAt: null, lastError: null } };
  }
  if (!claimed) {
    const s = await getAtsSyncState(userId);
    return { status: "throttled", retryAfterSeconds: Math.max(1, retryAfterSeconds(s.lastAttemptDate, opts.minIntervalSec, new Date())), state: publicState(s) };
  }

  try {
    const cfg = readAtsConfig();
    const pulled = await fetchAtsTasks(cfg, { updatedSince: opts.full ? null : nextUpdatedSince(claimed.since) });
    const { ids } = await fetchAtsTaskIds(cfg);
    const rows = dedupeAtsTasks(pulled.tasks).map(atsTaskToRow);
    const counts = await db.transaction((tx) => writeSnapshot(tx, userId, rows, ids, new Date(pulled.serverTime)));
    const result: AtsSyncCounts = { fetched: pulled.tasks.length, ...counts };
    if (counts.inserted + counts.updated + counts.deleted > 0) {
      await logActivity({
        userId,
        source: "DU_AN",
        action: "ats.synced",
        title: `Đồng bộ việc công ty: +${counts.inserted} · sửa ${counts.updated} · xoá ${counts.deleted}`,
        metadata: { inserted: counts.inserted, updated: counts.updated, deleted: counts.deleted },
      });
    }
    return { status: "ok", counts: result, state: publicState(await getAtsSyncState(userId)) };
  } catch (err) {
    const e = describeError(err);
    console.error("Đồng bộ ats-app lỗi:", e.code, e.message);
    try {
      await db
        .update(syncCursors)
        .set({ lastError: `${e.code}: ${e.message}`.slice(0, MAX_ERROR_LEN) })
        .where(and(eq(syncCursors.userId, userId), eq(syncCursors.source, ATS_SOURCE)));
    } catch {
      // Ghi lỗi thất bại thì thôi — không làm hỏng response.
    }
    return { status: "error", error: e, state: publicState(await getAtsSyncState(userId).catch(() => ({ lastSuccessAt: null, lastAttemptAt: null, lastError: null, lastAttemptDate: null }))) };
  }
}

/** User có tồn tại không (cron dùng ATS_SYNC_USER_ID — sai id thì báo lỗi rõ thay vì vướng FK). */
export async function userExists(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return row !== undefined;
}

export type AtsTaskView = {
  id: string;
  atsId: string;
  title: string;
  status: ReturnType<typeof mapAtsStatus>;
  rawStatus: string | null;
  dueDate: string | null;
  doneAt: string | null;
  project: { atsId: string | null; name: string | null; type: string | null; archived: boolean };
  attention: "OVERDUE" | null;
};

/** Danh sách cho client, đã lọc (trừ khi `all`) và sắp xếp. */
export async function listAtsTasks(userId: string, opts: { all: boolean }): Promise<AtsTaskView[]> {
  const rows = await db.select().from(atsTasks).where(eq(atsTasks.userId, userId));
  const now = new Date();
  const today = vnToday(now);
  return rows
    .filter((r) => opts.all || isAtsVisibleByDefault(r, now))
    .map((r) => ({ r, attention: atsAttention(r, today) }))
    .sort((a, b) =>
      compareAtsTasks(
        { attention: a.attention, rawStatus: a.r.status, dueDate: a.r.dueDate, doneAt: a.r.doneAt, atsId: a.r.atsId },
        { attention: b.attention, rawStatus: b.r.status, dueDate: b.r.dueDate, doneAt: b.r.doneAt, atsId: b.r.atsId }
      )
    )
    .map(({ r, attention }) => ({
      id: r.id,
      atsId: r.atsId,
      title: r.title,
      status: mapAtsStatus(r.status),
      rawStatus: r.status,
      dueDate: r.dueDate,
      doneAt: iso(r.doneAt),
      project: { atsId: r.projectAtsId, name: r.projectName, type: r.projectType, archived: r.projectArchived },
      attention,
    }));
}
