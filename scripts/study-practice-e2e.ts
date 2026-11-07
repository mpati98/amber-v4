// Kiểm thử tích hợp hoạt động PRACTICE (luyện chat AI) trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-practice-e2e.ts — tạo 2 user tạm rồi kiểm tra ghi buổi PRACTICE (quy tắc như CARD_REVIEW,
// practiceSessionId: 404 / 409 kể cả song song), PATCH (activity_locked), phút PRACTICE tính vào mục tiêu + routine STUDY,
// overview (minutesByActivity, streak, pendingReasonDates, cards.total, next.minutes), thống kê (mục "Luyện AI" riêng),
// lịch (PRACTICE không tiến kế hoạch học bài), xoá phiên → log còn, practice_session_id về null; rồi XÓA user tạm
// (cascade). Từ chối chạy nếu DB là production.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { practiceSessionDetails, projects, studyLogs, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { addDaysIso } from "@/lib/deadline-alert";
import { vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const API = "http://localhost:3000/api";
const HT = `${API}/tra-dinh/hoc-tap`;
const RT = `${API}/du-an/routines`;
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
const call = async (tok: string | null, method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const logsOf = async (subjectId: string) => db.select().from(studyLogs).where(eq(studyLogs.subjectId, subjectId));

async function main() {
  const today = vnToday();
  const mk = async () => (await db.insert(users).values({ email: `study-practice-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const H = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, HT + p, body);
    const R = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, RT + p, body);
    const session = async (userId: string, type = "PRACTICE") => {
      const [p] = await db.insert(projects).values({ userId, name: "Buổi luyện thử", type }).returning({ id: projects.id });
      if (type === "PRACTICE") await db.insert(practiceSessionDetails).values({ projectId: p.id, mode: "CONVERSATION" });
      return p.id;
    };
    const sA1 = await session(a.id), sA2 = await session(a.id), sA3 = await session(a.id), sA4 = await session(a.id);
    const sB = await session(b.id), sStd = await session(a.id, "STANDARD");

    const sub1 = (await H("POST", "/subjects", { name: "Tiếng Anh", dailyGoalMinutes: 60 })).j.id;
    const sub3 = (await H("POST", "/subjects", { name: "Không mục tiêu" })).j.id;
    const course = (await H("POST", "/courses", { subjectId: sub1, title: "Khóa 1", status: "ACTIVE", sectionsText: "P1 20min\nP2 25min" })).j;
    const p1 = course.sections[0].id;

    // ---- POST PRACTICE ----
    const l1 = await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 20, note: "nói 20 phút", practiceSessionId: sA1 });
    check("PRACTICE 201: activity, practiceSessionId, không khóa, hôm nay, today.minutes 20", l1.s === 201 && l1.j.log.activity === "PRACTICE" && l1.j.log.practiceSessionId === sA1 && l1.j.log.courseId === null && l1.j.log.sections.length === 0 && l1.j.log.logDate === today && l1.j.today.minutes === 20 && l1.j.today.done === false && l1.j.course === null, l1);
    const logId = l1.j.log.id;
    check("không nhận ngày từ client", (await H("POST", "/logs", { subjectId: sub3, activity: "PRACTICE", minutes: 5, logDate: addDaysIso(today, -1) })).j.log.logDate === today);
    check("PRACTICE không có practiceSessionId vẫn được (ghi tay)", (await H("POST", "/logs", { subjectId: sub3, activity: "PRACTICE", minutes: 5 })).s === 201);

    // ---- quy tắc ----
    check("PRACTICE + courseId → practice_no_course", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5, courseId: course.id })).j?.error === "practice_no_course");
    check("PRACTICE + sections → practice_no_sections", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5, sections: [] })).j?.error === "practice_no_sections");
    check("practiceSessionId với LESSON → practice_session_only_practice", (await H("POST", "/logs", { subjectId: sub1, minutes: 5, practiceSessionId: sA2 })).j?.error === "practice_session_only_practice");
    check("PRACTICE minutes 0 → 400", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 0 })).s === 400);
    check("PRACTICE minutes 1441 → 400", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 1441 })).s === 400);
    check("môn của user khác → 404 subject_not_found", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5 }, B)).j?.error === "subject_not_found");

    // ---- phiên chat: 404 / 409 ----
    check("phiên của user khác → 404 practice_session_not_found", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5, practiceSessionId: sB })).j?.error === "practice_session_not_found");
    check("phiên không tồn tại → 404", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5, practiceSessionId: randomUUID() })).s === 404);
    check("practiceSessionId không phải uuid → 404", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5, practiceSessionId: "abc" })).s === 404);
    check("project không phải PRACTICE → 404", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 5, practiceSessionId: sStd })).s === 404);
    const before = (await logsOf(sub1)).length;
    const dup = await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 7, practiceSessionId: sA1 });
    check("ghi lần hai cùng phiên → 409 practice_already_logged, không thêm log", dup.s === 409 && dup.j.error === "practice_already_logged" && (await logsOf(sub1)).length === before, dup);
    check("ghi trùng phiên ở môn khác của cùng user cũng 409 (mỗi phiên một buổi)", (await H("POST", "/logs", { subjectId: sub3, activity: "PRACTICE", minutes: 7, practiceSessionId: sA1 })).s === 409);
    const race = await Promise.all([1, 2].map(() => H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 3, practiceSessionId: sA2 })));
    const codes = race.map((r) => r.s).sort();
    check("hai yêu cầu song song cùng phiên: đúng một 201 và một 409", codes[0] === 201 && codes[1] === 409 && race.some((r) => r.j?.error === "practice_already_logged"), race);
    check("song song: chỉ một log cho phiên", (await logsOf(sub1)).filter((l) => l.practiceSessionId === sA2).length === 1);

    // ---- PATCH ----
    const pp = await H("PATCH", `/logs/${logId}`, { minutes: 25, note: "sửa" });
    check("PATCH PRACTICE: sửa minutes + note", pp.s === 200 && pp.j.log.minutes === 25 && pp.j.log.note === "sửa" && pp.j.log.activity === "PRACTICE", pp);
    check("PATCH đổi activity sang LESSON → 400 activity_locked", (await H("PATCH", `/logs/${logId}`, { activity: "LESSON", minutes: 10 })).j?.error === "activity_locked");
    check("PATCH đổi sang CARD_REVIEW → 400 activity_locked", (await H("PATCH", `/logs/${logId}`, { activity: "CARD_REVIEW" })).j?.error === "activity_locked");
    check("PATCH gửi đúng activity hiện tại → bỏ qua, OK", (await H("PATCH", `/logs/${logId}`, { activity: "PRACTICE", minutes: 26 })).j?.log?.minutes === 26);
    check("PATCH PRACTICE + courseId → practice_no_course", (await H("PATCH", `/logs/${logId}`, { courseId: course.id, minutes: 10 })).j?.error === "practice_no_course");
    check("PATCH PRACTICE + sections → practice_no_sections", (await H("PATCH", `/logs/${logId}`, { sections: [{ sectionId: p1 }] })).j?.error === "practice_no_sections");
    check("PATCH log của user khác → 404", (await H("PATCH", `/logs/${logId}`, { minutes: 9 }, B)).s === 404);

    // ---- phút PRACTICE tính vào mục tiêu ----
    // sub1 hiện có PRACTICE 26 + 3 = 29; thêm LESSON 20 + CARD_REVIEW 11 → 60.
    await H("POST", "/logs", { subjectId: sub1, minutes: 20 });
    const cr = await H("POST", "/logs", { subjectId: sub1, activity: "CARD_REVIEW", minutes: 11 });
    check("tổng ngày = LESSON + CARD_REVIEW + PRACTICE = 60 → done", cr.j.today.minutes === 60 && cr.j.today.done === true, cr.j);

    // ---- overview ----
    const card = (phrase: string) => ({ subjectId: sub1, phrase, meaning: "nghĩa", example: `I like to ${phrase} a lot.`, kind: "COLLOCATION" });
    const c1 = await H("POST", "/cards", card("take a break"));
    const c2 = await H("POST", "/cards", card("make progress"));
    await H("PATCH", `/cards/${c2.j.id}`, { suspended: true });
    const ov = (await H("GET", "/overview")).j;
    const o1 = ov.subjects.find((s: any) => s.subjectId === sub1);
    check("overview.today.minutesByActivity {LESSON 20, CARD_REVIEW 11, PRACTICE 29}", JSON.stringify(o1.today.minutesByActivity) === JSON.stringify({ LESSON: 20, CARD_REVIEW: 11, PRACTICE: 29 }), o1.today);
    check("overview.today.minutes = 60 và done (gồm PRACTICE), logCount đếm cả PRACTICE", o1.today.minutes === 60 && o1.today.done === true && o1.today.logCount === 4, o1.today);
    check("overview.cards.total = 1 (không tính thẻ tạm dừng), trường cũ còn", c1.s === 201 && o1.cards.total === 1 && typeof o1.cards.planned === "number" && typeof o1.cards.quota === "number" && "nextReviewDay" in o1.cards, o1.cards);
    check("overview.next.minutes = 20 (phần kế tiếp P1)", o1.next?.sectionTitle === "P1" && o1.next?.minutes === 20, o1.next);
    check("overview: môn không mục tiêu có đủ trường mới (streak 0, pending [])", (() => { const o3 = ov.subjects.find((s: any) => s.subjectId === sub3); return o3.streak === 0 && Array.isArray(o3.pendingReasonDates) && o3.pendingReasonDates.length === 0 && o3.today.minutesByActivity.PRACTICE === 10; })());
    check("overview.streak môn chưa có routine: hôm nay đủ mục tiêu nhờ PRACTICE → 1", o1.streak === 1 && o1.pendingReasonDates.length === 0, { streak: o1.streak, p: o1.pendingReasonDates });
    check("overview giữ nguyên dạng cũ: week, today, subjects[].activeCourse/counts/vsBaseline", !!ov.week && ov.today === today && !!o1.activeCourse && !!o1.counts && "vsBaseline" in o1);

    // ---- routine STUDY đạt mục tiêu nhờ PRACTICE, chuỗi dùng chung với overview ----
    const sub5 = (await H("POST", "/subjects", { name: "Chỉ luyện AI", dailyGoalMinutes: 30 })).j.id;
    const st = await R("POST", "", { name: "Học luyện AI", kind: "STUDY", studySubjectId: sub5 });
    check("routine STUDY tạo được, chưa đạt (0 phút)", st.s === 201 && st.j.doneToday === false && st.j.todayMinutes === 0 && st.j.streak === 0, st.j);
    await H("POST", "/logs", { subjectId: sub5, activity: "PRACTICE", minutes: 30, practiceSessionId: sA3 });
    const routines = (await R("GET", "")).j as any[];
    const rs = routines.find((x) => x.id === st.j.id);
    check("routine STUDY đạt mục tiêu chỉ nhờ PRACTICE: doneToday, todayMinutes 30, streak 1, last7 hôm nay done", rs.doneToday === true && rs.todayMinutes === 30 && rs.streak === 1 && rs.last7[6].done === true, rs);
    const o5 = (await H("GET", "/overview")).j.subjects.find((s: any) => s.subjectId === sub5);
    check("overview.streak của môn khớp streak của routine STUDY (cùng hàm)", o5.streak === rs.streak && JSON.stringify(o5.pendingReasonDates) === JSON.stringify(rs.pendingReasonDates), { o: o5.streak, r: rs.streak });

    // ---- thống kê: "Luyện AI" và "Ôn thẻ" là hai dòng riêng ----
    const stats = (await H("GET", `/stats?range=7&subjectId=${sub1}`)).j;
    const titles = stats.byCourse.map((c: any) => c.title);
    const luyen = stats.byCourse.find((c: any) => c.title === "Luyện AI"), on = stats.byCourse.find((c: any) => c.title === "Ôn thẻ");
    check("stats.byCourse có \"Luyện AI\" (29p, 2 buổi) và \"Ôn thẻ\" (11p) tách riêng", !!luyen && luyen.minutes === 29 && luyen.logCount === 2 && luyen.courseId === null && !!on && on.minutes === 11 && new Set(titles).size === titles.length, stats.byCourse);
    check("stats.totalMinutes gồm PRACTICE", stats.totalMinutes === 60, stats.totalMinutes);

    // ---- lịch: PRACTICE không tiến kế hoạch học bài ----
    const sub6 = (await H("POST", "/subjects", { name: "Lịch", dailyGoalMinutes: 60 })).j.id;
    await H("POST", "/courses", { subjectId: sub6, title: "Khóa lịch", status: "ACTIVE", sectionsText: "Q1 20min\nQ2 20min" });
    const sched = async () => ((await H("GET", `/schedule?subjectId=${sub6}&from=${today}&to=${addDaysIso(today, 1)}`)).j.days as any[]);
    check("lịch trước khi ghi: hôm nay có kế hoạch học bài", (await sched())[0].plannedItems?.length > 0);
    await H("POST", "/logs", { subjectId: sub6, activity: "PRACTICE", minutes: 15, practiceSessionId: sA4 });
    const d1 = await sched();
    check("chỉ có PRACTICE: hôm nay vẫn còn kế hoạch học bài, log PRACTICE hiện trong ngày, phút tính vào ngày", d1[0].plannedItems?.length > 0 && d1[0].minutes === 15 && d1[0].logs[0].activity === "PRACTICE", d1[0]);
    await H("POST", "/logs", { subjectId: sub6, minutes: 20 });
    const d2 = await sched();
    check("có thêm LESSON: hôm nay hết kế hoạch (như trước)", !("plannedItems" in d2[0]) || d2[0].plannedItems == null, d2[0]);

    // ---- DELETE: giải phóng phiên; xoá phiên: log còn, practice_session_id → null ----
    const del = await H("DELETE", `/logs/${logId}`);
    check("DELETE log PRACTICE → { ok: true } kèm today", del.s === 200 && del.j.ok === true && typeof del.j.today?.minutes === "number", del);
    check("sau khi xoá log, ghi lại cùng phiên được (201)", (await H("POST", "/logs", { subjectId: sub1, activity: "PRACTICE", minutes: 4, practiceSessionId: sA1 })).s === 201);
    await db.delete(projects).where(eq(projects.id, sA3));
    const kept = (await logsOf(sub5)).find((l) => l.activity === "PRACTICE");
    check("xoá phiên chat: log vẫn còn, practice_session_id = null", !!kept && kept.practiceSessionId === null && kept.minutes === 30, kept);

    // ---- cũ vẫn chạy ----
    check("app cũ không gửi activity: vẫn là LESSON", (await H("POST", "/logs", { subjectId: sub3, minutes: 5 })).j.log.activity === "LESSON");
    const list = (await H("GET", `/logs?subjectId=${sub1}&from=${today}&to=${today}`)).j as any[];
    check("GET /logs trả activity + practiceSessionId", list.some((l) => l.activity === "PRACTICE" && l.practiceSessionId === sA1) && list.every((l) => "practiceSessionId" in l));
  } finally {
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
  }
  console.log(fails === 0 ? "\nTẤT CẢ ĐẠT" : `\n${fails} KIỂM TRA LỖI`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); process.exit(1); });
