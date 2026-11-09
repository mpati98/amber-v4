// Kiểm thử tích hợp API môn học + khóa học của Học tập (Trà Đình) trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-courses-e2e.ts — tạo 2 user tạm, môn/khóa tạm, kiểm tra tạo bằng sectionsText + dự báo, ràng buộc 1 ACTIVE,
// xoá mềm / Thùng rác / khôi phục / purge / khoá mật khẩu / dọn lười, tick hết phần → DONE + khóa chờ lên ACTIVE, bỏ tick → mở lại, move, PUT sections giữ done_at, cô lập user, rồi XÓA user
// tạm (cascade). Từ chối chạy nếu DB là production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { routines, studyCards, studyCourses, studyLogs, studySubjects, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const PW = "e2e-mat-khau-dung"; // mật khẩu của hai user tạm (hash cost 4 cho nhanh)
const BASE = "http://localhost:3000/api/tra-dinh/hoc-tap";
type TrashCourse = { id: string; queuePosition: number | null; daysLeft: number };
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
const call = async (tok: string | null, method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};

async function main() {
  const mk = async () => (await db.insert(users).values({ email: `study-e2e-${randomUUID()}@example.invalid`, passwordHash: bcrypt.hashSync(PW, 4) }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    check("401 không token", (await call(null, "GET", "/subjects")).s === 401);

    // ---- Môn học ----
    check("môn: tên rỗng 400", (await call(A, "POST", "/subjects", { name: "" })).s === 400);
    check("môn: videoMinutesPerDay 0 → 400", (await call(A, "POST", "/subjects", { name: "x", videoMinutesPerDay: 0 })).s === 400);
    check("môn: reviewWeekdays trùng → 400", (await call(A, "POST", "/subjects", { name: "x", reviewWeekdays: [7, 7] })).s === 400);
    check("môn: reviewWeekdays 7 phần tử → 400", (await call(A, "POST", "/subjects", { name: "x", reviewWeekdays: [1, 2, 3, 4, 5, 6, 7] })).s === 400);
    const s1 = await call(A, "POST", "/subjects", { name: "Tiếng Anh", dailyGoalMinutes: 60 });
    check("tạo môn: mặc định video 40, ôn Chủ nhật", s1.s === 201 && s1.j.videoMinutesPerDay === 40 && s1.j.reviewWeekdays.join() === "7" && s1.j.dailyGoalMinutes === 60 && s1.j.position === 0, s1);
    const sid = s1.j.id;
    const s2 = await call(A, "POST", "/subjects", { name: "Lập trình" });
    check("môn thứ 2 xếp sau (position 1)", s2.s === 201 && s2.j.position === 1 && s2.j.dailyGoalMinutes === null, s2);
    const p1 = await call(A, "PATCH", `/subjects/${sid}`, { dailyGoalMinutes: null, videoMinutesPerDay: 30, reviewWeekdays: [] });
    check("PATCH môn", p1.s === 200 && p1.j.dailyGoalMinutes === null && p1.j.videoMinutesPerDay === 30 && p1.j.reviewWeekdays.length === 0, p1);
    await call(A, "PATCH", `/subjects/${sid}`, { reviewWeekdays: [7] });
    check("PATCH rỗng 400", (await call(A, "PATCH", `/subjects/${sid}`, {})).s === 400);
    check("user khác: PATCH môn 404", (await call(B, "PATCH", `/subjects/${sid}`, { name: "hack" })).s === 404);
    check("user khác: GET môn không thấy", (await call(B, "GET", "/subjects")).j.length === 0);
    check("id sai định dạng 404", (await call(A, "PATCH", "/subjects/abc", { name: "x" })).s === 404);

    // ---- parse ----
    const pr = await call(A, "POST", "/sections/parse", { text: "Intro 10min\nBài 2 1h 30m\nlỗi" });
    check("parse: 2 phần + 1 dòng bỏ qua", pr.s === 200 && pr.j.sections.length === 2 && pr.j.totalMinutes === 100 && pr.j.skipped[0].line === 3, pr);

    // ---- Khóa học: tạo bằng sectionsText ----
    const text = "Phần 1: Cơ bản\t40min\nPhần 2: Nâng cao\t1h 20min\nPhần 3: Ôn\t10min"; // 40 + 80 + 10 = 130
    check("khóa: subject lạ 404", (await call(A, "POST", "/courses", { subjectId: randomUUID(), title: "x" })).s === 404);
    check("khóa: subject của user khác 404", (await call(B, "POST", "/courses", { subjectId: sid, title: "x" })).s === 404);
    check("khóa: sections + sectionsText → sections_conflict", (await call(A, "POST", "/courses", { subjectId: sid, title: "x", sections: [], sectionsText: "a 1m" })).j?.error === "sections_conflict");
    const bad = await call(A, "POST", "/courses", { subjectId: sid, title: "x", sectionsText: "ok 5min\nkhông giờ" });
    check("khóa: dòng không đọc được → sections_unparsed + skipped", bad.s === 400 && bad.j.error === "sections_unparsed" && bad.j.skipped[0].line === 2, bad);
    check("khóa: url sai 400", (await call(A, "POST", "/courses", { subjectId: sid, title: "x", url: "không phải url" })).s === 400);
    const c1 = await call(A, "POST", "/courses", { subjectId: sid, title: "Khóa A", instructor: "Cô X", sectionsText: text });
    check("tạo khóa mặc định QUEUED, queuePosition 1, 3 phần", c1.s === 201 && c1.j.status === "QUEUED" && c1.j.queuePosition === 1 && c1.j.sections.length === 3
      && c1.j.progress.totalMinutes === 130 && c1.j.progress.doneSections === 0 && c1.j.nextSection?.title === "Phần 1: Cơ bản" && c1.j.instructor === "Cô X", c1);
    check("khóa QUEUED chưa có baseline (môn chưa học)", c1.j.baselineFinishDate === null);
    check("khóa có forecastFinishDate", typeof c1.j.forecastFinishDate === "string" && c1.j.deltaDays === null, c1.j);
    const cA = c1.j.id;

    const c2 = await call(A, "POST", "/courses", { subjectId: sid, title: "Khóa B", sections: [{ title: "B1", durationMinutes: 30 }, { title: "B2", durationMinutes: 0 }] });
    const c3 = await call(A, "POST", "/courses", { subjectId: sid, title: "Khóa C", sections: [{ title: "C1", durationMinutes: 20 }] });
    check("hàng chờ 1,2,3", c2.j.queuePosition === 2 && c3.j.queuePosition === 3, [c2.j, c3.j]);
    const cB = c2.j.id, cC = c3.j.id;
    const w = await call(A, "POST", "/courses", { subjectId: sid, title: "Muốn học", status: "WISHLIST", targetPrice: "500k" });
    check("WISHLIST: không queue, không forecast", w.s === 201 && w.j.queuePosition === null && w.j.forecastFinishDate === null && w.j.targetPrice === "500k", w);
    const cW = w.j.id;

    // dự báo nối tiếp: 30 phút/ngày, bỏ Chủ nhật; A=130, B=30, C=20 → tổng 180 = 6 ngày học
    const g = await call(A, "GET", `/courses?subjectId=${sid}`);
    check("GET courses: thứ tự QUEUED theo hàng chờ rồi WISHLIST", g.s === 200 && g.j.map((c: any) => c.id).join() === [cA, cB, cC, cW].join(), g.j?.map((c: any) => c.title));
    const fc = g.j.map((c: any) => c.forecastFinishDate);
    check("forecast tăng dần theo hàng chờ", fc[0] <= fc[1] && fc[1] <= fc[2] && fc[0] !== null, fc);

    // ---- ràng buộc ACTIVE ----
    const act = await call(A, "PATCH", `/courses/${cA}`, { status: "ACTIVE" });
    check("QUEUED → ACTIVE: started_at, bỏ queuePosition, chốt baseline cho cả hàng chờ", act.s === 200 && act.j.status === "ACTIVE" && act.j.queuePosition === null && act.j.startedAt && act.j.baselineFinishDate === act.j.forecastFinishDate && act.j.deltaDays === 0, act);
    const afterAct = await call(A, "GET", `/courses?subjectId=${sid}&status=QUEUED`);
    check("hàng chờ đánh số lại 1,2 và có baseline", afterAct.j.map((c: any) => c.queuePosition).join() === "1,2" && afterAct.j.every((c: any) => c.baselineFinishDate), afterAct.j);
    const dup = await call(A, "PATCH", `/courses/${cB}`, { status: "ACTIVE" });
    check("2 khóa ACTIVE → 409 active_exists", dup.s === 409 && dup.j.error === "active_exists", dup);
    check("tạo khóa ACTIVE khi đã có ACTIVE → 409", (await call(A, "POST", "/courses", { subjectId: sid, title: "Z", status: "ACTIVE" })).s === 409);
    check("không để lại khóa rác sau 409", (await call(A, "GET", `/courses?subjectId=${sid}`)).j.length === 4);
    check("GET status lặp (ACTIVE+QUEUED)", (await call(A, "GET", `/courses?subjectId=${sid}&status=ACTIVE&status=QUEUED`)).j.length === 3);
    check("GET status sai → 400", (await call(A, "GET", "/courses?status=XYZ")).s === 400);

    // ---- move ----
    const mv1 = await call(A, "POST", `/courses/${cC}/move`, { direction: "up" });
    check("move up: C lên trước B", mv1.s === 200 && mv1.j.map((c: any) => c.id).join() === [cA, cC, cB].join(), mv1.j?.map((c: any) => c.title));
    const mv2 = await call(A, "POST", `/courses/${cC}/move`, { direction: "up" });
    check("move up ở đầu hàng: giữ nguyên", mv2.j.map((c: any) => c.id).join() === [cA, cC, cB].join());
    const mv3 = await call(A, "POST", `/courses/${cB}/move`, { direction: "down" });
    check("move down ở cuối hàng: giữ nguyên", mv3.j.map((c: any) => c.id).join() === [cA, cC, cB].join());
    const mv4 = await call(A, "POST", `/courses/${cC}/move`, { direction: "down" });
    check("move down: C xuống sau B", mv4.j.map((c: any) => c.id).join() === [cA, cB, cC].join());
    check("move khóa không QUEUED → 400", (await call(A, "POST", `/courses/${cA}/move`, { direction: "up" })).s === 400);
    check("move direction sai 400", (await call(A, "POST", `/courses/${cB}/move`, { direction: "left" })).s === 400);

    // ---- PUT sections: giữ done_at ----
    const detail = await call(A, "GET", `/courses/${cA}`);
    check("GET chi tiết: sections + recentLogs rỗng", detail.s === 200 && detail.j.sections.length === 3 && Array.isArray(detail.j.recentLogs) && detail.j.recentLogs.length === 0, detail);
    const [s1id, s2id, s3id] = detail.j.sections.map((s: any) => s.id);
    const t1 = await call(A, "PATCH", `/courses/${cA}/sections/${s1id}`, { done: true });
    const doneAt1 = t1.j?.sections?.[0]?.doneAt;
    check("tick phần 1: progress + nextSection", t1.s === 200 && t1.j.progress.doneSections === 1 && t1.j.progress.doneMinutes === 40 && t1.j.nextSection.id === s2id && !!doneAt1, t1);
    check("tick lại giữ nguyên done_at", (await call(A, "PATCH", `/courses/${cA}/sections/${s1id}`, { done: true })).j.sections[0].doneAt === doneAt1);
    check("tick phần của khóa khác 404", (await call(A, "PATCH", `/courses/${cB}/sections/${s1id}`, { done: true })).s === 404);
    check("user khác tick 404", (await call(B, "PATCH", `/courses/${cA}/sections/${s2id}`, { done: true })).s === 404);
    const put = await call(A, "PUT", `/courses/${cA}/sections`, [
      { id: s3id, title: "Phần 3 (đổi tên)", durationMinutes: 15 },
      { title: "Phần mới chen", durationMinutes: 25 },
      { id: s1id, title: "Phần 1", durationMinutes: 40 },
    ]);
    check("PUT sections: thứ tự mới 0..2, phần 2 bị xoá, phần 1 giữ done_at", put.s === 200 && put.j.sections.map((s: any) => s.title).join("|") === "Phần 3 (đổi tên)|Phần mới chen|Phần 1"
      && put.j.sections.map((s: any) => s.position).join() === "0,1,2" && put.j.sections[2].doneAt === doneAt1 && put.j.sections[0].done === false && put.j.progress.totalMinutes === 80, put);
    check("PUT id lạ → 400", (await call(A, "PUT", `/courses/${cA}/sections`, [{ id: randomUUID(), title: "x", durationMinutes: 1 }])).s === 400);
    check("PUT id trùng → 400", (await call(A, "PUT", `/courses/${cA}/sections`, [{ id: s1id, title: "x", durationMinutes: 1 }, { id: s1id, title: "y", durationMinutes: 1 }])).s === 400);
    check("PUT lỗi không làm mất dữ liệu", (await call(A, "GET", `/courses/${cA}`)).j.sections.length === 3);

    // ---- tick hết → DONE, khóa chờ đầu hàng lên ACTIVE ----
    const ids = put.j.sections.map((s: any) => s.id);
    await call(A, "PATCH", `/courses/${cA}/sections/${ids[0]}`, { done: true });
    await call(A, "PATCH", `/courses/${cA}/sections/${ids[1]}`, { done: true });
    const fin = await call(A, "GET", `/courses/${cA}`);
    check("tick đủ phần → DONE, finishedAt, forecast = ngày finishedAt", fin.j.status === "DONE" && !!fin.j.finishedAt && fin.j.queuePosition === null && fin.j.forecastFinishDate === vnToday(new Date(fin.j.finishedAt)), fin.j);
    const listAfter = await call(A, "GET", `/courses?subjectId=${sid}`);
    const byId = Object.fromEntries(listAfter.j.map((c: any) => [c.id, c]));
    check("khóa chờ đầu hàng (B) lên ACTIVE, started_at, hàng chờ còn C = 1", byId[cB].status === "ACTIVE" && !!byId[cB].startedAt && byId[cC].queuePosition === 1, listAfter.j.map((c: any) => [c.title, c.status, c.queuePosition]));
    check("thứ tự list: ACTIVE, QUEUED, WISHLIST, DONE", listAfter.j.map((c: any) => c.status).join() === "ACTIVE,QUEUED,WISHLIST,DONE", listAfter.j.map((c: any) => c.status));

    // ---- bỏ tick khóa DONE ----
    const re = await call(A, "PATCH", `/courses/${cA}/sections/${ids[2]}`, { done: false });
    check("bỏ tick khóa DONE khi môn đã có ACTIVE → về QUEUED đầu hàng", re.s === 200 && re.j.status === "QUEUED" && re.j.queuePosition === 1 && re.j.finishedAt === null, re);
    const q = await call(A, "GET", `/courses?subjectId=${sid}&status=QUEUED`);
    check("hàng chờ: A=1, C=2", q.j.map((c: any) => `${c.title}:${c.queuePosition}`).join() === "Khóa A:1,Khóa C:2", q.j);

    // hoàn thành B (phần 0 phút cũng phải tick) → DONE → A lên ACTIVE
    const bd = await call(A, "GET", `/courses/${cB}`);
    for (const s of bd.j.sections) await call(A, "PATCH", `/courses/${cB}/sections/${s.id}`, { done: true });
    check("B xong → A (đầu hàng) lên ACTIVE", (await call(A, "GET", `/courses/${cA}`)).j.status === "ACTIVE");
    const ad = await call(A, "GET", `/courses/${cA}`);
    await call(A, "PATCH", `/courses/${cA}/sections/${ad.j.sections[2].id}`, { done: true });
    const rb = await call(A, "PATCH", `/courses/${cB}/sections/${bd.j.sections[0].id}`, { done: false });
    check("A xong lại → C lên ACTIVE; bỏ tick B (DONE) khi đã có ACTIVE → QUEUED đầu hàng", (await call(A, "GET", `/courses/${cC}`)).j.status === "ACTIVE" && rb.j.status === "QUEUED" && rb.j.queuePosition === 1, rb.j);
    const noAct = await call(A, "PATCH", `/courses/${cC}`, { status: "WISHLIST" });
    check("ACTIVE → WISHLIST", noAct.s === 200 && noAct.j.status === "WISHLIST" && noAct.j.queuePosition === null);
    const reB = await call(A, "PATCH", `/courses/${cB}/sections/${bd.j.sections[0].id}`, { done: true });
    check("tick lại B (QUEUED) không đổi trạng thái", reB.j.status === "QUEUED");
    // DONE thủ công rồi mở lại khi không còn ACTIVE → ACTIVE
    await call(A, "PATCH", `/courses/${cB}`, { status: "ACTIVE" });
    const hand = await call(A, "PATCH", `/courses/${cB}`, { status: "DONE", title: "Khóa B (xong)" });
    check("DONE thủ công + đổi tên", hand.s === 200 && hand.j.status === "DONE" && hand.j.title === "Khóa B (xong)" && !!hand.j.finishedAt);
    const reopen = await call(A, "PUT", `/courses/${cB}/sections`, [...bd.j.sections.map((s: any) => ({ id: s.id, title: s.title, durationMinutes: s.durationMinutes })), { title: "B3 thêm", durationMinutes: 10 }]);
    check("thêm phần vào khóa DONE, môn không có ACTIVE → mở lại ACTIVE", reopen.s === 200 && reopen.j.status === "ACTIVE" && reopen.j.finishedAt === null, reopen);

    // ---- rebaseline ----
    check("rebaseline: trả danh sách courseView", (await call(A, "POST", `/subjects/${sid}/rebaseline`)).j.every((c: any) => c.baselineFinishDate === c.forecastFinishDate));
    check("rebaseline user khác 404", (await call(B, "POST", `/subjects/${sid}/rebaseline`)).s === 404);

    // ---- cô lập user ----
    check("user khác GET khóa 404", (await call(B, "GET", `/courses/${cA}`)).s === 404);
    check("user khác PUT sections 404", (await call(B, "PUT", `/courses/${cA}/sections`, [])).s === 404);
    check("user khác DELETE khóa 404 (kể cả có mật khẩu đúng của họ)", (await call(B, "DELETE", `/courses/${cA}`, { password: PW })).s === 404);
    check("user khác list khóa rỗng", (await call(B, "GET", "/courses")).j.length === 0);

    // ---- xoá ----
    check("DELETE khóa (xoá mềm, đúng mật khẩu); GET theo id sau đó 404", (await call(A, "DELETE", `/courses/${cW}`, { password: PW })).j?.ok === true && (await call(A, "GET", `/courses/${cW}`)).s === 404);

    // ---- xoá mềm / Thùng rác ----
    const s3 = await call(A, "POST", "/subjects", { name: "Môn xoá mềm", dailyGoalMinutes: 30 });
    const sid3 = s3.j.id;
    const mkC = (title: string, extra: object = {}) => call(A, "POST", "/courses", { subjectId: sid3, title, sectionsText: "P1 30min\nP2 30min", ...extra });
    const cx = (await mkC("X đang học", { status: "ACTIVE" })).j.id, cy = (await mkC("Y chờ 1")).j.id, cz = (await mkC("Z chờ 2")).j.id, cq = (await mkC("Q chờ 3")).j.id;
    const cw3 = (await call(A, "POST", "/courses", { subjectId: sid3, title: "W muốn mua", status: "WISHLIST" })).j.id;
    const cd3 = (await call(A, "POST", "/courses", { subjectId: sid3, title: "D xong", status: "DONE" })).j.id;
    const xDetail = (await call(A, "GET", `/courses/${cx}`)).j;
    const lg = await call(A, "POST", "/logs", { subjectId: sid3, courseId: cx, minutes: 25, sections: [{ sectionId: xDetail.sections[0].id }] });
    check("ghi buổi cho khóa X", lg.s === 201, lg);
    const logId = lg.j.log.id as string;
    const [card] = await db.insert(studyCards).values({ userId: a.id, subjectId: sid3, sourceLogId: logId, phrase: "keep me around", phraseKey: "keep me around", meaning: "m", example: "e", kind: "PHRASAL_VERB" }).returning({ id: studyCards.id });
    const ids3 = async () => (await call(A, "GET", `/courses?subjectId=${sid3}`)).j.map((c: TrashCourse) => c.id).join();
    const dbCourse = async (id: string) => (await db.select().from(studyCourses).where(eq(studyCourses.id, id)))[0];
    const resetLock = () => db.update(users).set({ pwFailedCount: 0, pwLockedUntil: null }).where(eq(users.id, a.id));

    // mật khẩu
    check("DELETE thiếu body → 400, khóa còn", (await call(A, "DELETE", `/courses/${cq}`)).s === 400 && (await dbCourse(cq)).deletedAt === null);
    const bad1 = await call(A, "DELETE", `/courses/${cq}`, { password: "sai" });
    check("sai mật khẩu → 403, khóa còn nguyên", bad1.s === 403 && (await dbCourse(cq)).deletedAt === null && (await ids3()).includes(cq), bad1);
    check("thiếu password → 400", (await call(A, "DELETE", `/courses/${cq}`, {})).s === 400);
    const bads = [];
    for (let i = 0; i < 3; i++) bads.push((await call(A, "DELETE", `/courses/${cq}`, { password: "sai" })).s);
    const fifth = await call(A, "DELETE", `/courses/${cq}`, { password: "sai" });
    check("sai 2–4 lần → 403; lần sai thứ 5 → 429 kèm số giây", bads.join() === "403,403,403" && fifth.s === 429 && fifth.j.error === "password_locked" && fifth.j.retryAfterSeconds > 800, [bads, fifth]);
    const lockedOk = await call(A, "DELETE", `/courses/${cq}`, { password: PW });
    check("đang khoá: mật khẩu ĐÚNG vẫn 429, khóa còn nguyên", lockedOk.s === 429 && (await dbCourse(cq)).deletedAt === null, lockedOk);
    check("khoá tính theo người dùng: user khác không bị ảnh hưởng", (await call(B, "GET", "/courses")).s === 200 && (await db.select().from(users).where(eq(users.id, b.id)))[0].pwFailedCount === 0);
    check("purge khóa còn sống → 404 (kiểm tồn tại trước mật khẩu)", (await call(A, "DELETE", `/courses/${cq}/purge`, { password: PW })).s === 404);
    await resetLock();

    // xoá mềm: hàng chờ không lỗ trống
    check("hàng chờ trước khi xoá Y,Z,Q = 1,2,3", (await call(A, "GET", `/courses?subjectId=${sid3}&status=QUEUED`)).j.map((c: TrashCourse) => c.queuePosition).join() === "1,2,3");
    const delY = await call(A, "DELETE", `/courses/${cy}`, { password: PW });
    check("xoá Y (đúng mật khẩu) → ok, Y biến khỏi danh sách", delY.j?.ok === true && !(await ids3()).includes(cy), delY);
    const qAfter = (await call(A, "GET", `/courses?subjectId=${sid3}&status=QUEUED`)).j;
    check("hàng chờ đánh số lại 1,2 (Z,Q), không lỗ trống", qAfter.map((c: TrashCourse) => `${c.id === cz ? "Z" : c.id === cq ? "Q" : "?"}${c.queuePosition}`).join() === "Z1,Q2", qAfter);
    const yRow = await dbCourse(cy);
    check("Y có deleted_at, queue_position null", !!yRow.deletedAt && yRow.queuePosition === null);
    check("Y: GET/PATCH/move/sections theo id → 404", (await call(A, "GET", `/courses/${cy}`)).s === 404 && (await call(A, "PATCH", `/courses/${cy}`, { title: "x" })).s === 404 && (await call(A, "POST", `/courses/${cy}/move`, { direction: "up" })).s === 404 && (await call(A, "PUT", `/courses/${cy}/sections`, [])).s === 404);
    check("xoá lại khóa đã xoá → 404", (await call(A, "DELETE", `/courses/${cy}`, { password: PW })).s === 404);
    const ovAfter = (await call(A, "GET", "/overview")).j;
    const ovCourses = JSON.stringify(ovAfter.subjects.find((x: { subjectId: string }) => x.subjectId === sid3) ?? {}) + JSON.stringify(ovAfter.courses ?? {});
    check("tổng quan không còn Y", !ovCourses.includes(cy) && !ovCourses.includes("Y chờ 1"));
    const today3 = vnToday();
    const sched = await call(A, "GET", `/schedule?subjectId=${sid3}&from=${today3}&to=${today3}`);
    check("lịch 200 và không còn Y", sched.s === 200 && !JSON.stringify(sched.j).includes(cy));
    const stat = await call(A, "GET", "/stats?range=7");
    check("thống kê 200, buổi học đã ghi vẫn tính và hiện tên khóa X", stat.s === 200 && JSON.stringify(stat.j).includes("X đang học") && !JSON.stringify(stat.j.subjects ?? []).includes(cy), stat.s);

    // Thùng rác
    const tr = await call(A, "GET", `/courses?deleted=1&subjectId=${sid3}`);
    check("Thùng rác: có Y, kèm deletedAt + daysLeft = 30", tr.s === 200 && tr.j.length === 1 && tr.j[0].id === cy && !!tr.j[0].deletedAt && tr.j[0].daysLeft === 30 && tr.j[0].title === "Y chờ 1", tr.j);
    check("Thùng rác: user khác thấy rỗng; deleted=2 → 400", (await call(B, "GET", "/courses?deleted=1")).j.length === 0 && (await call(A, "GET", "/courses?deleted=2")).s === 400);

    // xoá khóa ACTIVE không đẩy khóa chờ lên
    check("xoá X (ACTIVE) → ok; Z, Q vẫn QUEUED (không tự lên ACTIVE)", (await call(A, "DELETE", `/courses/${cx}`, { password: PW })).j?.ok === true && (await dbCourse(cz)).status === "QUEUED" && (await dbCourse(cq)).status === "QUEUED");
    const logAfter = (await db.select().from(studyLogs).where(eq(studyLogs.id, logId)))[0];
    check("buổi học của X còn, course_id vẫn trỏ X (xoá mềm)", !!logAfter && logAfter.courseId === cx);
    const logsRes = await call(A, "GET", `/logs?subjectId=${sid3}&from=${today3}&to=${today3}`);
    check("GET logs vẫn hiện tên khóa X đã xoá", logsRes.s === 200 && JSON.stringify(logsRes.j).includes("X đang học"));
    const patchLog = await call(A, "PATCH", `/logs/${logId}`, { minutes: 30 });
    check("sửa phút buổi học của khóa đã xoá vẫn được, course = null", patchLog.s === 200 && patchLog.j.course === null, patchLog);
    check("sửa phần của buổi thuộc khóa đã xoá → 409 course_deleted", (await call(A, "PATCH", `/logs/${logId}`, { sections: [{ sectionId: xDetail.sections[1].id, markDone: true }] })).j?.error === "course_deleted");
    check("ghi buổi mới vào khóa đã xoá → 404", (await call(A, "POST", "/logs", { subjectId: sid3, courseId: cx, minutes: 5 })).s === 404);
    check("môn không còn ACTIVE: tạo khóa ACTIVE mới được (khóa đã xoá không chiếm chỗ)", (await mkC("N đang học", { status: "ACTIVE" })).s === 201);

    // khôi phục
    check("user khác khôi phục → 404", (await call(B, "POST", `/courses/${cy}/restore`)).s === 404);
    check("khôi phục khóa còn sống → 404", (await call(A, "POST", `/courses/${cz}/restore`)).s === 404);
    const rX = await call(A, "POST", `/courses/${cx}/restore`);
    const qNow = (await call(A, "GET", `/courses?subjectId=${sid3}&status=QUEUED`)).j;
    check("khôi phục X (từng ACTIVE; môn đã có N ACTIVE) → QUEUED cuối hàng chờ, không cần mật khẩu", rX.s === 200 && rX.j.status === "QUEUED" && qNow.map((c: TrashCourse) => c.queuePosition).join() === "1,2,3" && qNow[2].id === cx, [rX.s, rX.j?.status, qNow.map((c: TrashCourse) => c.queuePosition)]);
    check("khôi phục: (X) không còn trong Thùng rác nhưng Y còn", (await call(A, "GET", `/courses?deleted=1&subjectId=${sid3}`)).j.map((c: TrashCourse) => c.id).join() === cy);
    await call(A, "DELETE", `/courses/${cw3}`, { password: PW });
    await call(A, "DELETE", `/courses/${cd3}`, { password: PW });
    const rW = await call(A, "POST", `/courses/${cw3}/restore`), rD = await call(A, "POST", `/courses/${cd3}/restore`);
    check("khôi phục WISHLIST giữ WISHLIST, không vào hàng chờ; DONE giữ DONE", rW.j?.status === "WISHLIST" && rW.j.queuePosition === null && rD.j?.status === "DONE" && rD.j.queuePosition === null && (await call(A, "GET", `/courses?subjectId=${sid3}&status=QUEUED`)).j.length === 3, [rW.j?.status, rD.j?.status]);

    // purge
    check("purge khóa chưa xoá → 404; user khác purge → 404", (await call(A, "DELETE", `/courses/${cz}/purge`, { password: PW })).s === 404 && (await call(B, "DELETE", `/courses/${cy}/purge`, { password: PW })).s === 404);
    check("purge sai mật khẩu → 403, Y còn trong Thùng rác", (await call(A, "DELETE", `/courses/${cy}/purge`, { password: "sai" })).s === 403 && !!(await dbCourse(cy)));
    await resetLock();
    check("purge đúng mật khẩu → Y mất hẳn khỏi bảng", (await call(A, "DELETE", `/courses/${cy}/purge`, { password: PW })).j?.ok === true && !(await dbCourse(cy)));

    // dọn lười: lùi deleted_at 31 ngày bằng SQL rồi GET
    const cOld = (await mkC("Cũ quá hạn")).j.id, cFresh = (await mkC("Mới xoá")).j.id;
    const oldSec = (await call(A, "GET", `/courses/${cOld}`)).j.sections[0].id as string;
    const oldLog = await call(A, "POST", "/logs", { subjectId: sid3, courseId: cOld, minutes: 10, sections: [{ sectionId: oldSec }] });
    const [card2] = await db.insert(studyCards).values({ userId: a.id, subjectId: sid3, sourceLogId: oldLog.j.log.id, phrase: "second keeper", phraseKey: "second keeper", meaning: "m", example: "e", kind: "IDIOM" }).returning({ id: studyCards.id });
    await call(A, "DELETE", `/courses/${cOld}`, { password: PW });
    await call(A, "DELETE", `/courses/${cFresh}`, { password: PW });
    await db.update(studyCourses).set({ deletedAt: sql`now() - interval '31 days'` }).where(eq(studyCourses.id, cOld));
    await db.update(studyCourses).set({ deletedAt: sql`now() - interval '29 days'` }).where(eq(studyCourses.id, cFresh));
    const trash2 = await call(A, "GET", `/courses?deleted=1&subjectId=${sid3}`);
    check("dọn lười khi GET Thùng rác: khóa 31 ngày bị xoá hẳn; khóa 29 ngày còn, daysLeft 1", trash2.j.map((c: TrashCourse) => `${c.id === cFresh ? "fresh" : "?"}:${c.daysLeft}`).join() === "fresh:1" && !(await dbCourse(cOld)), trash2.j);
    const logOld = (await db.select().from(studyLogs).where(eq(studyLogs.id, oldLog.j.log.id)))[0];
    const card2Row = (await db.select().from(studyCards).where(eq(studyCards.id, card2.id)))[0];
    check("sau xoá hẳn: buổi học còn với course_id = null, thẻ còn (vẫn trỏ buổi học), phần cũ mất", !!logOld && logOld.courseId === null && card2Row?.sourceLogId === oldLog.j.log.id && (await db.select().from(studyLogs).where(eq(studyLogs.courseId, cOld))).length === 0);
    check("thẻ của buổi cũ hơn cũng còn nguyên", (await db.select().from(studyCards).where(eq(studyCards.id, card.id))).length === 1);
    await db.update(studyCourses).set({ deletedAt: sql`now() - interval '40 days'` }).where(eq(studyCourses.id, cFresh));
    await call(A, "GET", `/courses?subjectId=${sid3}`);
    check("dọn lười cũng chạy ở GET danh sách thường", !(await dbCourse(cFresh)));
    const bOld = (await call(B, "POST", "/subjects", { name: "Môn của B" })).j.id;
    const bc = (await call(B, "POST", "/courses", { subjectId: bOld, title: "B giữ" })).j.id;
    await call(B, "DELETE", `/courses/${bc}`, { password: PW });
    await db.update(studyCourses).set({ deletedAt: sql`now() - interval '60 days'` }).where(eq(studyCourses.id, bc));
    await call(A, "GET", "/courses?deleted=1");
    check("dọn lười của A không đụng khóa quá hạn của user B", !!(await dbCourse(bc)));

    const routineHolder = await db.insert(routines).values({ userId: a.id, name: "Học", kind: "CHECK", studySubjectId: s2.j.id }).returning({ id: routines.id });
    check("DELETE môn đang có routine trỏ tới → 409 subject_in_use", (await call(A, "DELETE", `/subjects/${s2.j.id}`)).j?.error === "subject_in_use" && routineHolder.length === 1);
    check("DELETE môn: cascade khóa", (await call(A, "DELETE", `/subjects/${sid}`)).j?.ok === true && (await db.select().from(studyCourses).where(eq(studyCourses.subjectId, sid))).length === 0);
  } finally {
    // user tạm xoá → môn, khóa, phần, routine đều cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const left = await db.select({ id: studySubjects.id }).from(studySubjects).where(eq(studySubjects.userId, a.id));
    check("dọn dữ liệu test", left.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
