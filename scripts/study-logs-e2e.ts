// Kiểm thử tích hợp buổi học + lý do + routine STUDY trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-logs-e2e.ts — tạo 2 user tạm rồi kiểm tra ghi buổi học (tổng ngày, lý do tự xoá/rollback,
// markDone → khóa DONE), PATCH/DELETE chỉ hôm nay, lý do các ngày, routine STUDY (tạo/trùng/khoá kind/PUT logs/streak/
// pendingReasonDates) và dạng cũ của CHECK/WORKOUT; rồi XÓA user tạm (cascade). Từ chối chạy nếu DB là production.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routines, studyLogs, studySubjects, users } from "@/db/schema";
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
const logCount = async (subjectId: string) => (await db.select({ id: studyLogs.id }).from(studyLogs).where(eq(studyLogs.subjectId, subjectId))).length;

async function main() {
  const today = vnToday(), yesterday = addDaysIso(today, -1), tomorrow = addDaysIso(today, 1);
  const mk = async () => (await db.insert(users).values({ email: `study-logs-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const H = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, HT + p, body);
    const R = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, RT + p, body);

    const sub1 = (await H("POST", "/subjects", { name: "Tiếng Anh", dailyGoalMinutes: 60 })).j.id;
    const sub2 = (await H("POST", "/subjects", { name: "Lập trình", dailyGoalMinutes: 60 })).j.id;
    const sub3 = (await H("POST", "/subjects", { name: "Không mục tiêu" })).j.id;
    const course = (await H("POST", "/courses", { subjectId: sub1, title: "Khóa 1", status: "ACTIVE", sectionsText: "P1 20min\nP2 20min" })).j;
    const [p1, p2] = course.sections.map((s: any) => s.id);
    const other = (await H("POST", "/courses", { subjectId: sub2, title: "Khóa khác", sectionsText: "X 10min" })).j;

    check("401 không token", (await call(null, "GET", `${HT}/logs?from=${today}&to=${today}`)).s === 401);

    // ---- ghi buổi: tổng ngày ----
    const l1 = await H("POST", "/logs", { subjectId: sub1, minutes: 30 });
    check("log 30': today.minutes 30, chưa done, course null, log_date hôm nay", l1.s === 201 && l1.j.today.minutes === 30 && l1.j.today.done === false && l1.j.today.goalMinutes === 60 && l1.j.today.reason === null && l1.j.course === null && l1.j.log.logDate === today && l1.j.log.sections.length === 0, l1);
    const l2 = await H("POST", "/logs", { subjectId: sub1, minutes: 35, note: "ghi chú" });
    check("log 35': tổng 65 → done", l2.j.today.minutes === 65 && l2.j.today.done === true && l2.j.log.note === "ghi chú", l2);
    check("không nhận ngày từ client (logDate bị bỏ qua)", (await H("POST", "/logs", { subjectId: sub3, minutes: 5, logDate: yesterday })).j.log.logDate === today);

    // ---- validate ----
    check("minutes 0 → 400", (await H("POST", "/logs", { subjectId: sub1, minutes: 0 })).s === 400);
    check("minutes 1441 → 400", (await H("POST", "/logs", { subjectId: sub1, minutes: 1441 })).s === 400);
    check("môn của user khác → 404", (await H("POST", "/logs", { subjectId: sub1, minutes: 5 }, B)).s === 404);
    check("khóa của môn khác → course_not_in_subject", (await H("POST", "/logs", { subjectId: sub1, courseId: other.id, minutes: 5 })).j?.error === "course_not_in_subject");
    check("khóa user khác → 404", (await H("POST", "/logs", { subjectId: sub1, courseId: course.id, minutes: 5 }, B)).s === 404);
    check("sections không courseId → sections_without_course", (await H("POST", "/logs", { subjectId: sub1, minutes: 5, sections: [{ sectionId: p1 }] })).j?.error === "sections_without_course");
    check("section của khóa khác → section_not_in_course", (await H("POST", "/logs", { subjectId: sub1, courseId: course.id, minutes: 5, sections: [{ sectionId: other.sections[0].id }] })).j?.error === "section_not_in_course");
    check("section trùng → duplicate_section", (await H("POST", "/logs", { subjectId: sub1, courseId: course.id, minutes: 5, sections: [{ sectionId: p1 }, { sectionId: p1 }] })).j?.error === "duplicate_section");
    check("note > 2000 → 400", (await H("POST", "/logs", { subjectId: sub1, minutes: 5, note: "x".repeat(2001) })).s === 400);

    // ---- lý do ----
    const r1 = await H("POST", "/logs", { subjectId: sub2, minutes: 45, stopForToday: { code: "BUSY" } });
    check("45' + stopForToday → lý do lưu", r1.s === 201 && r1.j.today.done === false && r1.j.today.reason?.code === "BUSY", r1);
    const r2 = await H("POST", "/logs", { subjectId: sub2, minutes: 15 });
    check("học thêm 15' → đủ goal, lý do tự xoá", r2.j.today.done === true && r2.j.today.reason === null, r2);
    const before = await logCount(sub3);
    const sub4 = (await H("POST", "/subjects", { name: "Môn 4", dailyGoalMinutes: 100 })).j.id;
    const bad = await H("POST", "/logs", { subjectId: sub4, minutes: 10, stopForToday: { code: "OTHER" } });
    check("OTHER không text → 400 reason_text_required", bad.s === 400 && bad.j.error === "reason_text_required", bad);
    check("OTHER lỗi: không log nào được tạo (rollback)", (await logCount(sub4)) === 0 && (await logCount(sub3)) === before);
    check("OTHER chỉ khoảng trắng → 400", (await H("POST", "/logs", { subjectId: sub4, minutes: 10, stopForToday: { code: "OTHER", text: "   " } })).j?.error === "reason_text_required");
    check("OTHER có text → lưu", (await H("POST", "/logs", { subjectId: sub4, minutes: 10, stopForToday: { code: "OTHER", text: "Đi khám" } })).j?.today?.reason?.text === "Đi khám");
    const nog = await H("POST", "/logs", { subjectId: sub3, minutes: 5, stopForToday: { code: "BUSY" } });
    check("goal null → bỏ qua stopForToday", nog.s === 201 && nog.j.today.reason === null && nog.j.today.goalMinutes === null && nog.j.today.done === false, nog);
    const big = await H("POST", "/logs", { subjectId: sub1, minutes: 5, stopForToday: { code: "TIRED" } });
    check("đã đủ goal + stopForToday → bỏ qua", big.j.today.reason === null);

    // ---- markDone ----
    const m1 = await H("POST", "/logs", { subjectId: sub1, courseId: course.id, minutes: 20, sections: [{ sectionId: p1, markDone: true }] });
    check("markDone phần 1: log.sections + course progress", m1.s === 201 && m1.j.log.sections[0].markedDone === true && m1.j.log.sections[0].title === "P1" && m1.j.log.courseTitle === "Khóa 1" && m1.j.course.progress.doneSections === 1 && m1.j.course.status === "ACTIVE", m1);
    const m2 = await H("POST", "/logs", { subjectId: sub1, courseId: course.id, minutes: 20, sections: [{ sectionId: p1 }, { sectionId: p2, markDone: true }] });
    check("hết phần → khóa DONE", m2.j.course.status === "DONE" && m2.j.course.progress.doneSections === 2 && m2.j.log.sections.map((s: any) => s.markedDone).join() === "false,true", m2);
    const cd = (await H("GET", `/courses/${course.id}`)).j;
    check("chi tiết khóa: recentLogs có 2 buổi gắn khóa", cd.status === "DONE" && cd.recentLogs.length === 2, cd.recentLogs);

    // ---- PATCH / DELETE hôm nay ----
    const lid = m2.j.log.id;
    const pt = await H("PATCH", `/logs/${lid}`, { minutes: 25, note: null, sections: [{ sectionId: p2 }] });
    check("PATCH: sửa phút/note/sections; bỏ markDone KHÔNG xoá done_at", pt.s === 200 && pt.j.log.minutes === 25 && pt.j.log.note === null && pt.j.log.sections.length === 1 && pt.j.log.sections[0].markedDone === false && pt.j.course.status === "DONE" && pt.j.course.progress.doneSections === 2, pt);
    check("PATCH rỗng → 400", (await H("PATCH", `/logs/${lid}`, {})).s === 400);
    check("PATCH section không thuộc khóa → 400", (await H("PATCH", `/logs/${lid}`, { sections: [{ sectionId: other.sections[0].id }] })).j?.error === "section_not_in_course");
    const noc = (await H("POST", "/logs", { subjectId: sub1, minutes: 5 })).j.log.id;
    check("PATCH sections cho log không có khóa → sections_without_course", (await H("PATCH", `/logs/${noc}`, { sections: [{ sectionId: p1 }] })).j?.error === "sections_without_course");
    check("PATCH user khác → 404", (await H("PATCH", `/logs/${lid}`, { minutes: 1 }, B)).s === 404);
    // áp lại quy tắc lý do khi sửa: môn 4 đang có lý do OTHER; sửa thêm phút cho đủ goal → xoá lý do
    const l4 = (await H("GET", `/logs?subjectId=${sub4}&from=${today}&to=${today}`)).j[0].id;
    const up = await H("PATCH", `/logs/${l4}`, { minutes: 100 });
    check("PATCH đủ goal → lý do tự xoá", up.j.today.done === true && up.j.today.reason === null, up);
    const dn = await H("PATCH", `/logs/${l4}`, { minutes: 20, stopForToday: { code: "AWAY" } });
    check("PATCH giảm phút + stopForToday → lý do AWAY", dn.j.today.reason?.code === "AWAY", dn);

    // log hôm qua (chèn thẳng DB)
    const [yl] = await db.insert(studyLogs).values({ userId: a.id, subjectId: sub1, logDate: yesterday, minutes: 10 }).returning({ id: studyLogs.id });
    check("PATCH log hôm qua → not_today", (await H("PATCH", `/logs/${yl.id}`, { minutes: 20 })).j?.error === "not_today");
    check("DELETE log hôm qua → not_today", (await H("DELETE", `/logs/${yl.id}`)).j?.error === "not_today");
    const del = await H("DELETE", `/logs/${noc}`);
    check("DELETE log hôm nay: {ok, today}", del.s === 200 && del.j.ok === true && typeof del.j.today.minutes === "number", del);
    check("DELETE xong thì 404", (await H("DELETE", `/logs/${noc}`)).s === 404);
    const delM = await H("DELETE", `/logs/${m1.j.log.id}`);
    check("DELETE log markDone không đụng done_at của phần", delM.s === 200 && (await H("GET", `/courses/${course.id}`)).j.progress.doneSections === 2);

    // ---- GET /logs ----
    check("GET logs thiếu from/to → 400", (await H("GET", "/logs")).s === 400);
    check("GET logs from > to → 400", (await H("GET", `/logs?from=${today}&to=${yesterday}`)).s === 400);
    check("GET logs > 400 ngày → range_too_large", (await H("GET", `/logs?from=${addDaysIso(today, -400)}&to=${today}`)).j?.error === "range_too_large");
    check("GET logs đúng 400 ngày OK", (await H("GET", `/logs?from=${addDaysIso(today, -399)}&to=${today}`)).s === 200);
    const gl = await H("GET", `/logs?subjectId=${sub1}&from=${yesterday}&to=${today}`);
    check("GET logs: mới nhất trước, có hôm qua, lọc theo môn", gl.s === 200 && gl.j.length >= 3 && gl.j[gl.j.length - 1].id === yl.id && gl.j.every((l: any) => l.subjectId === sub1) && gl.j[0].logDate === today, gl.j?.map((l: any) => l.logDate));
    check("GET logs: user khác thấy rỗng", (await H("GET", `/logs?from=${yesterday}&to=${today}`, undefined, B)).j.length === 0);

    // ---- lý do theo ngày ----
    check("PUT lý do ngày mai → future_date", (await H("PUT", `/subjects/${sub2}/reasons/${tomorrow}`, { code: "BUSY" })).j?.error === "future_date");
    check("PUT lý do ngày sai → invalid_date", (await H("PUT", `/subjects/${sub2}/reasons/2026-13-45`, { code: "BUSY" })).j?.error === "invalid_date");
    check("PUT lý do ngày đủ goal → goal_met", (await H("PUT", `/subjects/${sub1}/reasons/${today}`, { code: "BUSY" })).j?.error === "goal_met");
    check("PUT lý do môn không goal → goal_missing", (await H("PUT", `/subjects/${sub3}/reasons/${yesterday}`, { code: "BUSY" })).j?.error === "goal_missing");
    check("PUT lý do OTHER không text → reason_text_required", (await H("PUT", `/subjects/${sub1}/reasons/${yesterday}`, { code: "OTHER" })).j?.error === "reason_text_required");
    check("PUT lý do code sai → 400", (await H("PUT", `/subjects/${sub1}/reasons/${yesterday}`, { code: "LAZY" })).s === 400);
    check("PUT lý do user khác → 404", (await H("PUT", `/subjects/${sub1}/reasons/${yesterday}`, { code: "BUSY" }, B)).s === 404);

    // ---- routine STUDY ----
    check("STUDY thiếu studySubjectId → study_subject_required", (await R("POST", "", { name: "Học", kind: "STUDY" })).j?.error === "study_subject_required");
    check("CHECK có studySubjectId → study_subject_not_allowed", (await R("POST", "", { name: "x", studySubjectId: sub1 })).j?.error === "study_subject_not_allowed");
    check("STUDY môn của user khác → 404", (await R("POST", "", { name: "Học", kind: "STUDY", studySubjectId: sub1 }, B)).s === 404);
    check("STUDY môn không mục tiêu → goal_missing", (await R("POST", "", { name: "Học", kind: "STUDY", studySubjectId: sub3 })).j?.error === "goal_missing");
    check("STUDY môn không tồn tại → 404", (await R("POST", "", { name: "Học", kind: "STUDY", studySubjectId: randomUUID() })).s === 404);
    const st = await R("POST", "", { name: "Học tiếng Anh", kind: "STUDY", studySubjectId: sub1 });
    check("tạo STUDY: mặc định 7 ngày, view STUDY", st.s === 201 && st.j.kind === "STUDY" && st.j.weekdays.join() === "1,2,3,4,5,6,7" && st.j.studySubjectId === sub1 && st.j.studySubjectName === "Tiếng Anh"
      && st.j.goalMinutes === 60 && st.j.todayMinutes >= 65 && st.j.doneToday === true && st.j.todayLog === null && !("lastWorkout" in st.j), st);
    check("STUDY streak tính hôm nay (hôm qua 10' < 60' nên đúng 1)", st.j.streak === 1 && st.j.last7[6].done === true && st.j.last7[5].done === false, st.j);
    const rid = st.j.id;
    check("STUDY thứ 2 cùng môn → 409 study_routine_exists", (await R("POST", "", { name: "Dup", kind: "STUDY", studySubjectId: sub1 })).j?.error === "study_routine_exists");
    check("PATCH STUDY → CHECK → kind_locked", (await R("PATCH", `/${rid}`, { kind: "CHECK" })).j?.error === "kind_locked");
    const chk = (await R("POST", "", { name: "Uống nước" })).j;
    check("PATCH CHECK → STUDY → kind_locked", (await R("PATCH", `/${chk.id}`, { kind: "STUDY" })).j?.error === "kind_locked");
    check("PATCH CHECK + studySubjectId → study_subject_not_allowed", (await R("PATCH", `/${chk.id}`, { studySubjectId: sub1 })).j?.error === "study_subject_not_allowed");
    check("PATCH STUDY đổi sang môn đã có routine → 409", (await R("POST", "", { name: "S2", kind: "STUDY", studySubjectId: sub2 })).s === 201 && (await R("PATCH", `/${rid}`, { studySubjectId: sub2 })).j?.error === "study_routine_exists");
    check("PATCH STUDY giữ kind + đổi tên OK", (await R("PATCH", `/${rid}`, { kind: "STUDY", name: "Học Anh" })).j?.name === "Học Anh");
    check("PUT log STUDY → study_routine_auto", (await R("PUT", `/${rid}/logs/${today}`)).j?.error === "study_routine_auto");
    check("DELETE log STUDY → study_routine_auto", (await R("DELETE", `/${rid}/logs/${today}`)).j?.error === "study_routine_auto");
    check("bỏ mục tiêu môn có routine STUDY → 409 subject_in_use", (await H("PATCH", `/subjects/${sub1}`, { dailyGoalMinutes: null })).j?.error === "subject_in_use");
    check("đổi mục tiêu môn (không null) vẫn được", (await H("PATCH", `/subjects/${sub1}`, { dailyGoalMinutes: 70 })).j?.dailyGoalMinutes === 70);
    await H("PATCH", `/subjects/${sub1}`, { dailyGoalMinutes: 60 });
    check("xoá môn có routine STUDY → 409 subject_in_use", (await H("DELETE", `/subjects/${sub1}`)).j?.error === "subject_in_use");

    // ---- pendingReasonDates ----
    const threeAgo = new Date(Date.now() - 3 * 86_400_000);
    await db.update(routines).set({ createdAt: threeAgo }).where(eq(routines.id, rid));
    const lst = (await R("GET", "")).j.find((r: any) => r.id === rid);
    check("pendingReasonDates: 3 ngày trước → hôm qua (đủ 3 ngày, tăng dần)", lst.pendingReasonDates.length === 3 && lst.pendingReasonDates[2] === yesterday && lst.pendingReasonDates[0] < lst.pendingReasonDates[1], lst.pendingReasonDates);
    check("GET routines: STUDY streak/doneToday", lst.doneToday === true && lst.streak === 1);
    const ok = await H("PUT", `/subjects/${sub1}/reasons/${yesterday}`, { code: "TIRED" });
    check("PUT lý do hôm qua OK", ok.s === 200 && ok.j.date === yesterday && ok.j.code === "TIRED", ok);
    const ok2 = await H("PUT", `/subjects/${sub1}/reasons/${yesterday}`, { code: "OTHER", text: "Đổi ý" });
    check("PUT lại thay lý do cũ", ok2.j.code === "OTHER" && ok2.j.text === "Đổi ý");
    const lst2 = (await R("GET", "")).j.find((r: any) => r.id === rid);
    check("đã có lý do → hết khỏi pendingReasonDates", !lst2.pendingReasonDates.includes(yesterday) && lst2.pendingReasonDates.length === 2, lst2.pendingReasonDates);
    check("DELETE lý do", (await H("DELETE", `/subjects/${sub1}/reasons/${yesterday}`)).j?.ok === true && (await R("GET", "")).j.find((r: any) => r.id === rid).pendingReasonDates.includes(yesterday));

    // ---- dạng cũ CHECK / WORKOUT ----
    const ck = (await R("GET", "")).j.find((r: any) => r.id === chk.id);
    check("CHECK: dạng cũ (không trường STUDY, không lastWorkout)", ck.kind === "CHECK" && !("studySubjectId" in ck) && !("pendingReasonDates" in ck) && !("lastWorkout" in ck) && ck.todayLog === null, ck);
    const wk = await R("POST", "", { name: "Tập", kind: "WORKOUT" });
    check("WORKOUT: dạng cũ (lastWorkout null, không trường STUDY)", wk.s === 201 && wk.j.lastWorkout === null && !("studySubjectId" in wk.j) && wk.j.todayLog === null, wk);
    const tick = await R("PUT", `/${chk.id}/logs/${today}`);
    check("CHECK tick vẫn hoạt động", tick.s === 200 && tick.j.doneToday === true && tick.j.streak === 1);
    // xoá routine → môn xoá được
    check("xoá routine STUDY rồi xoá môn OK", (await R("DELETE", `/${rid}`)).j?.ok === true && (await H("DELETE", `/subjects/${sub1}`)).j?.ok === true && (await db.select().from(studyLogs).where(eq(studyLogs.subjectId, sub1))).length === 0);
  } finally {
    // user tạm xoá → môn, khóa, log, lý do, routine đều cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const left = await db.select({ id: studySubjects.id }).from(studySubjects).where(eq(studySubjects.userId, a.id));
    check("dọn dữ liệu test", left.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
