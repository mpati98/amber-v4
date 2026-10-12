// Kiểm thử tích hợp việc hằng ngày + ghi buổi tập trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/routines-workout-e2e.ts — tạo user tạm, routine tạm, kiểm tra CHECK tick/untick, WORKOUT
// tạo/sửa/xoá, validate, khoá đổi kind, cô lập user, lastWorkout; rồi XÓA user tạm (cascade). Từ chối chạy nếu DB là
// production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routineLogs, routines, users, workoutExercises } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { addDaysIso } from "@/lib/deadline-alert";
import { vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const BASE = "http://localhost:3000/api/du-an/routines";
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
const call = async (tok: string | null, method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const exCount = async (routineId: string) => (await db.select({ id: workoutExercises.id }).from(workoutExercises)
  .innerJoin(routineLogs, eq(routineLogs.id, workoutExercises.routineLogId)).where(eq(routineLogs.routineId, routineId))).length;

async function main() {
  const today = vnToday(), yesterday = addDaysIso(today, -1), tomorrow = addDaysIso(today, 1);
  const mk = async () => (await db.insert(users).values({ email: `routines-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    check("401 không token", (await call(null, "GET", "")).s === 401);

    // ---- CHECK: tick / untick, hành vi cũ ----
    const c = await call(A, "POST", "", { name: "Uống nước" });
    check("POST mặc định kind CHECK", c.s === 201 && c.j.kind === "CHECK" && c.j.todayLog === null && !("lastWorkout" in c.j), c);
    const cid = c.j.id;
    const t1 = await call(A, "PUT", `/${cid}/logs/${today}`);
    check("CHECK tick hôm nay", t1.s === 200 && t1.j.doneToday === true && t1.j.streak >= 1 && t1.j.todayLog?.exercises?.length === 0 && t1.j.todayLog?.durationMinutes === null, t1);
    check("CHECK tick lại idempotent", (await call(A, "PUT", `/${cid}/logs/${today}`)).s === 200);
    check("CHECK tick ngày đã qua vẫn được (hành vi cũ)", (await call(A, "PUT", `/${cid}/logs/${yesterday}`)).s === 200);
    check("CHECK bỏ qua body thừa", (await call(A, "PUT", `/${cid}/logs/${today}`, { durationMinutes: 5 })).s === 200);
    check("CHECK ngày tương lai 400", (await call(A, "PUT", `/${cid}/logs/${tomorrow}`)).j?.error === "future_date");
    const u1 = await call(A, "DELETE", `/${cid}/logs/${today}`);
    check("CHECK untick", u1.s === 200 && u1.j.doneToday === false && u1.j.todayLog === null, u1);
    check("CHECK có log → đổi kind bị khoá 409", (await call(A, "PATCH", `/${cid}`, { kind: "WORKOUT" })).s === 409);
    check("PATCH kind giống kind hiện tại vẫn được", (await call(A, "PATCH", `/${cid}`, { kind: "CHECK", name: "Uống nước 2" })).s === 200);
    await call(A, "DELETE", `/${cid}/logs/${yesterday}`);
    const sw = await call(A, "PATCH", `/${cid}`, { kind: "WORKOUT" });
    check("CHECK hết log → đổi kind được", sw.s === 200 && sw.j.kind === "WORKOUT" && sw.j.lastWorkout === null, sw);
    check("kind sai giá trị 400", (await call(A, "PATCH", `/${cid}`, { kind: "X" })).s === 400);

    // ---- WORKOUT ----
    const w = await call(A, "POST", "", { name: "Tập thể dục", kind: "WORKOUT" });
    check("POST WORKOUT: lastWorkout null", w.s === 201 && w.j.kind === "WORKOUT" && w.j.lastWorkout === null, w);
    const wid = w.j.id;
    const body = { durationMinutes: 30, exercises: [
      { name: "Chống đẩy", measure: "REPS", reps: 20 },
      { name: "Squat", measure: "SETS_REPS", sets: 3, reps: 15 },
      { name: "Plank", measure: "DURATION", durationSeconds: 60 } ] };
    check("WORKOUT thiếu body 400", (await call(A, "PUT", `/${wid}/logs/${today}`)).s === 400);
    check("WORKOUT REPS thiếu reps 400", (await call(A, "PUT", `/${wid}/logs/${today}`, { durationMinutes: 5, exercises: [{ name: "a", measure: "REPS" }] })).s === 400);
    check("WORKOUT SETS_REPS thiếu sets 400", (await call(A, "PUT", `/${wid}/logs/${today}`, { durationMinutes: 5, exercises: [{ name: "a", measure: "SETS_REPS", reps: 5 }] })).s === 400);
    check("WORKOUT DURATION thiếu giây 400", (await call(A, "PUT", `/${wid}/logs/${today}`, { durationMinutes: 5, exercises: [{ name: "a", measure: "DURATION" }] })).s === 400);
    check("WORKOUT ngày đã qua → not_today", (await call(A, "PUT", `/${wid}/logs/${yesterday}`, body)).j?.error === "not_today");
    check("WORKOUT ngày tương lai → future_date", (await call(A, "PUT", `/${wid}/logs/${tomorrow}`, body)).j?.error === "future_date");
    check("lỗi validate không để lại log", (await db.select().from(routineLogs).where(eq(routineLogs.routineId, wid))).length === 0);
    check("user khác 404", (await call(B, "PUT", `/${wid}/logs/${today}`, body)).s === 404);

    const p1 = await call(A, "PUT", `/${wid}/logs/${today}`, body);
    check("WORKOUT tạo log", p1.s === 200 && p1.j.doneToday === true && p1.j.todayLog.durationMinutes === 30
      && p1.j.todayLog.exercises.length === 3 && p1.j.todayLog.exercises[1].name === "Squat"
      && p1.j.todayLog.exercises[1].sets === 3 && p1.j.todayLog.exercises[0].sets === null && p1.j.todayLog.exercises[2].durationSeconds === 60
      && p1.j.todayLog.exercises.map((e: any) => e.position).join() === "0,1,2", p1);
    const p2 = await call(A, "PUT", `/${wid}/logs/${today}`, { durationMinutes: 45, exercises: [{ name: "Plank", measure: "DURATION", durationSeconds: 90 }] });
    check("WORKOUT sửa: thay cả danh sách", p2.s === 200 && p2.j.todayLog.durationMinutes === 45 && p2.j.todayLog.exercises.length === 1 && await exCount(wid) === 1, p2);
    check("sửa không nhân đôi log", (await db.select().from(routineLogs).where(eq(routineLogs.routineId, wid))).length === 1);
    const p3 = await call(A, "PUT", `/${wid}/logs/${today}`, { durationMinutes: 10 });
    check("WORKOUT chỉ số phút, exercises rỗng", p3.s === 200 && p3.j.todayLog.exercises.length === 0 && await exCount(wid) === 0, p3);
    await call(A, "PUT", `/${wid}/logs/${today}`, body);
    const g = await call(A, "GET", "");
    const gw = g.j.find((r: any) => r.id === wid);
    check("GET: todayLog + exercises theo position, lastWorkout null", g.s === 200 && gw.todayLog.exercises.length === 3 && gw.lastWorkout === null, gw);
    check("WORKOUT có log → đổi kind 409", (await call(A, "PATCH", `/${wid}`, { kind: "CHECK" })).s === 409);

    // lastWorkout: buổi hôm qua (chèn thẳng DB vì API chỉ cho hôm nay) và buổi hôm nay không tính vào lastWorkout
    const [yl] = await db.insert(routineLogs).values({ routineId: wid, logDate: yesterday, durationMinutes: 20 }).returning({ id: routineLogs.id });
    await db.insert(workoutExercises).values([
      { routineLogId: yl.id, position: 1, name: "B", measure: "REPS", reps: 5 },
      { routineLogId: yl.id, position: 0, name: "A", measure: "SETS_REPS", sets: 2, reps: 8 } ]);
    const g2 = (await call(A, "GET", "")).j.find((r: any) => r.id === wid);
    check("lastWorkout = bài buổi gần nhất trước hôm nay, theo position", g2.lastWorkout?.map((e: any) => e.name).join() === "A,B" && g2.todayLog.exercises.length === 3, g2);
    const g3 = (await call(A, "GET", `?date=${tomorrow}`)).j.find((r: any) => r.id === wid);
    check("GET ?date=ngày mai: lastWorkout là buổi hôm nay", g3.lastWorkout?.length === 3 && g3.todayLog === null, g3);

    // ---- DELETE: cascade ----
    const d = await call(A, "DELETE", `/${wid}/logs/${today}`);
    check("DELETE log hôm nay: todayLog null, bài bị xoá theo", d.s === 200 && d.j.todayLog === null && d.j.doneToday === false && await exCount(wid) === 2, d);
    check("DELETE chỉ xoá log đúng ngày (bài hôm qua còn)", (await db.select().from(routineLogs).where(eq(routineLogs.routineId, wid))).length === 1);
    check("DELETE routine cascade log + bài", (await call(A, "DELETE", `/${wid}`)).s === 200 && await exCount(wid) === 0);
  } finally {
    // user tạm xoá → routines → routine_logs → workout_exercises đều cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const left = await db.select({ id: routines.id }).from(routines).where(eq(routines.userId, a.id));
    check("dọn dữ liệu test", left.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
