// Kiểm thử tích hợp "Ghi chú khóa" (tài liệu Tàng Kinh Các gắn study_courses) trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-course-note-e2e.ts — tạo 2 user tạm + môn/khóa tạm; kiểm tạo lần đầu 201, lần hai 200, song song chỉ một tài liệu,
// quyền sở hữu, khóa xoá mềm / xoá hẳn (tài liệu còn), xoá tài liệu rồi tạo lại, hai trường mới ở GET, client không đặt được studyCourseId;
// rồi dọn tài liệu đã tạo + XÓA user tạm (cascade). Từ chối chạy nếu DB là production. Không in token/URL.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, documents, studyCourses, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const ORIGIN = "http://localhost:3000";
const HT = `${ORIGIN}/api/tra-dinh/hoc-tap`;
const DOCS = `${ORIGIN}/api/tang-kinh-cac/documents`;
const PW = "e2e-mat-khau-dung";
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (tok: string | null, method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: Json | null = null; try { j = JSON.parse(t); } catch { /* không phải JSON */ }
  return { s: r.status, j: j as Json };
};

async function main() {
  const mk = async () => (await db.insert(users).values({ email: `note-e2e-${randomUUID()}@example.invalid`, passwordHash: bcrypt.hashSync(PW, 4) }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  const docIds = new Set<string>();
  const track = (id?: string) => { if (id) docIds.add(id); };
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const sid = (await call(A, "POST", `${HT}/subjects`, { name: "Môn ghi chú" })).j.id as string;
    const mkCourse = async (title: string) => (await call(A, "POST", `${HT}/courses`, { subjectId: sid, title, sectionsText: "P1 30min" })).j.id as string;
    const c1 = await mkCourse("English Tenses 101");
    const note = (tok: string | null, id: string) => call(tok, "POST", `${HT}/courses/${id}/note-document`);
    let created = 0;

    check("401 không token", (await note(null, c1)).s === 401);
    check("id sai định dạng → 404", (await note(A, "abc")).s === 404);

    // ---- tạo lần đầu / mở lại ----
    const n1 = await note(A, c1); track(n1.j?.id);
    if (n1.s === 201) created++;
    check("lần đầu 201, tài liệu TEXT tên '<tên khóa> — Ghi chú', nội dung tiêu đề Markdown + dòng trống",
      n1.s === 201 && n1.j.type === "TEXT" && n1.j.title === "English Tenses 101 — Ghi chú" && n1.j.content === "# English Tenses 101\n\n" && n1.j.pinned === false && Array.isArray(n1.j.tags), n1);
    check("có studyCourseId và studyCourseTitle", n1.j?.studyCourseId === c1 && n1.j?.studyCourseTitle === "English Tenses 101", n1.j);
    const n2 = await note(A, c1);
    check("lần hai 200, cùng id, không tạo thêm", n2.s === 200 && n2.j.id === n1.j.id && (await db.select().from(documents).where(eq(documents.studyCourseId, c1))).length === 1, n2);
    check("logActivity chỉ khi tạo mới (không ghi khi mở lại)", (await db.select().from(activityLogs).where(and(eq(activityLogs.userId, a.id), eq(activityLogs.action, "study_course.note_created")))).length === 1);

    // ---- đồng thời ----
    const c2 = await mkCourse("Khóa song song");
    const par = await Promise.all(Array.from({ length: 6 }, () => note(A, c2)));
    par.forEach((r) => track(r.j?.id));
    created += par.filter((r) => r.s === 201).length;
    check("6 request song song: đúng 1 tài liệu trong DB, mọi phản hồi cùng id, không lỗi 5xx", (await db.select().from(documents).where(eq(documents.studyCourseId, c2))).length === 1 && new Set(par.map((r) => r.j?.id)).size === 1 && par.every((r) => r.s === 200 || r.s === 201), par.map((r) => r.s));
    check("song song: tối đa một 201", par.filter((r) => r.s === 201).length <= 1, par.map((r) => r.s));

    // ---- quyền sở hữu ----
    check("user khác → 404 (khóa của người khác), và không tạo tài liệu", (await note(B, c1)).s === 404);
    const c3 = await mkCourse("Khóa chưa có ghi chú");
    check("user khác tạo thử trên khóa chưa có ghi chú → 404, DB không có tài liệu", (await note(B, c3)).s === 404 && (await db.select().from(documents).where(eq(documents.studyCourseId, c3))).length === 0);

    // ---- GET danh sách / theo id ----
    const byId = await call(A, "GET", `${DOCS}/${n1.j.id}`);
    check("GET theo id: studyCourseId + studyCourseTitle", byId.s === 200 && byId.j.studyCourseId === c1 && byId.j.studyCourseTitle === "English Tenses 101" && Array.isArray(byId.j.tags), byId);
    check("GET theo id không có → 404", (await call(A, "GET", `${DOCS}/${randomUUID()}`)).s === 404);
    const list = await call(A, "GET", DOCS);
    const inList = (list.j as unknown as Json[]).find((d) => d.id === n1.j.id);
    check("GET danh sách: tài liệu có studyCourseId + studyCourseTitle", list.s === 200 && inList?.studyCourseId === c1 && inList?.studyCourseTitle === "English Tenses 101", inList);
    const plain = await call(A, "POST", DOCS, { title: "Tài liệu thường", type: "TEXT", content: "x", studyCourseId: c3 }); track(plain.j?.id);
    check("tạo tài liệu thường: studyCourseId = null, studyCourseTitle = null dù client gửi studyCourseId", plain.s === 200 && plain.j.studyCourseId === null && plain.j.studyCourseTitle === null, plain.j);
    const patched = await call(A, "PATCH", `${DOCS}/${plain.j.id}`, { title: "Đổi tên", studyCourseId: c3 });
    check("PATCH tài liệu thường gửi studyCourseId: bị bỏ qua", patched.s === 200 && patched.j.title === "Đổi tên" && patched.j.studyCourseId === null, patched.j);
    const patchedNote = await call(A, "PATCH", `${DOCS}/${n1.j.id}`, { content: "# English Tenses 101\n\nđã sửa", studyCourseId: null });
    check("PATCH tài liệu ghi chú gửi studyCourseId null: vẫn gắn khóa cũ, sửa nội dung được", patchedNote.s === 200 && patchedNote.j.studyCourseId === c1 && patchedNote.j.content.endsWith("đã sửa"), patchedNote.j);
    const patchedOther = await call(A, "PATCH", `${DOCS}/${n1.j.id}`, { studyCourseId: c3 });
    check("PATCH đổi sang khóa khác bị bỏ qua", patchedOther.s === 200 && patchedOther.j.studyCourseId === c1, patchedOther.j);

    // ---- khóa xoá mềm / xoá hẳn ----
    const del = await call(A, "DELETE", `${HT}/courses/${c1}`, { password: PW });
    check("xoá mềm khóa ok", del.j?.ok === true, del);
    check("khóa đã xoá mềm → note-document 404", (await note(A, c1)).s === 404);
    const afterSoft = await call(A, "GET", `${DOCS}/${n1.j.id}`);
    const listSoft = ((await call(A, "GET", DOCS)).j as unknown as Json[]).find((d) => d.id === n1.j.id);
    check("tài liệu cũ vẫn có, còn nhãn tên khóa (không lọc deleted_at), ở cả GET theo id và danh sách", afterSoft.s === 200 && afterSoft.j.studyCourseId === c1 && afterSoft.j.studyCourseTitle === "English Tenses 101" && listSoft?.studyCourseTitle === "English Tenses 101", [afterSoft.j, listSoft]);
    const purge = await call(A, "DELETE", `${HT}/courses/${c1}/purge`, { password: PW });
    check("xoá hẳn khóa (purge) ok", purge.j?.ok === true && (await db.select().from(studyCourses).where(eq(studyCourses.id, c1))).length === 0, purge);
    const afterPurge = await call(A, "GET", `${DOCS}/${n1.j.id}`);
    check("sau xoá hẳn: tài liệu còn, studyCourseId = null, studyCourseTitle = null", afterPurge.s === 200 && afterPurge.j.studyCourseId === null && afterPurge.j.studyCourseTitle === null && afterPurge.j.content.endsWith("đã sửa"), afterPurge.j);

    // ---- xoá tài liệu rồi gọi lại ----
    const c4 = await mkCourse("Khóa xoá ghi chú");
    const first = await note(A, c4); track(first.j?.id); if (first.s === 201) created++;
    const rm = await call(A, "DELETE", `${DOCS}/${first.j.id}`);
    check("DELETE tài liệu ghi chú bình thường vẫn được", rm.s === 200 && (await db.select().from(documents).where(eq(documents.id, first.j.id))).length === 0, rm.s);
    const again = await note(A, c4); track(again.j?.id); if (again.s === 201) created++;
    check("gọi lại sau khi xoá: 201 và tài liệu MỚI (id khác)", again.s === 201 && again.j.id !== first.j.id && again.j.studyCourseId === c4, again);
    check("khóa vẫn còn nguyên sau khi xoá tài liệu", (await db.select().from(studyCourses).where(eq(studyCourses.id, c4))).length === 1);
    check("logActivity đúng số lần tạo mới (201)", (await db.select().from(activityLogs).where(and(eq(activityLogs.userId, a.id), eq(activityLogs.action, "study_course.note_created")))).length === created, created);
  } finally {
    await db.delete(documents).where(inArray(documents.id, [...docIds]));
    // user tạm xoá → môn, khóa, phần, nhật ký cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const left = await db.select({ id: documents.id }).from(documents).where(inArray(documents.id, [...docIds]));
    check("dọn dữ liệu test", left.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
