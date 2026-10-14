// Kiểm thử tích hợp API môn học + khóa học của Học tập (Trà Đình) trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-courses-e2e.ts — tạo 2 user tạm, môn/khóa tạm, kiểm tra tạo bằng sectionsText + dự báo, ràng buộc 1 ACTIVE,
// tick hết phần → DONE + khóa chờ lên ACTIVE, bỏ tick → mở lại, move, PUT sections giữ done_at, cô lập user, rồi XÓA user
// tạm (cascade). Từ chối chạy nếu DB là production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routines, studyCourses, studySubjects, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const BASE = "http://localhost:3000/api/tra-dinh/hoc-tap";
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
const call = async (tok: string | null, method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};

async function main() {
  const mk = async () => (await db.insert(users).values({ email: `study-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
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
    check("user khác DELETE khóa 404", (await call(B, "DELETE", `/courses/${cA}`)).s === 404);
    check("user khác list khóa rỗng", (await call(B, "GET", "/courses")).j.length === 0);

    // ---- xoá ----
    check("DELETE khóa", (await call(A, "DELETE", `/courses/${cW}`)).j?.ok === true && (await call(A, "GET", `/courses/${cW}`)).s === 404);
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
