// Kiểm thử tích hợp kinh tế Âm Dương Giới trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/economy-e2e.ts — tạo 2 user tạm; nạp task / buổi học / buổi tập / giấc ngủ thẳng vào DB, kiểm
// đối soát + dựng lại (thêm, sửa, xoá bản ghi quá khứ, idempotent, dựng lại toàn bộ = dựng dần), chế độ bóng,
// rồi qua HTTP: GET /api/kieu-lau/kinh-te, POST /rebuild, hook sau PATCH /api/tasks/:id, cô lập user. XÓA user tạm ở cuối.
// Từ chối chạy nếu DB là production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { economyEvents, ledgerEntries, routineLogs, routines, sleepLogs, studyLogs, studySubjects, tasks, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { addDaysIso } from "@/lib/deadline-alert";
import { vnToday } from "@/lib/vn-time";
import { economySummary, syncEconomy } from "@/lib/economy-db";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const BASE = "http://localhost:3000/api";
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (tok: string | null, method: string, path: string, body?: unknown): Promise<{ s: number; j: any }> => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const vnAt = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ledgerRows(userId: string) {
  return db
    .select({ eventId: ledgerEntries.eventId, ruleId: ledgerEntries.ruleId, key: ledgerEntries.key, rawAmount: ledgerEntries.rawAmount, amount: ledgerEntries.amount, shadow: ledgerEntries.shadow, vnDate: ledgerEntries.vnDate })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId))
    .orderBy(asc(ledgerEntries.vnDate), asc(ledgerEntries.eventId), asc(ledgerEntries.ruleId), asc(ledgerEntries.key));
}

async function main() {
  const today = vnToday();
  const d1 = addDaysIso(today, -1), d2 = addDaysIso(today, -2), d3 = addDaysIso(today, -3);
  const mk = async () => (await db.insert(users).values({ email: `economy-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    // ---- Dữ liệu nguồn của A ----
    const [t1] = await db.insert(tasks).values({ userId: a.id, title: "E2E đúng hạn", status: "DONE", importance: 2, urgency: 2, durationMinutes: 120, dueDate: today, statusChangedAt: vnAt(d1, "10:00") }).returning();
    const [t2] = await db.insert(tasks).values({ userId: a.id, title: "E2E trễ hạn", status: "DONE", importance: 2, urgency: 2, durationMinutes: 60, actualMinutes: 90, dueDate: d3, statusChangedAt: vnAt(d2, "15:00") }).returning();
    await db.insert(tasks).values({ userId: a.id, title: "E2E chưa xong", status: "PREP", importance: 2, urgency: 2 });
    const [subj] = await db.insert(studySubjects).values({ userId: a.id, name: "E2E môn" }).returning();
    const [log] = await db.insert(studyLogs).values({ userId: a.id, subjectId: subj.id, logDate: today, minutes: 60, createdAt: vnAt(today, "08:00") }).returning();
    const [rt] = await db.insert(routines).values({ userId: a.id, name: "E2E tập", kind: "WORKOUT" }).returning();
    const [rl] = await db.insert(routineLogs).values({ routineId: rt.id, logDate: d1, durationMinutes: 30, createdAt: null }).returning();

    // ---- Đối soát lần đầu ----
    const s1 = await syncEconomy(a.id);
    check("lần đầu: 4 sự kiện, dựng từ ngày sớm nhất", s1.upserted === 4 && s1.removed === 0 && s1.rebuiltFrom === d2, s1);
    const ev = await db.select({ eventId: economyEvents.eventId, vnDate: economyEvents.vnDate }).from(economyEvents).where(eq(economyEvents.userId, a.id));
    const ids = ev.map((e) => e.eventId).sort();
    const want = [`amber-task:${t1.id}:done`, `amber-task:${t2.id}:done`, `routine-log:${rl.id}`, `study-log:${log.id}`].sort();
    check("eventId ổn định theo nguồn", JSON.stringify(ids) === JSON.stringify(want), ids);
    check("buổi tập cũ không created_at → 21:30 cùng ngày", ev.find((e) => e.eventId.startsWith("routine-log:"))?.vnDate === d1);

    let sum = await economySummary(a.id, { includeShadow: true });
    // Không có dữ liệu sức khoẻ trước đó ⇒ Sức khoẻ = 70 ⇒ +10%: t1 = 4 × 2 × 1.1 = 8.8; học 60 phút = 10; t2 trễ: phạt 2 ở chế độ bóng
    check("số dư = thưởng (phạt bị giữ ở chế độ bóng)", sum.balance === 18.8, sum.balance);
    check("số dư nếu đã bật phạt", sum.shadow.balanceIfLive === 16.8, sum.shadow);
    check("phạt bóng: 1 entry, -2", sum.shadow.active && sum.shadow.hiddenPenalties.count === 1 && sum.shadow.hiddenPenalties.total === -2, sum.shadow.hiddenPenalties);
    const pen = sum.entries.find((x) => x.shadow);
    check("entry phạt bóng có ruleId + eventId", pen?.ruleId === "task_late" && pen.eventId === `amber-task:${t2.id}:done` && pen.amount === 0 && pen.rawAmount === -2, pen);
    check("thể lực hao theo giờ thực tế (t2: 1.5 giờ → -9)", (await ledgerRows(a.id)).some((x) => x.eventId === `amber-task:${t2.id}:done` && x.key === "stamina" && x.amount === -9));
    check("ẩn phạt bóng khi không yêu cầu", (await economySummary(a.id)).entries.every((x) => !x.shadow));

    // ---- Idempotent ----
    const s2 = await syncEconomy(a.id);
    check("gọi lại không đổi gì, không dựng lại", s2.upserted === 0 && s2.removed === 0 && s2.rebuiltFrom === null, s2);

    // ---- Sửa / xoá bản ghi quá khứ ----
    await db.update(tasks).set({ status: "REVIEW", statusChangedAt: new Date() }).where(eq(tasks.id, t1.id));
    const s3 = await syncEconomy(a.id);
    check("task mở lại: xoá sự kiện, dựng lại từ ngày nó hoàn thành", s3.removed === 1 && s3.rebuiltFrom === d1, s3);
    check("số dư về như chưa hoàn thành", (await economySummary(a.id)).balance === 10);
    check("entry của task mở lại bị xoá theo", (await ledgerRows(a.id)).every((x) => x.eventId !== `amber-task:${t1.id}:done`));

    await db.update(studyLogs).set({ minutes: 30 }).where(eq(studyLogs.id, log.id));
    const s4 = await syncEconomy(a.id);
    check("sửa phút học: cập nhật sự kiện", s4.upserted === 1 && s4.rebuiltFrom === today, s4);
    check("số dư theo phút mới", (await economySummary(a.id)).balance === 5);

    await db.update(tasks).set({ dueDate: d2 }).where(eq(tasks.id, t2.id));
    const s5 = await syncEconomy(a.id);
    sum = await economySummary(a.id);
    check("sửa hạn task quá khứ → thành đúng hạn, dựng lại từ ngày đó", s5.upserted === 1 && s5.rebuiltFrom === d2 && sum.balance === 5 + 4.4, { s5, b: sum.balance });

    // Giấc ngủ quá khứ đổi Sức khoẻ ⇒ +10% mất ở ngày sau
    await db.insert(sleepLogs).values({ userId: a.id, date: d3, sleepMinutes: 180, quality: 1 });
    const s6 = await syncEconomy(a.id, { changedFrom: d3 });
    sum = await economySummary(a.id);
    check("giấc ngủ quá khứ: dựng lại từ ngày đó", s6.rebuiltFrom === d3 && s6.upserted === 0, s6);
    check("Sức khoẻ < 70 ⇒ mất +10% (t2 = 4)", sum.balance === 5 + 4 && sum.health.prevDay < 70, { b: sum.balance, h: sum.health });

    await db.delete(studyLogs).where(eq(studyLogs.id, log.id));
    const s7 = await syncEconomy(a.id);
    check("xoá buổi học: xoá sự kiện", s7.removed === 1 && (await economySummary(a.id)).balance === 4, s7);

    // ---- Dựng lại toàn bộ = dựng dần ----
    const before = await ledgerRows(a.id);
    const s8 = await syncEconomy(a.id, { full: true });
    check("dựng lại toàn bộ cho cùng sổ cái", s8.rebuiltFrom === "0001-01-01" && JSON.stringify(await ledgerRows(a.id)) === JSON.stringify(before));

    // ---- HTTP ----
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    check("401 không token", (await call(null, "GET", "/kieu-lau/kinh-te")).s === 401);
    const g = await call(A, "GET", "/kieu-lau/kinh-te");
    check("GET 200 + số dư + chế độ bóng", g.s === 200 && g.j.balance === 4 && g.j.shadow.active === true && Array.isArray(g.j.entries), g);
    check("GET limit sai → 400", (await call(A, "GET", "/kieu-lau/kinh-te?limit=0")).s === 400);
    check("POST rebuild 200", (await call(A, "POST", "/kieu-lau/kinh-te/rebuild")).s === 200);

    // Hook: PATCH task về DONE kèm giờ thực tế ⇒ sự kiện xuất hiện mà KHÔNG cần gọi GET kinh tế
    const p = await call(A, "PATCH", `/tasks/${t1.id}`, { status: "DONE", actualMinutes: 45 });
    check("PATCH task nhận actualMinutes", p.s === 200 && p.j.actualMinutes === 45, p);
    check("PATCH actualMinutes âm → 400", (await call(A, "PATCH", `/tasks/${t1.id}`, { actualMinutes: -1 })).s === 400);
    let hooked = false;
    for (let i = 0; i < 20 && !hooked; i++) {
      await sleep(250);
      const [row] = await db.select({ data: economyEvents.data }).from(economyEvents).where(and(eq(economyEvents.userId, a.id), eq(economyEvents.eventId, `amber-task:${t1.id}:done`)));
      hooked = !!row && (row.data as { hours?: number }).hours === 0.75;
    }
    check("hook sau PATCH đồng bộ sự kiện (giờ thực tế 0.75)", hooked);

    const gb = await call(B, "GET", "/kieu-lau/kinh-te?shadow=1");
    check("user B không thấy gì của A", gb.s === 200 && gb.j.balance === 0 && gb.j.entries.length === 0, gb.j);
  } finally {
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const left = await db.select({ n: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.userId, a.id));
    check("dọn sạch: entry xoá theo user (cascade qua sự kiện)", left.length === 0);
  }
  console.log(fails ? `${fails} FAIL` : "Tất cả PASS");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
