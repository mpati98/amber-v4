// Kiểm thử tích hợp màn chủ 3D trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/world-e2e.ts — tạo 2 user tạm; kiểm giấc ngủ (PUT/GET/DELETE, validate, cô lập user),
// GET /api/kieu-lau/world (chỉ số, sự kiện, con trỏ since không lặp dòng), GET /api/kieu-lau/weather; rồi XÓA user tạm (cascade).
// Từ chối chạy nếu DB là production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routineLogs, routines, skillScores, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { logActivity } from "@/lib/activity-log";
import { vnToday } from "@/lib/vn-time";
import { addDays } from "@/lib/world-summary";

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

async function main() {
  const today = vnToday();
  const mk = async () => (await db.insert(users).values({ email: `world-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    for (const p of ["/du-an/sleep", "/kieu-lau/world", "/kieu-lau/weather"]) check(`401 không token ${p}`, (await call(null, "GET", p)).s === 401);

    // ---- Giấc ngủ ----
    check("PUT thiếu phút 400", (await call(A, "PUT", "/du-an/sleep", { date: today })).s === 400);
    check("PUT chất lượng 6 → 400", (await call(A, "PUT", "/du-an/sleep", { date: today, sleepMinutes: 400, quality: 6 })).s === 400);
    check("PUT ngày tương lai → future_date", (await call(A, "PUT", "/du-an/sleep", { date: addDays(today, 1), sleepMinutes: 400 })).j?.error === "future_date");
    check("PUT quá 60 ngày → too_old", (await call(A, "PUT", "/du-an/sleep", { date: addDays(today, -61), sleepMinutes: 400 })).j?.error === "too_old");
    const p1 = await call(A, "PUT", "/du-an/sleep", { date: today, sleepMinutes: 390, quality: 3, note: "  " });
    check("PUT ghi đêm qua", p1.s === 200 && p1.j.log.sleepMinutes === 390 && p1.j.log.note === null, p1);
    const p2 = await call(A, "PUT", "/du-an/sleep", { date: today, sleepMinutes: 480, quality: 5 });
    check("PUT lần hai cùng ngày = sửa", p2.s === 200 && p2.j.log.sleepMinutes === 480 && p2.j.log.quality === 5, p2);
    await call(A, "PUT", "/du-an/sleep", { date: addDays(today, -1), sleepMinutes: 300 });
    const g = await call(A, "GET", "/du-an/sleep?days=7");
    check("GET: 2 đêm, mới trước", g.s === 200 && g.j.logs.length === 2 && g.j.logs[0].date === today && g.j.today === today, g);
    check("cô lập user: B không thấy", (await call(B, "GET", "/du-an/sleep")).j?.logs?.length === 0);
    check("cô lập user: B xoá được 404", (await call(B, "DELETE", `/du-an/sleep/${today}`)).s === 404);
    check("DELETE đêm hôm qua", (await call(A, "DELETE", `/du-an/sleep/${addDays(today, -1)}`)).s === 200);
    check("DELETE lại → 404", (await call(A, "DELETE", `/du-an/sleep/${addDays(today, -1)}`)).j?.error === "sleep_not_found");

    // ---- Chỉ số ----
    const [r] = await db.insert(routines).values({ userId: a.id, name: "Tập", kind: "WORKOUT" }).returning({ id: routines.id });
    await db.insert(routineLogs).values([{ routineId: r.id, logDate: today, durationMinutes: 45 }, { routineId: r.id, logDate: addDays(today, -3), durationMinutes: 30 }, { routineId: r.id, logDate: addDays(today, -8), durationMinutes: 99 }]);
    await db.insert(skillScores).values([{ userId: a.id, skill: "GRAMMAR", score: 60 }, { userId: a.id, skill: "READING", score: 80 }, { userId: a.id, skill: "WRITING", score: null }]);
    const w = await call(A, "GET", "/kieu-lau/world");
    check("world: đủ 5 chỉ số", w.s === 200 && ["sinhLuc", "nganKho", "triThuc", "kyNang", "heThong"].every((k) => k in w.j.stats), w);
    // ngủ 8 giờ chất lượng 5 → 100; vận động 75 phút/7 ngày (bỏ buổi 8 ngày trước) → 50; 0,6·100 + 0,4·50 = 80
    check("sinhLuc dùng giấc ngủ thật + vận động 7 ngày", w.j.stats.sinhLuc.v === 80 && !w.j.stats.sinhLuc.sample && /75 phút/.test(w.j.stats.sinhLuc.src), w.j.stats.sinhLuc);
    check("kyNang = trung bình điểm có giá trị", w.j.stats.kyNang.v === 70, w.j.stats.kyNang);
    check("heThong null khi brain chưa gửi gì", w.j.stats.heThong.v === null, w.j.stats.heThong);
    check("nganKho null khi chưa có tháng tài chính", w.j.stats.nganKho.v === null, w.j.stats.nganKho);
    const wb = await call(B, "GET", "/kieu-lau/world");
    check("B: sinhLuc dùng đêm mẫu", wb.j.stats.sinhLuc.sample === true && wb.j.stats.kyNang.v === null, wb.j.stats);

    // ---- Sự kiện + con trỏ ----
    check("chưa có hoạt động: events rỗng, cursor null", w.j.events.length === 0 && w.j.cursor === null, w.j);
    for (const [source, title] of [["FINANCE", "Chi 50.000đ"], ["TRA_DINH", "Học 30 phút"], ["MUSIC", "Thêm bài"], ["DU_AN", "Xong việc"]] as const) {
      await logActivity({ userId: a.id, source, action: "x.created", title });
    }
    const first = await call(A, "GET", "/kieu-lau/world");
    check("lần đầu (không since): 3 dòng gần nhất, cũ trước", first.j.events.length === 3 && first.j.events[0].text === "Học 30 phút" && first.j.events[2].from === "nghisu", first.j.events);
    check("cursor có micro giây", /\.\d{6}Z$/.test(first.j.cursor ?? ""), first.j.cursor);
    const again = await call(A, "GET", `/kieu-lau/world?since=${encodeURIComponent(first.j.cursor)}`);
    check("since = cursor: không đọc lại dòng cũ", again.s === 200 && again.j.events.length === 0 && again.j.cursor === first.j.cursor, again.j);
    await logActivity({ userId: a.id, source: "KIEU_LAU", action: "feed.added", title: "Thêm nguồn RSS" });
    const next = await call(A, "GET", `/kieu-lau/world?since=${encodeURIComponent(first.j.cursor)}`);
    check("since: chỉ dòng mới", next.j.events.length === 1 && next.j.events[0].from === "kieulau" && next.j.cursor !== first.j.cursor, next.j);
    check("since sai định dạng 400", (await call(A, "GET", "/kieu-lau/world?since=hom-qua")).s === 400);
    check("B không thấy hoạt động của A", (await call(B, "GET", "/kieu-lau/world")).j.events.length === 0);

    // ---- Thời tiết (gọi Open-Meteo thật) ----
    const wx = await call(A, "GET", "/kieu-lau/weather");
    check("weather: dạng setWeather", wx.s === 200 && typeof wx.j.code === "number" && typeof wx.j.temp === "number" && wx.j.sunrise > 4 && wx.j.sunrise < 8 && wx.j.sunset > 16 && wx.j.sunset < 20, wx);
  } finally {
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
  }
  console.log(fails ? `\n${fails} FAIL` : "\nTất cả PASS");
  process.exit(fails ? 1 : 0);
}
main();
