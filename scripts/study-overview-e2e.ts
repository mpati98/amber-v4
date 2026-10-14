// Kiểm thử tích hợp tổng quan + lịch + thống kê Học tập trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-overview-e2e.ts — tạo 2 user tạm, môn + 3 khóa, chèn log các ngày trước bằng SQL, gọi 3 route
// chỉ-đọc rồi đối chiếu số; kiểm tra 400 range_too_large / thiếu subjectId; rồi XÓA user tạm (cascade). Từ chối chạy nếu DB
// là production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCourses, studyLogs, studySubjects, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { addDaysIso } from "@/lib/deadline-alert";
import { isoWeekday } from "@/lib/routine-stats";
import { vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const HT = "http://localhost:3000/api/tra-dinh/hoc-tap";
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const call = async (tok: string | null, method: string, path: string, body?: unknown): Promise<{ s: number; j: Json }> => {
  const r = await fetch(HT + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: Json = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};

async function main() {
  const today = vnToday();
  const d1 = addDaysIso(today, -1), d2 = addDaysIso(today, -2), d3 = addDaysIso(today, -3);
  const mondayOf = (d: string) => addDaysIso(d, 1 - isoWeekday(d));
  const mon = mondayOf(today), sun = addDaysIso(mon, 6);
  const mk = async () => (await db.insert(users).values({ email: `study-overview-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const H = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, p, body);

    const sid = (await H("POST", "/subjects", { name: "Tiếng Anh", dailyGoalMinutes: 60 })).j.id;
    const sidNoGoal = (await H("POST", "/subjects", { name: "Không mục tiêu" })).j.id;
    const c1 = (await H("POST", "/courses", { subjectId: sid, title: "Khóa 1", status: "ACTIVE", sectionsText: "P1 40min\nP2 40min" })).j;
    const c2 = (await H("POST", "/courses", { subjectId: sid, title: "Khóa 2", sectionsText: "Q1 40min" })).j;
    const c3 = (await H("POST", "/courses", { subjectId: sid, title: "Khóa xong", status: "DONE" })).j;
    check("dựng dữ liệu: C1 ACTIVE, C2 QUEUED, C3 DONE", c1.status === "ACTIVE" && c2.status === "QUEUED" && c3.status === "DONE", [c1.status, c2.status, c3.status]);

    // log quá khứ chèn thẳng DB; hôm nay ghi qua API
    const ins = (logDate: string, minutes: number, courseId: string | null) => db.insert(studyLogs).values({ userId: a.id, subjectId: sid, courseId, logDate, minutes });
    await ins(d3, 60, c1.id); await ins(d2, 30, null); await ins(d1, 90, c1.id);
    await H("PUT", `/subjects/${sid}/reasons/${d2}`, { code: "BUSY" });
    const todayLog = await H("POST", "/logs", { subjectId: sid, courseId: c1.id, minutes: 20 });
    check("log hôm nay", todayLog.s === 201);
    const byDate: Record<string, number> = { [d3]: 60, [d2]: 30, [d1]: 90, [today]: 20 };

    // ---- overview ----
    const ov = await H("GET", "/overview");
    const o = ov.j;
    check("overview 200, today đúng", ov.s === 200 && o.today === today, ov);
    const inWeek = Object.entries(byDate).filter(([d]) => d >= mon && d <= sun).reduce((n, [, m]) => n + m, 0);
    const remDays = 8 - isoWeekday(today);
    check("week: start/end thứ Hai–Chủ nhật, goal = 60×7", o.week.start === mon && o.week.end === sun && o.week.goalMinutes === 420 && o.week.days.length === 7, o.week);
    check("week: minutes = tổng log trong tuần, remaining/remainingDays/suggestedPerDay", o.week.minutes === inWeek && o.week.remainingMinutes === Math.max(0, 420 - inWeek) && o.week.remainingDays === remDays
      && o.week.suggestedPerDay === (420 - inWeek > 0 ? Math.ceil((420 - inWeek) / remDays) : 0), o.week);
    check("week.days theo ngày", o.week.days.every((d: Json) => d.minutes === (byDate[d.date] ?? 0) && d.goalMinutes === 60 && d.done === ((byDate[d.date] ?? 0) >= 60)), o.week.days);
    check("week.bySubject chỉ môn có mục tiêu (goal×7)", o.week.bySubject.length === 1 && o.week.bySubject[0].subjectId === sid && o.week.bySubject[0].goalMinutes === 420 && o.week.bySubject[0].minutes === inWeek, o.week.bySubject);
    const sa = o.subjects.find((s: Json) => s.subjectId === sid), sb = o.subjects.find((s: Json) => s.subjectId === sidNoGoal);
    check("subjects theo position, môn không mục tiêu goal null", o.subjects.length === 2 && o.subjects[0].subjectId === sid && sb.goalMinutes === null && sb.today.done === false, o.subjects);
    check("subject.today: 20', 1 buổi, chưa done", sa.today.minutes === 20 && sa.today.logCount === 1 && sa.today.done === false && sa.today.reason === null, sa.today);
    check("subject.next = phần P1 của khóa ACTIVE", sa.next?.courseId === c1.id && sa.next.sectionTitle === "P1" && sa.next.courseTitle === "Khóa 1", sa.next);
    check("subject.activeCourse + counts", sa.activeCourse?.id === c1.id && sa.counts.QUEUED === 1 && sa.counts.DONE === 1 && sa.counts.WISHLIST === 0, [sa.activeCourse?.id, sa.counts]);
    check("vsBaseline = deltaDays khóa cuối hàng học", sa.vsBaseline === (await H("GET", `/courses/${c2.id}`)).j.deltaDays, sa.vsBaseline);
    check("overview user khác: rỗng", (await H("GET", "/overview", undefined, B)).j.subjects.length === 0);
    check("overview 401", (await call(null, "GET", "/overview")).s === 401);

    // ---- schedule ----
    const to = addDaysIso(today, 10);
    const sc = await H("GET", `/schedule?subjectId=${sid}&from=${d3}&to=${to}`);
    const days: Json[] = sc.j.days;
    const day = (d: string) => days.find((x) => x.date === d);
    check("schedule 200, số ngày", sc.s === 200 && days.length === 14, sc.s);
    check("kind past/today/planned", day(d3).kind === "past" && day(today).kind === "today" && day(addDaysIso(today, 1)).kind === "planned");
    check("past: minutes/done/extraMinutes", day(d3).minutes === 60 && day(d3).done === true && day(d3).extraMinutes === 0 && day(d1).minutes === 90 && day(d1).extraMinutes === 30 && day(d2).done === false, [day(d3), day(d1)]);
    check("past: reason BUSY ở d2, logs có courseTitle", day(d2).reason?.code === "BUSY" && day(d1).logs[0].courseTitle === "Khóa 1" && day(d2).logs[0].courseTitle === null && day(d1).reason === null, [day(d2), day(d1)]);
    check("today có log → minutes 20, không plannedItems", day(today).minutes === 20 && day(today).logs.length === 1 && !("plannedItems" in day(today)), day(today));
    const plannedDays = days.filter((d) => d.kind === "planned");
    const review = plannedDays.filter((d) => d.isReviewDay);
    check("ngày review (Chủ nhật): plannedItems rỗng", review.length >= 1 && review.every((d) => d.plannedItems.length === 0), review);
    const itemsMinutes = plannedDays.reduce((n, d) => n + d.plannedItems.reduce((m: number, i: Json) => m + i.minutes, 0), 0);
    check("kế hoạch: còn 80 (P1,P2) + 40 (Q1) = 120' từ ngày mai, mỗi ngày ≤ 40'", sc.j.summary.plannedMinutes === 120 && itemsMinutes === 120 && plannedDays.every((d) => d.plannedItems.reduce((m: number, i: Json) => m + i.minutes, 0) <= 40), sc.j.summary);
    const first = plannedDays.find((d) => d.plannedItems.length > 0);
    check("plannedItems đủ trường", first.plannedItems[0].courseTitle === "Khóa 1" && typeof first.plannedItems[0].sectionId === "string" && typeof first.plannedItems[0].title === "string", first);
    const c1Now = (await H("GET", `/courses/${c1.id}`)).j, c2Now = (await H("GET", `/courses/${c2.id}`)).j;
    check("milestone finish đúng ngày forecast của C1, C2", day(c1Now.forecastFinishDate)?.milestones.some((m: Json) => m.courseId === c1.id && m.type === "finish") && day(c2Now.forecastFinishDate)?.milestones.some((m: Json) => m.courseId === c2.id), [c1Now.forecastFinishDate, c2Now.forecastFinishDate]);
    check("milestone khóa DONE ở ngày finished_at (hôm nay)", day(today).milestones.some((m: Json) => m.courseId === c3.id), day(today).milestones);
    check("summary.minutes = 200; vsBaseline chỉ khóa ACTIVE/QUEUED", sc.j.summary.minutes === 200 && sc.j.summary.vsBaseline.map((c: Json) => c.courseId).join() === [c1.id, c2.id].join()
      && sc.j.summary.vsBaseline[0].baselineFinishDate === c1Now.baselineFinishDate && sc.j.summary.vsBaseline[0].deltaDays === c1Now.deltaDays, sc.j.summary);
    const pastOnly = await H("GET", `/schedule?subjectId=${sid}&from=${d3}&to=${d1}`);
    check("khoảng toàn quá khứ: không plannedItems, plannedMinutes 0", pastOnly.s === 200 && pastOnly.j.days.every((d: Json) => d.kind === "past" && !("plannedItems" in d)) && pastOnly.j.summary.plannedMinutes === 0 && pastOnly.j.summary.minutes === 180, pastOnly.j.summary);
    check("schedule thiếu subjectId → 400", (await H("GET", `/schedule?from=${d3}&to=${today}`)).s === 400);
    check("schedule > 62 ngày → range_too_large", (await H("GET", `/schedule?subjectId=${sid}&from=${today}&to=${addDaysIso(today, 62)}`)).j?.error === "range_too_large");
    check("schedule đúng 62 ngày OK", (await H("GET", `/schedule?subjectId=${sid}&from=${today}&to=${addDaysIso(today, 61)}`)).s === 200);
    check("schedule ngày sai → 400", (await H("GET", `/schedule?subjectId=${sid}&from=2026-13-01&to=${today}`)).s === 400);
    check("schedule to < from → 400", (await H("GET", `/schedule?subjectId=${sid}&from=${today}&to=${d1}`)).s === 400);
    check("schedule môn user khác → 404", (await H("GET", `/schedule?subjectId=${sid}&from=${d3}&to=${today}`, undefined, B)).s === 404);

    // ---- stats ----
    const st = await H("GET", "/stats?range=7");
    const s = st.j;
    check("stats 7: khoảng, tổng, số buổi, avgPerDay", st.s === 200 && s.from === addDaysIso(today, -6) && s.to === today && s.totalMinutes === 200 && s.logCount === 4 && s.avgPerDay === Math.round(200 / 7), s);
    check("stats: goalDays không phạt hôm nay chưa đủ (2/3)", s.goalDays.met === 2 && s.goalDays.total === 3, s.goalDays);
    check("stats: bucket day, series 7 điểm, goal 60", s.bucket === "day" && s.series.length === 7 && s.series.every((p: Json) => p.goalMinutes === 60 && p.minutes === (byDate[p.start] ?? 0)), s.series);
    check("stats: byCourse gom 'Ôn tập', nhiều phút trước", JSON.stringify(s.byCourse) === JSON.stringify([{ courseId: c1.id, title: "Khóa 1", minutes: 170, logCount: 3 }, { courseId: null, title: "Ôn tập", minutes: 30, logCount: 1 }]), s.byCourse);
    check("stats: longestDay = hôm qua 90'", s.longestDay?.date === d1 && s.longestDay.minutes === 90, s.longestDay);
    check("stats: topWeekday = thứ của hôm qua", s.topWeekday?.weekday === isoWeekday(d1) && s.topWeekday.minutes === 90, s.topWeekday);
    check("stats: reasonCounts BUSY 1", s.reasonCounts.BUSY === 1 && s.reasonCounts.TIRED === 0, s.reasonCounts);
    const vp = Object.fromEntries(s.vsPlan.map((c: Json) => [c.courseId, c]));
    check("stats: vsPlan C1/C2/C3 (WISHLIST bị loại), C3 DONE 100%", s.vsPlan.length === 3 && vp[c3.id].status === "DONE" && vp[c3.id].progressPct === 100 && vp[c3.id].finishedDate === today && vp[c1.id].progressPct === 0 && vp[c1.id].deltaDays === c1Now.deltaDays, s.vsPlan);
    check("stats: overallDeltaDays mỗi môn", s.overallDeltaDays.length === 2 && s.overallDeltaDays.find((x: Json) => x.subjectId === sid).deltaDays === c2Now.deltaDays, s.overallDeltaDays);
    const all = (await H("GET", "/stats?range=all")).j;
    check("stats all: từ log đầu tiên", all.from === d3 && all.totalMinutes === 200 && all.series.length === 4 && all.bucket === "day", all);
    const def = (await H("GET", "/stats")).j;
    check("stats mặc định 30 ngày", def.from === addDaysIso(today, -29) && def.series.length === 30 && def.totalMinutes === 200, def.from);
    const one = (await H("GET", `/stats?subjectId=${sidNoGoal}&range=all`)).j;
    check("stats môn không log, range=all: 0 và mảng rỗng", one.totalMinutes === 0 && one.series.length === 0 && one.byCourse.length === 0 && one.longestDay === null && one.topWeekday === null && one.goalDays.total === 0, one);
    check("stats lọc theo môn có log", (await H("GET", `/stats?subjectId=${sid}&range=7`)).j.totalMinutes === 200);
    check("stats range sai → 400", (await H("GET", "/stats?range=14")).s === 400);
    check("stats môn user khác → 404", (await H("GET", `/stats?subjectId=${sid}`, undefined, B)).s === 404);
    check("stats user khác không thấy dữ liệu", (await H("GET", "/stats?range=all", undefined, B)).j.totalMinutes === 0);

    // chỉ đọc: gọi route không làm đổi số khóa/log
    check("chỉ đọc: số log không đổi sau khi gọi các route", (await db.select({ id: studyLogs.id }).from(studyLogs).where(eq(studyLogs.subjectId, sid))).length === 4);
  } finally {
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const left = await db.select({ id: studySubjects.id }).from(studySubjects).where(eq(studySubjects.userId, a.id));
    const leftC = await db.select({ id: studyCourses.id }).from(studyCourses).where(eq(studyCourses.userId, a.id));
    check("dọn dữ liệu test", left.length === 0 && leftC.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
