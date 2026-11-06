// Kiểm thử tích hợp API kho thẻ từ vựng trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-cards-e2e.ts — tạo 2 user tạm rồi kiểm tra GET/POST /cards, GET/PATCH/DELETE /cards/[id],
// POST /cards/parse, POST /cards/import (kể cả nhập song song), mã lỗi, phân quyền theo user, cascade khi xoá thẻ,
// logActivity; rồi XÓA user tạm (cascade) kể cả khi có check hỏng. Từ chối chạy nếu DB là production.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, studyCardDayPlanItems, studyCardReviews, studyCards, studySubjects, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const API = "http://localhost:3000/api";
const HT = `${API}/tra-dinh/hoc-tap`;
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
const call = async (tok: string | null, method: string, url: string, body?: unknown, raw = false) => {
  const r = await fetch(url, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const cardCount = async (subjectId: string) => (await db.select({ n: count() }).from(studyCards).where(eq(studyCards.subjectId, subjectId)))[0].n;
const fieldErr = (r: { j: any }, field: string) => r.j?.error?.fieldErrors?.[field];

const base = { meaning: "to be excited about a future event", example: "I look forward to the trip.", kind: "PHRASAL_VERB" };
const mkCards = (k: number, prefix: string) => Array.from({ length: k }, (_, i) => ({ phrase: `${prefix} phrase number ${i}`, meaning: `meaning ${i}`, example: `Example sentence ${i} with ${prefix} phrase number ${i}.`, kind: "COLLOCATION", topics: ["test"] }));

async function main() {
  const mk = async () => (await db.insert(users).values({ email: `study-cards-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const H = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, HT + p, body);

    const sub1 = (await H("POST", "/subjects", { name: "Tiếng Anh", dailyGoalMinutes: 60 })).j.id;
    const sub2 = (await H("POST", "/subjects", { name: "Môn khác" })).j.id;
    const subB = (await H("POST", "/subjects", { name: "Của B" }, B)).j.id;
    const log1 = (await H("POST", "/logs", { subjectId: sub1, minutes: 30 })).j.log.id;
    const log2 = (await H("POST", "/logs", { subjectId: sub2, minutes: 10 })).j.log.id;
    const logB = (await H("POST", "/logs", { subjectId: subB, minutes: 10 }, B)).j.log.id;

    check("401 không token (GET, POST, parse, import)", (await call(null, "GET", `${HT}/cards?subjectId=${sub1}`)).s === 401 && (await call(null, "POST", `${HT}/cards`, {})).s === 401 && (await call(null, "POST", `${HT}/cards/parse`, {})).s === 401 && (await call(null, "POST", `${HT}/cards/import`, {})).s === 401);

    // ---- POST /cards ----
    const c1 = await H("POST", "/cards", { subjectId: sub1, phrase: "  Look  Forward To ", ...base, note: "  + V-ing ", topics: [" Travel ", "daily life"] });
    check("POST: 201, thẻ NEW, dueAt null, đếm 0, chuẩn hoá", c1.s === 201 && c1.j.stage === "NEW" && c1.j.dueAt === null && c1.j.reviewCount === 0 && c1.j.notYetCount === 0 && c1.j.lastReviewedAt === null && c1.j.suspended === false && c1.j.sourceLogId === null && c1.j.subjectId === sub1 && c1.j.note === "+ V-ing" && JSON.stringify(c1.j.topics) === JSON.stringify(["travel", "daily life"]) && c1.j.phrase === "Look  Forward To" && !!c1.j.createdAt, c1);
    const [row1] = await db.select().from(studyCards).where(eq(studyCards.id, c1.j.id));
    check("phrase_key = cụm đã chuẩn hoá, user_id đúng", row1.phraseKey === "look forward to" && row1.userId === a.id, row1);
    check("POST có logId: sourceLogId được gắn", (await H("POST", "/cards", { subjectId: sub1, phrase: "break the ice", ...base, kind: "IDIOM", logId: log1 })).j.sourceLogId === log1);
    check("409 duplicate_phrase (khác hoa thường và khoảng trắng)", (await H("POST", "/cards", { subjectId: sub1, phrase: "LOOK forward   TO", ...base })).s === 409);
    check("cùng cụm ở môn khác thì được", (await H("POST", "/cards", { subjectId: sub2, phrase: "look forward to", ...base })).s === 201);
    check("404 subject_not_found: môn của user khác", (await H("POST", "/cards", { subjectId: sub1, phrase: "some new phrase", ...base }, B)).j?.error === "subject_not_found");
    check("404 subject_not_found: id lạ / không phải uuid", (await H("POST", "/cards", { subjectId: randomUUID(), phrase: "some new phrase", ...base })).s === 404 && (await H("POST", "/cards", { subjectId: "abc", phrase: "some new phrase", ...base })).s === 404);
    check("404 log_not_found: id lạ và log của user khác", (await H("POST", "/cards", { subjectId: sub1, phrase: "another new phrase", ...base, logId: randomUUID() })).j?.error === "log_not_found" && (await H("POST", "/cards", { subjectId: sub1, phrase: "another new phrase", ...base, logId: logB })).j?.error === "log_not_found");
    check("400 log_subject_mismatch: log của môn khác", (await H("POST", "/cards", { subjectId: sub1, phrase: "another new phrase", ...base, logId: log2 })).j?.error === "log_subject_mismatch");
    const bad1 = await H("POST", "/cards", { subjectId: sub1, phrase: "hello", meaning: " ", example: "", kind: "WORD", topics: ["a", "b", "c", "d"] });
    check("400 validate: single_word, required, invalid, too_many", bad1.s === 400 && fieldErr(bad1, "phrase")?.[0] === "single_word" && fieldErr(bad1, "meaning")?.[0] === "required" && fieldErr(bad1, "example")?.[0] === "required" && fieldErr(bad1, "kind")?.[0] === "invalid" && fieldErr(bad1, "topics")?.[0] === "too_many", bad1);
    check("400 zod: thiếu trường / sai kiểu / JSON hỏng", (await H("POST", "/cards", { subjectId: sub1 })).s === 400 && (await H("POST", "/cards", { subjectId: sub1, phrase: 5, ...base })).s === 400 && (await call(A, "POST", `${HT}/cards`, "{oops", true)).j?.error === "invalid_json");
    check("không tạo thẻ khi lỗi (đếm môn 1 vẫn 2)", (await cardCount(sub1)) === 2);

    // ---- GET /cards/[id] và phân quyền ----
    const id1 = c1.j.id as string;
    const g1 = await H("GET", `/cards/${id1}`);
    check("GET /cards/[id]: đủ trường theo hợp đồng", g1.s === 200 && ["id", "subjectId", "sourceLogId", "phrase", "meaning", "example", "note", "kind", "topics", "stage", "dueAt", "reviewCount", "notYetCount", "lastReviewedAt", "suspended", "createdAt"].every((k) => k in g1.j), g1.j && Object.keys(g1.j));
    check("404 card_not_found: id lạ, không phải uuid, thẻ của user khác (GET/PATCH/DELETE)", (await H("GET", `/cards/${randomUUID()}`)).j?.error === "card_not_found" && (await H("GET", "/cards/abc")).s === 404 && (await H("GET", `/cards/${id1}`, undefined, B)).s === 404 && (await H("PATCH", `/cards/${id1}`, { suspended: true }, B)).s === 404 && (await H("DELETE", `/cards/${id1}`, undefined, B)).s === 404);
    check("thẻ của A còn nguyên sau các lệnh của B", (await cardCount(sub1)) === 2 && (await H("GET", `/cards/${id1}`)).j.suspended === false);

    // ---- PATCH ----
    await db.update(studyCards).set({ stage: "WEEKLY", dueAt: new Date("2026-12-06T00:00:00Z"), reviewCount: 5, notYetCount: 2, lastReviewedAt: new Date("2026-11-01T00:00:00Z") }).where(eq(studyCards.id, id1));
    const p1 = await H("PATCH", `/cards/${id1}`, { meaning: "new meaning", note: null, topics: ["Work"], kind: "EXPRESSION", suspended: true, stage: "NEW", dueAt: null, reviewCount: 0, notYetCount: 0, subjectId: sub2 });
    check("PATCH: sửa nội dung + suspended", p1.s === 200 && p1.j.meaning === "new meaning" && p1.j.note === null && JSON.stringify(p1.j.topics) === JSON.stringify(["work"]) && p1.j.kind === "EXPRESSION" && p1.j.suspended === true, p1);
    const [row2] = await db.select().from(studyCards).where(eq(studyCards.id, id1));
    check("PATCH không đổi subjectId, stage, dueAt, các số đếm (khoá lạ bị bỏ qua)", row2.subjectId === sub1 && row2.stage === "WEEKLY" && row2.dueAt?.toISOString() === "2026-12-06T00:00:00.000Z" && row2.reviewCount === 5 && row2.notYetCount === 2 && row2.lastReviewedAt?.toISOString() === "2026-11-01T00:00:00.000Z", row2);
    const p2 = await H("PATCH", `/cards/${id1}`, { phrase: "  Look   FORWARD to doing" });
    const [row3] = await db.select().from(studyCards).where(eq(studyCards.id, id1));
    check("đổi phrase → tính lại phrase_key", p2.s === 200 && p2.j.phrase === "Look   FORWARD to doing" && row3.phraseKey === "look forward to doing", row3);
    check("đổi hoa/thường của chính cụm mình không bị coi là trùng", (await H("PATCH", `/cards/${id1}`, { phrase: "LOOK FORWARD TO DOING" })).s === 200);
    check("409 duplicate_phrase khi đổi thành cụm của thẻ khác", (await H("PATCH", `/cards/${id1}`, { phrase: "Break  the ICE" })).j?.error === "duplicate_phrase");
    check("PATCH lỗi nội dung → 400 và không đổi (single_word, topics > 3)", fieldErr(await H("PATCH", `/cards/${id1}`, { phrase: "hello" }), "phrase")?.[0] === "single_word" && fieldErr(await H("PATCH", `/cards/${id1}`, { topics: ["a", "b", "c", "d"] }), "topics")?.[0] === "too_many" && (await H("GET", `/cards/${id1}`)).j.phrase === "LOOK FORWARD TO DOING");
    check("400 empty_patch, 400 sai kiểu, 400 JSON hỏng", (await H("PATCH", `/cards/${id1}`, {})).j?.error === "empty_patch" && (await H("PATCH", `/cards/${id1}`, { suspended: "yes" })).s === 400 && (await call(A, "PATCH", `${HT}/cards/${id1}`, "{", true)).j?.error === "invalid_json");
    check("bỏ tạm dừng", (await H("PATCH", `/cards/${id1}`, { suspended: false })).j.suspended === false);

    // ---- DELETE + cascade ----
    const del = (await H("POST", "/cards", { subjectId: sub1, phrase: "to be deleted soon", ...base })).j.id as string;
    await db.insert(studyCardReviews).values({ userId: a.id, cardId: del, rating: "NOT_YET", bucket: "NEW", stageBefore: "NEW", stageAfter: "LEARNING" });
    await db.insert(studyCardDayPlanItems).values({ userId: a.id, subjectId: sub1, planDate: vnToday(), cardId: del, bucket: "NEW" });
    const delRes = await H("DELETE", `/cards/${del}`);
    check("DELETE → {ok:true}; xoá cả lượt ôn và mục kế hoạch (cascade)", delRes.s === 200 && delRes.j?.ok === true && (await db.select().from(studyCardReviews).where(eq(studyCardReviews.cardId, del))).length === 0 && (await db.select().from(studyCardDayPlanItems).where(eq(studyCardDayPlanItems.cardId, del))).length === 0);
    check("DELETE lần 2 → 404 card_not_found", (await H("DELETE", `/cards/${del}`)).j?.error === "card_not_found");

    // ---- parse ----
    const before = await cardCount(sub1);
    const pr = await H("POST", "/cards/parse", { subjectId: sub1, text: "```json\n" + JSON.stringify([
      { phrase: "Break the ice", ...base, kind: "IDIOM" }, // đã có trong môn
      { phrase: "pick up on", ...base },
      { phrase: "PICK  UP  on", ...base }, // lặp trong đầu vào
      { phrase: "hello", ...base }, // lỗi
      { phrase: "come across", ...base },
    ]) + "\n```" });
    check("parse: cards (mới), errors, duplicates, existing có index", pr.s === 200 && pr.j.cards.map((c: any) => c.index).join() === "1,4" && pr.j.errors.length === 1 && pr.j.errors[0].index === 3 && pr.j.duplicates.length === 1 && pr.j.duplicates[0].index === 2 && pr.j.duplicates[0].firstIndex === 1 && pr.j.existing.length === 1 && pr.j.existing[0].index === 0 && pr.j.existing[0].phrase === "Break the ice", pr);
    check("parse không lưu gì", (await cardCount(sub1)) === before);
    check("parse: JSON hỏng → errors invalid_json; môn lạ → 404; thiếu text → 400", (await H("POST", "/cards/parse", { subjectId: sub1, text: "[{" })).j?.errors?.[0]?.reason === "invalid_json" && (await H("POST", "/cards/parse", { subjectId: sub1, text: "[]" }, B)).j?.error === "subject_not_found" && (await H("POST", "/cards/parse", { subjectId: sub1 })).s === 400);

    // ---- import ----
    const imp1 = await H("POST", "/cards/import", { subjectId: sub1, logId: log1, cards: [...mkCards(5, "imp"), { phrase: "IMP  phrase   number 0", ...base }, { phrase: "break the ice", ...base, kind: "IDIOM" }] });
    check("import: 201, created 5, skipped 2 (lặp trong đầu vào + đã có trong môn)", imp1.s === 201 && imp1.j.created === 5 && imp1.j.skipped === 2, imp1);
    check("import: thẻ có sourceLogId, stage NEW, dueAt null", (await db.select().from(studyCards).where(and(eq(studyCards.subjectId, sub1), eq(studyCards.sourceLogId, log1)))).filter((r) => r.phrase.startsWith("imp ")).every((r) => r.stage === "NEW" && r.dueAt === null && r.userId === a.id));
    const cnt = await cardCount(sub1);
    const impBad = await H("POST", "/cards/import", { subjectId: sub1, cards: [...mkCards(3, "bad"), { phrase: "single", ...base }, { ...base, phrase: "no kind here", kind: "NOPE" }] });
    check("import có thẻ lỗi → 400 invalid_cards (kèm vị trí), không lưu gì", impBad.s === 400 && impBad.j.error === "invalid_cards" && impBad.j.errors.length === 2 && impBad.j.errors[0].index === 3 && (await cardCount(sub1)) === cnt, impBad);
    check("import >100 thẻ → 400; mảng rỗng → 400", (await H("POST", "/cards/import", { subjectId: sub1, cards: mkCards(101, "big") })).s === 400 && (await H("POST", "/cards/import", { subjectId: sub1, cards: [] })).s === 400 && (await cardCount(sub1)) === cnt);
    const imp100 = await H("POST", "/cards/import", { subjectId: sub2, cards: mkCards(100, "cap") });
    check("import đúng 100 thẻ OK", imp100.s === 201 && imp100.j.created === 100 && imp100.j.skipped === 0, imp100);
    check("import: môn lạ / log của môn khác / log lạ", (await H("POST", "/cards/import", { subjectId: sub1, cards: mkCards(1, "x") }, B)).j?.error === "subject_not_found" && (await H("POST", "/cards/import", { subjectId: sub1, logId: log2, cards: mkCards(1, "x") })).j?.error === "log_subject_mismatch" && (await H("POST", "/cards/import", { subjectId: sub1, logId: randomUUID(), cards: mkCards(1, "x") })).j?.error === "log_not_found" && (await cardCount(sub1)) === cnt);
    // thứ tự tạo giữ theo thứ tự nhập (created_at tăng dần)
    const order = (await db.select({ phrase: studyCards.phrase, createdAt: studyCards.createdAt }).from(studyCards).where(eq(studyCards.subjectId, sub2))).filter((r) => r.phrase.startsWith("cap ")).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).map((r) => r.phrase);
    check("import: created_at giữ thứ tự nhập", order.length === 100 && order.every((p, i) => p === `cap phrase number ${i}`), order.slice(0, 3));

    // song song: 4 lần nhập cùng 20 thẻ vào môn mới → đúng 20 thẻ, tổng created = 20
    const sub3 = (await H("POST", "/subjects", { name: "Song song" })).j.id;
    const par = await Promise.all([1, 2, 3, 4].map(() => H("POST", "/cards/import", { subjectId: sub3, cards: mkCards(20, "par") })));
    const createdSum = par.reduce((n, r) => n + (r.j?.created ?? 0), 0);
    check("nhập song song: mọi lần 201, tổng created = 20, DB đúng 20 thẻ, skipped cộng đủ", par.every((r) => r.s === 201) && createdSum === 20 && (await cardCount(sub3)) === 20 && par.every((r) => r.j.created + r.j.skipped === 20), par.map((r) => [r.s, r.j]));
    const dupKeys = (await db.select({ k: studyCards.phraseKey }).from(studyCards).where(eq(studyCards.subjectId, sub3))).map((r) => r.k);
    check("không có phrase_key trùng sau nhập song song", new Set(dupKeys).size === dupKeys.length);

    // ---- logActivity: mỗi lần import thành công đúng một dòng ----
    const acts = await db.select().from(activityLogs).where(and(eq(activityLogs.userId, a.id), eq(activityLogs.action, "study_card.imported")));
    const okImports = 1 + 1 + 4; // imp1, imp100, 4 lần song song (lần lỗi/404 không ghi)
    check("logActivity TRA_DINH: một dòng cho mỗi import thành công, không ghi khi lỗi", acts.length === okImports && acts.every((r) => r.source === "TRA_DINH"), acts.length);

    // ---- GET /cards: lọc, đếm, phân trang ----
    const s4 = (await H("POST", "/subjects", { name: "Danh sách" })).j.id;
    await H("POST", "/cards/import", { subjectId: s4, cards: [
      { phrase: "alpha beta", meaning: "Hello World meaning", example: "e1", kind: "IDIOM", topics: ["travel"] },
      { phrase: "gamma delta", meaning: "other", example: "e2", kind: "IDIOM", topics: ["work", "travel"] },
      { phrase: "epsilon 100% sure", meaning: "x", example: "e3", kind: "PATTERN", topics: [] },
      { phrase: "zeta eta", meaning: "y", example: "e4", kind: "PATTERN", topics: ["work"] },
      { phrase: "theta iota", meaning: "z", example: "e5", kind: "EXPRESSION" },
      { phrase: "kappa lambda", meaning: "w", example: "e6", kind: "COLLOCATION" },
      { phrase: "mu nu", meaning: "v", example: "e7", kind: "COLLOCATION" },
    ] });
    const all = await db.select().from(studyCards).where(eq(studyCards.subjectId, s4));
    const byPhrase = Object.fromEntries(all.map((r) => [r.phrase, r.id]));
    await db.update(studyCards).set({ stage: "LEARNING", dueAt: new Date() }).where(eq(studyCards.id, byPhrase["gamma delta"]));
    await db.update(studyCards).set({ stage: "WEEKLY", dueAt: new Date(), suspended: true }).where(eq(studyCards.id, byPhrase["zeta eta"]));
    await db.update(studyCards).set({ stage: "QUARTERLY", dueAt: new Date() }).where(eq(studyCards.id, byPhrase["mu nu"]));
    const L = (qs: string, tok: string | null = A) => call(tok, "GET", `${HT}/cards?subjectId=${s4}${qs}`);
    const l0 = await L("");
    check("GET: counts theo giai đoạn + total + suspended", l0.s === 200 && JSON.stringify(l0.j.counts) === JSON.stringify({ NEW: 4, LEARNING: 1, WEEKLY: 1, MONTHLY: 0, QUARTERLY: 1, total: 7, suspended: 1 }) && l0.j.cards.length === 7 && l0.j.nextCursor === null, l0.j.counts);
    check("GET: cards mới nhất trước (created_at desc)", l0.j.cards.map((c: any) => c.phrase).join("|") === "mu nu|kappa lambda|theta iota|zeta eta|epsilon 100% sure|gamma delta|alpha beta", l0.j.cards.map((c: any) => c.phrase));
    check("lọc stage", (await L("&stage=LEARNING")).j.cards.map((c: any) => c.phrase).join() === "gamma delta");
    check("lọc kind", (await L("&kind=PATTERN")).j.cards.length === 2 && (await L("&kind=BAD")).s === 400 && (await L("&stage=BAD")).s === 400);
    check("lọc topic (không phân biệt hoa thường, một thẻ có nhiều chủ đề)", (await L("&topic=Travel")).j.cards.map((c: any) => c.phrase).sort().join() === "alpha beta,gamma delta");
    check("q: khớp phrase hoặc meaning, không phân biệt hoa thường", (await L("&q=HELLO")).j.cards.map((c: any) => c.phrase).join() === "alpha beta" && (await L("&q=GAMMA")).j.cards.length === 1 && (await L("&q=ZZZ")).j.cards.length === 0);
    check("q: % và _ coi như ký tự thường", (await L("&q=100%25")).j.cards.length === 1 && (await L("&q=%25")).j.cards.length === 1 && (await L("&q=_")).j.cards.length === 0);
    const lf = await L("&kind=IDIOM&q=alpha");
    check("counts bỏ qua mọi bộ lọc", lf.j.cards.length === 1 && lf.j.counts.total === 7 && lf.j.counts.NEW === 4, lf.j.counts);
    check("kết hợp bộ lọc (kind + topic)", (await L("&kind=IDIOM&topic=work")).j.cards.map((c: any) => c.phrase).join() === "gamma delta");
    check("limit: 0 / 201 / chữ → 400; subjectId thiếu → 400; môn lạ hoặc của user khác → 404", (await L("&limit=0")).s === 400 && (await L("&limit=201")).s === 400 && (await L("&limit=abc")).s === 400 && (await call(A, "GET", `${HT}/cards`)).s === 400 && (await call(A, "GET", `${HT}/cards?subjectId=${randomUUID()}`)).s === 404 && (await L("", B)).j?.error === "subject_not_found");
    // phân trang: limit 3 → 3 + 3 + 1, không sót, không lặp
    const seen: string[] = []; let cursor: string | null = null; const sizes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const pg = await L(`&limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      sizes.push(pg.j.cards.length); seen.push(...pg.j.cards.map((c: any) => c.id));
      cursor = pg.j.nextCursor; if (!cursor) break;
    }
    check("phân trang con trỏ: 3+3+1, đủ 7 thẻ, không lặp, đúng thứ tự", sizes.join() === "3,3,1" && new Set(seen).size === 7 && seen.join() === l0.j.cards.map((c: any) => c.id).join(), { sizes });
    check("phân trang: đúng bội limit thì trang cuối không có nextCursor", (await L("&limit=7")).j.nextCursor === null && (await L("&limit=6")).j.nextCursor !== null);
    check("cursor hỏng → 400 invalid_cursor", (await L("&cursor=abc")).j?.error === "invalid_cursor");
    // phân trang ổn khi nhiều thẻ cùng created_at (nhập 100 thẻ một lô, 7 thẻ/trang)
    const seen2: string[] = []; cursor = null;
    for (let i = 0; i < 30; i++) {
      const pg: any = await call(A, "GET", `${HT}/cards?subjectId=${sub2}&limit=7${cursor ? `&cursor=${cursor}` : ""}`);
      seen2.push(...pg.j.cards.map((c: any) => c.id)); cursor = pg.j.nextCursor; if (!cursor) break;
    }
    check("phân trang 101 thẻ (limit 7): không sót, không lặp", seen2.length === 101 && new Set(seen2).size === 101, seen2.length);
  } finally {
    // user tạm xoá → môn, thẻ, lượt ôn, kế hoạch, buổi học, nhật ký hoạt động đều cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const leftSubjects = await db.select({ id: studySubjects.id }).from(studySubjects).where(eq(studySubjects.userId, a.id));
    const leftCards = await db.select({ id: studyCards.id }).from(studyCards).where(eq(studyCards.userId, a.id));
    const leftActs = await db.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.userId, a.id));
    check("dọn dữ liệu test (môn, thẻ, nhật ký hoạt động)", leftSubjects.length === 0 && leftCards.length === 0 && leftActs.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); process.exit(2); });
