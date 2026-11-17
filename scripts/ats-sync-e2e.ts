// Kiểm thử tích hợp đồng bộ ats-app trên Neon DEV với một ats-app GIẢ chạy trong script (không gọi ats thật).
// Dev server phải chạy với env trỏ vào bản giả, ví dụ:
//   ATS_E2E_USER_ID=$(node -e 'console.log(crypto.randomUUID())'); CRON_SECRET=$(openssl rand -hex 24)
//   ATS_TASKS_URL=http://127.0.0.1:4599/api/external/tasks ATS_TASKS_TOKEN=ats-e2e-mock-token \
//   ATS_SYNC_USER_ID=$ATS_E2E_USER_ID CRON_SECRET=$CRON_SECRET npm run dev
//   ATS_E2E_USER_ID=$ATS_E2E_USER_ID CRON_SECRET=$CRON_SECRET npx tsx scripts/ats-sync-e2e.ts
// Tạo user tạm đúng id ATS_E2E_USER_ID rồi XOÁ ở finally (cascade ats_tasks, sync_cursors, activity_logs).
// Từ chối chạy nếu DB là production. Không in token / secret / URL DB.
import "dotenv/config";
import http from "node:http";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, atsTasks, syncCursors, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const USER_ID = process.env.ATS_E2E_USER_ID ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
if (!/^[0-9a-f-]{36}$/.test(USER_ID) || !CRON_SECRET) {
  console.error("Cần ATS_E2E_USER_ID (uuid, trùng ATS_SYNC_USER_ID của dev server) và CRON_SECRET (trùng dev server).");
  process.exit(2);
}
const BASE = process.env.ATS_E2E_BASE ?? "http://localhost:3000/api";
const MOCK_PORT = Number(process.env.ATS_E2E_MOCK_PORT ?? 4599);
const MOCK_TOKEN = "ats-e2e-mock-token";

let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (tok: string | null, method: string, path: string, headers: Record<string, string> = {}): Promise<{ s: number; j: any }> => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- ats-app giả ----------
type MockTask = { id: string; title: string; status: "DOING" | "WAITING" | "DONE" | null; dueDate: string | null; doneAt: string | null; createdAt: string; updatedAt: string; project: { id: string; name: string; type: string; archived: boolean } };
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const OLD = "2026-10-01T00:00:00.000Z";
const projects = [
  { id: "p-camp", name: "Chiến dịch A", type: "CAMPAIGN", archived: false },
  { id: "p-fair", name: "Hội chợ B", type: "FAIR", archived: false },
  { id: "p-arch", name: "Dự án cũ", type: "OTHER", archived: true },
];
const mock = {
  tasks: new Map<string, MockTask>(),
  mode: "ok" as "ok" | "401" | "emptyIds",
  nonGet: 0,
  badAuth: 0,
  requests: 0,
};
// 57 task: 0–9 quá hạn (DOING/WAITING/null), 10–19 DONE cũ (ẩn mặc định), 20–24 DONE mới, 25–29 project lưu trữ, còn lại mở hạn tương lai / không hạn.
for (let i = 0; i < 57; i++) {
  const status = i < 10 ? (["DOING", "WAITING", null] as const)[i % 3] : i < 25 ? "DONE" : (["DOING", "WAITING", null] as const)[i % 3];
  const doneAt = i >= 10 && i < 20 ? "2026-10-15T03:00:00.000Z" : i >= 20 && i < 25 ? new Date(Date.now() - 86_400_000).toISOString() : null;
  const dueDate = i < 10 ? isoDay(-1 - i) : i % 7 === 0 ? null : isoDay(i);
  mock.tasks.set(`t${i}`, { id: `t${i}`, title: `Việc giả ${i}`, status, dueDate, doneAt, createdAt: OLD, updatedAt: OLD, project: projects[i >= 25 && i < 30 ? 2 : i % 2] });
}
const PAGE = 20; // nhỏ hơn limit để buộc client phân trang

const server = http.createServer((req, res) => {
  mock.requests++;
  const send = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "GET") { mock.nonGet++; return send(405, { error: "method" }); }
  if (req.headers.authorization !== `Bearer ${MOCK_TOKEN}` || mock.mode === "401") { mock.badAuth++; return send(401, { error: "unauthorized" }); }
  const url = new URL(req.url ?? "/", "http://x");
  const serverTime = new Date().toISOString();
  const all = [...mock.tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (url.searchParams.get("idsOnly") === "1") return send(200, { serverTime, ids: mock.mode === "emptyIds" ? [] : all.map((t) => t.id) });
  const since = url.searchParams.get("updatedSince");
  const list = since ? all.filter((t) => t.updatedAt >= since) : all;
  const start = Number(url.searchParams.get("after") ?? 0);
  const page = list.slice(start, start + PAGE);
  send(200, { serverTime, tasks: page, nextCursor: start + PAGE < list.length ? String(start + PAGE) : null });
});

async function resetThrottle() {
  await db.update(syncCursors).set({ lastAttemptAt: sql`now() - interval '1 hour'` }).where(eq(syncCursors.userId, USER_ID));
}
const localCount = async () => (await db.select({ n: count() }).from(atsTasks).where(eq(atsTasks.userId, USER_ID)))[0].n;

async function main() {
  await new Promise<void>((r) => server.listen(MOCK_PORT, "127.0.0.1", r));
  await db.insert(users).values({ id: USER_ID, email: `ats-e2e-${Date.now()}@test.local`, passwordHash: "x" });
  const tok = await signAccessToken(USER_ID);

  check("401 không token GET", (await call(null, "GET", "/du-an/ats-tasks")).s === 401);
  check("401 không token POST /sync", (await call(null, "POST", "/du-an/ats-tasks/sync")).s === 401);

  // Lần 1: kéo toàn bộ
  let r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("sync 1: 200", r.s === 200, r);
  check("sync 1: nhận 57, thêm 57", r.j?.result?.fetched === 57 && r.j?.result?.inserted === 57 && r.j?.result?.updated === 0 && r.j?.result?.deleted === 0, r.j?.result);
  check("sync 1: lastError null, có lastSuccessAt", r.j?.sync?.lastError === null && !!r.j?.sync?.lastSuccessAt, r.j?.sync);
  check("DB: 57 dòng", (await localCount()) === 57);

  // Giới hạn 30 giây
  r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("sync ngay sau: 429 + retryAfterSeconds", r.s === 429 && r.j?.retryAfterSeconds > 0 && r.j?.retryAfterSeconds <= 30, r);

  // Lần 2: không có gì đổi
  await resetThrottle();
  r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("sync 2: 0 thêm / sửa / xoá", r.s === 200 && r.j.result.inserted === 0 && r.j.result.updated === 0 && r.j.result.deleted === 0, r.j);
  check("sync 2: kéo tăng dần (updatedSince) → 0 task", r.j?.result?.fetched === 0, r.j?.result);
  const dup = await db.execute(sql`select ats_id from ats_tasks where user_id = ${USER_ID} group by ats_id having count(*) > 1`);
  check("DB: vẫn 57, không trùng", (await localCount()) === 57 && dup.length === 0);

  // Đổi: t30 DOING→DONE, t31 chỉ đổi tên (status giữ), xoá t32
  const [before31] = await db.select().from(atsTasks).where(and(eq(atsTasks.userId, USER_ID), eq(atsTasks.atsId, "t31")));
  const now = new Date().toISOString();
  const t30 = mock.tasks.get("t30")!;
  check("t30 ban đầu DOING", t30.status === "DOING");
  mock.tasks.set("t30", { ...t30, status: "DONE", doneAt: now, updatedAt: now });
  mock.tasks.set("t31", { ...mock.tasks.get("t31")!, title: "Việc giả 31 (đổi tên)", updatedAt: now });
  mock.tasks.delete("t32");
  await resetThrottle();
  r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("sync 3: sửa 2, xoá 1, thêm 0", r.s === 200 && r.j.result.updated === 2 && r.j.result.deleted === 1 && r.j.result.inserted === 0, r.j);
  const [a30] = await db.select().from(atsTasks).where(and(eq(atsTasks.userId, USER_ID), eq(atsTasks.atsId, "t30")));
  const [a31] = await db.select().from(atsTasks).where(and(eq(atsTasks.userId, USER_ID), eq(atsTasks.atsId, "t31")));
  check("t30: status DONE, status_changed_at = updatedAt mới", a30.status === "DONE" && a30.statusChangedAt.toISOString() === now, { s: a30.status, c: a30.statusChangedAt });
  check("t31: status_changed_at giữ nguyên khi chỉ đổi tên", a31.statusChangedAt.getTime() === before31.statusChangedAt.getTime() && a31.title.includes("đổi tên"));
  check("DB: 56 dòng", (await localCount()) === 56);

  // GET mặc định / ?all=1
  r = await call(tok, "GET", "/du-an/ats-tasks");
  const def = r.j?.tasks ?? [];
  check("GET: 200 + khối sync", r.s === 200 && "lastSuccessAt" in r.j.sync && "lastAttemptAt" in r.j.sync && "lastError" in r.j.sync, r.j?.sync);
  check("GET: ẩn project lưu trữ", def.every((t: { project: { archived: boolean } }) => !t.project.archived));
  check("GET: ẩn DONE quá 7 ngày (t10–t19)", !def.some((t: { atsId: string }) => /^t1\d$/.test(t.atsId)));
  check("GET: số dòng mặc định = 56 − 5 lưu trữ − 10 DONE cũ = 41", def.length === 41, def.length);
  const kinds = def.map((t: { attention: string | null; rawStatus: string | null }) => (t.attention === "OVERDUE" ? 0 : t.rawStatus === "DONE" ? 2 : 1));
  check("GET: thứ tự OVERDUE → mở → DONE", kinds.every((k: number, i: number) => i === 0 || kinds[i - 1] <= k), kinds);
  check("GET: 10 OVERDUE", def.filter((t: { attention: string | null }) => t.attention === "OVERDUE").length === 10);
  const st = new Map(def.map((t: { atsId: string; status: string; rawStatus: string | null }) => [t.atsId, [t.status, t.rawStatus]]));
  check("GET: ánh xạ DOING→IN_PROGRESS, WAITING→WAITING, null→PREP", JSON.stringify(st.get("t0")) === '["IN_PROGRESS","DOING"]' && JSON.stringify(st.get("t1")) === '["WAITING","WAITING"]' && JSON.stringify(st.get("t2")) === '["PREP",null]', [st.get("t0"), st.get("t1"), st.get("t2")]);
  const open = def.filter((t: { attention: string | null; rawStatus: string | null }) => !t.attention && t.rawStatus !== "DONE");
  const dues = open.map((t: { dueDate: string | null }) => t.dueDate);
  const firstNull = dues.indexOf(null);
  check("GET: nhóm mở hạn tăng dần, null cuối", (firstNull === -1 || dues.slice(firstNull).every((d: string | null) => d === null)) && dues.filter(Boolean).every((d: string, i: number, a: string[]) => i === 0 || a[i - 1] <= d), dues);
  check("GET: dạng một dòng", ["id", "atsId", "title", "status", "rawStatus", "dueDate", "doneAt", "project", "attention"].every((k) => k in def[0]) && ["atsId", "name", "type", "archived"].every((k) => k in def[0].project), def[0]);
  r = await call(tok, "GET", "/du-an/ats-tasks?all=1");
  check("GET ?all=1: 56 dòng", r.j?.tasks?.length === 56, r.j?.tasks?.length);

  // Lỗi 401 từ ats: ghi last_error, không xoá dữ liệu
  mock.mode = "401";
  await resetThrottle();
  r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("ats 401 → 502 code unauthorized", r.s === 502 && r.j?.code === "unauthorized", r);
  check("ats 401: lastError ghi lại, dữ liệu còn 56", r.j?.sync?.lastError?.startsWith("unauthorized") && (await localCount()) === 56, r.j?.sync);
  mock.mode = "ok";
  await resetThrottle();
  r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("hồi phục: 200, lastError xoá", r.s === 200 && r.j?.sync?.lastError === null, r.j);

  // idsOnly rỗng → không xoá hàng loạt
  mock.mode = "emptyIds";
  await resetThrottle();
  r = await call(tok, "POST", "/du-an/ats-tasks/sync");
  check("ids rỗng: không xoá, báo deletion_skipped", r.s === 200 && r.j.result.deleted === 0 && r.j.result.deletionSkipped === true && r.j.sync.lastError?.startsWith("deletion_skipped") && (await localCount()) === 56, r.j);
  mock.mode = "ok";

  // Cron
  check("cron không token → 401", (await call(null, "GET", "/du-an/ats-tasks/cron")).s === 401);
  check("cron sai secret → 401", (await call(null, "GET", "/du-an/ats-tasks/cron", { Authorization: "Bearer sai" })).s === 401);
  check("cron dùng JWT người dùng → 401", (await call(tok, "GET", "/du-an/ats-tasks/cron")).s === 401);
  // Đổi tên project mà KHÔNG đổi updatedAt của task: chỉ lần kéo toàn bộ (cron) bắt được.
  for (const [id, t] of mock.tasks) if (t.project.id === "p-fair") mock.tasks.set(id, { ...t, project: { ...t.project, name: "Hội chợ B (đổi tên)" } });
  const fairCount = [...mock.tasks.values()].filter((t) => t.project.id === "p-fair").length;
  await resetThrottle();
  r = await call(null, "GET", "/du-an/ats-tasks/cron", { Authorization: `Bearer ${CRON_SECRET}` });
  check("cron đúng secret → 200, kéo toàn bộ 56", r.s === 200 && r.j?.result?.fetched === 56, r);
  check(`cron: bắt đổi tên project (sửa ${fairCount})`, r.j?.result?.updated === fairCount, r.j?.result);

  // GET tự đồng bộ nền khi lần thử trước đã quá 5 phút
  await resetThrottle();
  const [c0] = await db.select().from(syncCursors).where(eq(syncCursors.userId, USER_ID));
  const reqBefore = mock.requests;
  await call(tok, "GET", "/du-an/ats-tasks");
  let bg = false;
  for (let i = 0; i < 20 && !bg; i++) {
    await sleep(500);
    const [c1] = await db.select().from(syncCursors).where(eq(syncCursors.userId, USER_ID));
    bg = c1.lastSuccessAt!.getTime() > c0.lastSuccessAt!.getTime();
  }
  check("GET cũ > 5 phút → đồng bộ nền chạy (after)", bg && mock.requests > reqBefore);
  const reqAfter = mock.requests;
  await call(tok, "GET", "/du-an/ats-tasks");
  await sleep(1500);
  check("GET ngay sau đó → không đồng bộ lại", mock.requests === reqAfter, mock.requests - reqAfter);

  // Nhật ký: chỉ ghi khi có thay đổi
  const logs = await db.select().from(activityLogs).where(and(eq(activityLogs.userId, USER_ID), eq(activityLogs.action, "ats.synced")));
  check("activity_logs ats.synced: 3 lần (sync 1, sync 3, cron)", logs.length === 3 && logs.every((l) => l.source === "DU_AN"), logs.map((l) => l.title));

  check("ats giả chỉ nhận GET", mock.nonGet === 0, mock.nonGet);
  check("ats giả: mọi request (trừ lúc giả 401) đều đúng token", mock.badAuth === 1, mock.badAuth);
}

main()
  .catch((e) => { fails++; console.error(e); })
  .finally(async () => {
    await db.delete(users).where(eq(users.id, USER_ID)).catch((e) => console.error("Dọn user lỗi:", e));
    const left = await db.select({ n: count() }).from(atsTasks).where(eq(atsTasks.userId, USER_ID));
    check("dọn: xoá user tạm (cascade ats_tasks)", left[0].n === 0);
    server.close();
    console.log(fails ? `\n${fails} FAIL` : "\nTẤT CẢ PASS");
    process.exit(fails ? 1 : 0);
  });
