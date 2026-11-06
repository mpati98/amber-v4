// Kiểm thử tích hợp thống kê nhóm khó trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-cards-insights-e2e.ts — tạo 2 user tạm, gài thẻ + lượt ôn + buổi học thẳng vào DB rồi kiểm tra
// GET /cards/insights (ngưỡng 10, tích luỹ vs theo kỳ, nhãn buổi học, hardestCards) và GET /cards/topics;
// rồi XÓA user tạm (cascade) kể cả khi có check hỏng. Từ chối chạy nếu DB là production.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCardReviews, studyCards, studyLogs, studySubjects, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { addDaysIso } from "@/lib/deadline-alert";
import { periodStart } from "@/lib/study-card-insights";
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
const call = async (tok: string | null, method: string, url: string, body?: unknown) => {
  const r = await fetch(url, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const near = (x: number, y: number) => Math.abs(x - y) < 1e-9;
const DAY = 86_400_000, HOUR = 3_600_000;

async function main() {
  const today = vnToday();
  const mk = async () => (await db.insert(users).values({ email: `study-cards-insights-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const H = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, HT + p, body);
    const INS = (sid: string, qs = "", tok: string | null = A) => H("GET", `/cards/insights?subjectId=${sid}${qs}`, undefined, tok);
    const TOP = (sid: string, tok: string | null = A) => H("GET", `/cards/topics?subjectId=${sid}`, undefined, tok);

    const I = (await H("POST", "/subjects", { name: "Có dữ liệu" })).j.id as string;
    const E = (await H("POST", "/subjects", { name: "Trống" })).j.id as string;
    const T = (await H("POST", "/subjects", { name: "Ngưỡng hay quên" })).j.id as string;
    const BS = (await H("POST", "/subjects", { name: "Của B" }, B)).j.id as string;
    const course = (await H("POST", "/courses", { subjectId: I, title: "Khóa A", sectionsText: "P1 10min" })).j;

    // ---- buổi học nguồn ----
    const mkLog = async (over: Partial<typeof studyLogs.$inferInsert>) => (await db.insert(studyLogs).values({ userId: a.id, subjectId: I, minutes: 30, logDate: today, ...over }).returning({ id: studyLogs.id }))[0].id;
    const d1 = addDaysIso(today, -3), d2 = addDaysIso(today, -2), d3 = addDaysIso(today, -1), d4 = addDaysIso(today, -5);
    const lesson1 = await mkLog({ courseId: course.id, logDate: d1 });
    const lesson2 = await mkLog({ logDate: d2 }); // LESSON không khóa
    const lesson3 = await mkLog({ logDate: d3, activity: "CARD_REVIEW" });
    const lesson4 = await mkLog({ logDate: d4 });
    const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

    // ---- thẻ ----
    let n = 0;
    const row = (subjectId: string, kind: (typeof studyCards.$inferInsert)["kind"], over: Partial<typeof studyCards.$inferInsert> = {}, userId = a.id): typeof studyCards.$inferInsert => {
      n++;
      return { userId, subjectId, phrase: `${kind.toLowerCase()} phrase ${n}`, phraseKey: `${kind.toLowerCase()} phrase ${n}`, meaning: `meaning ${n}`, example: `example ${n}`, note: n % 2 ? `note ${n}` : null, kind, ...over };
    };
    const seed = async (rows: (typeof studyCards.$inferInsert)[]) => db.insert(studyCards).values(rows).returning();
    const ny = (count: number) => ({ notYetCount: count, reviewCount: count > 0 ? count + 2 : 0 });

    const pattern = await seed([14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map((c, i) => row(I, "PATTERN", { ...ny(c), topics: i < 5 ? ["daily life", "rare"] : ["daily life"], sourceLogId: lesson3 })));
    const collo = await seed([3, 4, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0].map((c, i) => row(I, "COLLOCATION", { ...ny(c), topics: ["travel", "work"], sourceLogId: lesson1, suspended: i >= 10 })));
    const idiom = await seed([2, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0].map((c) => row(I, "IDIOM", { ...ny(c), topics: ["work"], sourceLogId: lesson2 }))); // 9 thẻ từng Chưa nhớ
    await seed(Array.from({ length: 9 }, () => row(I, "EXPRESSION", { ...ny(1), sourceLogId: lesson4 })));
    await seed([["beta"], ["alpha"], ["beta", "alpha"]].map((topics) => row(I, "PHRASAL_VERB", { topics })));

    // ===== Bước 1: ngưỡng 10 — 9 thẻ từng Chưa nhớ thì ẩn =====
    const r1 = await INS(I);
    const kinds1 = r1.j.byKind.map((g: any) => g.key);
    check("200, hình dạng {days, minCards, totals, byKind, byTopic, byLesson, hardestCards}; mặc định 30 ngày, minCards 10", r1.s === 200 && r1.j.days === 30 && r1.j.minCards === 10 && ["totals", "byKind", "byTopic", "byLesson", "hardestCards"].every((k) => k in r1.j), Object.keys(r1.j));
    check("nhóm loại có 9 thẻ từng Chưa nhớ bị ẩn (IDIOM, EXPRESSION); đủ 10 thì hiện (PATTERN, COLLOCATION)", kinds1.join() === "PATTERN,COLLOCATION", kinds1);
    check("nhóm buổi học có 9 thẻ từng Chưa nhớ bị ẩn; nhóm 10 thẻ hiện", r1.j.byLesson.map((g: any) => g.key).join() === [lesson3, lesson1].join(), r1.j.byLesson.map((g: any) => g.key));

    // ===== Bước 2: thêm thẻ thứ 10 — Chưa nhớ rồi Đã nhớ (ngoài kỳ 7/30 ngày) =====
    const [pair] = await seed([row(I, "IDIOM", { ...ny(1), topics: ["work"], sourceLogId: lesson2 })]);
    const now = Date.now();
    await db.insert(studyCardReviews).values([
      { userId: a.id, cardId: pair.id, reviewedAt: new Date(now - 45 * DAY), rating: "NOT_YET", bucket: "NEW", stageBefore: "WEEKLY", stageAfter: "LEARNING" },
      { userId: a.id, cardId: pair.id, reviewedAt: new Date(now - 45 * DAY + HOUR), rating: "REMEMBERED", bucket: "NEW", stageBefore: "LEARNING", stageAfter: "WEEKLY" },
    ]);
    const r2 = await INS(I, "&days=7");
    const kinds2 = r2.j.byKind.map((g: any) => g.key);
    check("thẻ NOT_YET rồi REMEMBERED (lượt ôn ngoài kỳ) vẫn tính: IDIOM đủ 10 → hiện", kinds2.join() === "PATTERN,COLLOCATION,IDIOM", kinds2);
    const g = Object.fromEntries(r2.j.byKind.map((x: any) => [x.key, x]));
    check("byKind: key/label/totalCards/everNotYetCards/rate; xếp theo tỷ lệ giảm dần", g.PATTERN.totalCards === 10 && g.PATTERN.everNotYetCards === 10 && near(g.PATTERN.rate, 1) && g.COLLOCATION.totalCards === 12 && g.COLLOCATION.everNotYetCards === 10 && near(g.COLLOCATION.rate, 10 / 12) && g.IDIOM.totalCards === 13 && g.IDIOM.everNotYetCards === 10 && near(g.IDIOM.rate, 10 / 13) && g.IDIOM.label === "IDIOM" && JSON.stringify(Object.keys(g.IDIOM)) === JSON.stringify(["key", "label", "totalCards", "everNotYetCards", "rate"]), r2.j.byKind);
    const t = Object.fromEntries(r2.j.byTopic.map((x: any) => [x.key, x]));
    check("byTopic: thẻ hai chủ đề tính ở cả hai (travel 12; work = 12 + 13); chủ đề dưới ngưỡng ẩn (rare, alpha, beta)", r2.j.byTopic.map((x: any) => x.key).join() === "daily life,travel,work" && t.travel.totalCards === 12 && t.travel.everNotYetCards === 10 && t.work.totalCards === 25 && t.work.everNotYetCards === 20 && t["daily life"].totalCards === 10 && near(t["daily life"].rate, 1) && near(t.work.rate, 0.8), r2.j.byTopic);
    const ls = Object.fromEntries(r2.j.byLesson.map((x: any) => [x.key, x]));
    check("byLesson: nhãn 'dd/MM · tên khóa', 'dd/MM · Ôn tập' (không khóa), 'dd/MM · Ôn thẻ' (buổi ôn thẻ); sắp theo tỷ lệ", r2.j.byLesson.map((x: any) => x.key).join() === [lesson3, lesson1, lesson2].join() && ls[lesson1].label === `${dm(d1)} · Khóa A` && ls[lesson2].label === `${dm(d2)} · Ôn tập` && ls[lesson3].label === `${dm(d3)} · Ôn thẻ` && ls[lesson1].totalCards === 12 && ls[lesson1].everNotYetCards === 10 && ls[lesson2].totalCards === 13 && ls[lesson4] === undefined, r2.j.byLesson);
    check("thẻ không có buổi nguồn (PHRASAL_VERB) không tạo nhóm buổi học", r2.j.byLesson.every((x: any) => [lesson1, lesson2, lesson3, lesson4].includes(x.key)));

    // ---- hardestCards ----
    const hc = r2.j.hardestCards;
    check("hardestCards: tối đa 10, notYetCount ≥ 3, nhiều nhất trước; loại thẻ 3 và 4 (ngoài top 10) và thẻ còn dưới 3", hc.length === 10 && hc.map((c: any) => c.notYetCount).join() === "14,13,12,11,10,9,8,7,6,5" && !hc.some((c: any) => [collo[0].id, collo[1].id, idiom[0].id].includes(c.id)), hc.map((c: any) => c.notYetCount));
    check("hardestCards: đủ trường id, phrase, meaning, example, note, kind, topics, notYetCount, reviewCount", JSON.stringify(Object.keys(hc[0])) === JSON.stringify(["id", "phrase", "meaning", "example", "note", "kind", "topics", "notYetCount", "reviewCount"]) && hc[0].id === pattern[0].id && hc[0].phrase === pattern[0].phrase && hc[0].meaning === pattern[0].meaning && hc[0].example === pattern[0].example && hc[0].note === pattern[0].note && hc[0].kind === "PATTERN" && JSON.stringify(hc[0].topics) === JSON.stringify(["daily life", "rare"]) && hc[0].reviewCount === 16, hc[0]);
    const tt = await seed([2, 3, 3, 0].map((c) => row(T, "COLLOCATION", ny(c))));
    const rt = await INS(T);
    check("ngưỡng hay quên: chỉ thẻ có ≥ 3 lượt Chưa nhớ (2 thẻ), nhóm 4 thẻ chưa đủ 10 nên ẩn", rt.j.hardestCards.length === 2 && rt.j.hardestCards.every((c: any) => c.notYetCount === 3 && [tt[1].id, tt[2].id].includes(c.id)) && rt.j.byKind.length === 0, rt.j);

    // ---- totals theo kỳ, nhóm tích luỹ ----
    const start7 = periodStart(today, 7).getTime();
    const p = pattern;
    const rv = (card: { id: string }, rating: "NOT_YET" | "REMEMBERED", before: string, after: string, at: number) => ({ userId: a.id, cardId: card.id, reviewedAt: new Date(at), rating, bucket: "NEW" as const, stageBefore: before as "NEW", stageAfter: after as "NEW" });
    await db.insert(studyCardReviews).values([
      rv(p[0], "NOT_YET", "WEEKLY", "LEARNING", now - 60_000), // R1 trong kỳ 7
      rv(p[1], "REMEMBERED", "LEARNING", "WEEKLY", now - 2 * HOUR), // R2: lên WEEKLY
      rv(p[2], "REMEMBERED", "NEW", "WEEKLY", start7 + 60_000), // R3: sát đầu kỳ 7 (trong kỳ), lên WEEKLY
      rv(p[3], "REMEMBERED", "WEEKLY", "MONTHLY", now - 3 * HOUR), // R4: không phải lên WEEKLY
      rv(p[4], "REMEMBERED", "WEEKLY", "WEEKLY", now - 4 * HOUR), // R5: ôn thêm, giữ WEEKLY → không tính
      rv(p[5], "NOT_YET", "WEEKLY", "LEARNING", start7 - 60_000), // R6: ngay trước đầu kỳ 7 (ngoài kỳ 7, trong kỳ 30)
      rv(p[6], "REMEMBERED", "NEW", "WEEKLY", now - 20 * DAY), // R7: trong kỳ 30
      rv(p[7], "NOT_YET", "WEEKLY", "LEARNING", now - 40 * DAY), // R8: chỉ trong kỳ 90
      rv(p[7], "REMEMBERED", "LEARNING", "WEEKLY", now - 40 * DAY + HOUR), // R9: lên WEEKLY, chỉ trong kỳ 90
      rv(p[8], "NOT_YET", "WEEKLY", "LEARNING", now - 100 * DAY), // R10: ngoài mọi kỳ
    ]);
    const k7 = await INS(I, "&days=7"), k30 = await INS(I, "&days=30"), k90 = await INS(I, "&days=90");
    check("totals 7 ngày: 5 lượt, tỷ lệ Chưa nhớ 1/5, 2 thẻ lên WEEKLY (R4 lên MONTHLY và R5 giữ WEEKLY không tính)", k7.j.days === 7 && k7.j.totals.reviews === 5 && near(k7.j.totals.notYetRate, 1 / 5) && k7.j.totals.promotedToWeekly === 2, k7.j.totals);
    check("totals 30 ngày: 7 lượt (thêm R6 sát ngoài kỳ 7 và R7), Chưa nhớ 2/7, 3 lên WEEKLY", k30.j.days === 30 && k30.j.totals.reviews === 7 && near(k30.j.totals.notYetRate, 2 / 7) && k30.j.totals.promotedToWeekly === 3, k30.j.totals);
    check("totals 90 ngày: 11 lượt (thêm R8, R9 và cặp 45 ngày; R10 100 ngày vẫn ngoài), Chưa nhớ 4/11, 5 lên WEEKLY", k90.j.days === 90 && k90.j.totals.reviews === 11 && near(k90.j.totals.notYetRate, 4 / 11) && k90.j.totals.promotedToWeekly === 5, k90.j.totals);
    const same = (x: any) => JSON.stringify([x.j.byKind, x.j.byTopic, x.j.byLesson, x.j.hardestCards]);
    check("nhóm và hardestCards tích luỹ: giống hệt ở 7, 30 và 90 ngày dù lượt ôn nằm ngoài kỳ", same(k7) === same(k30) && same(k30) === same(k90) && k7.j.byKind.length === 3, k7.j.byKind.length);

    // ---- days hợp lệ / không hợp lệ ----
    const bad = await Promise.all(["0", "14", "abc", "", "7.5", "-7", "365"].map((d) => INS(I, `&days=${d}`)));
    check("days ngoài 7/30/90 → 400 invalid_days", bad.every((r) => r.s === 400 && r.j?.error === "invalid_days"), bad.map((r) => [r.s, r.j]));
    check("subjectId thiếu → 400", (await H("GET", "/cards/insights")).s === 400 && (await H("GET", "/cards/topics")).s === 400);

    // ---- phân quyền ----
    check("404 subject_not_found: môn của user khác, id lạ, không phải uuid (insights và topics)", (await INS(I, "", B)).j?.error === "subject_not_found" && (await TOP(I, B)).j?.error === "subject_not_found" && (await INS(randomUUID())).s === 404 && (await TOP(randomUUID())).s === 404 && (await INS("abc")).s === 404 && (await TOP("abc")).s === 404);
    check("401 không token", (await INS(I, "", null)).s === 401 && (await TOP(I, null)).s === 401);
    const [bCard] = await db.insert(studyCards).values(row(BS, "IDIOM", { topics: ["bee"], notYetCount: 5, reviewCount: 7 }, b.id)).returning();
    await db.insert(studyCardReviews).values({ userId: b.id, cardId: bCard.id, reviewedAt: new Date(), rating: "NOT_YET", bucket: "NEW", stageBefore: "NEW", stageAfter: "LEARNING" });
    const bi = await INS(BS, "", B);
    check("user B chỉ thấy dữ liệu của mình (1 lượt, thẻ hay quên 1, không lẫn thẻ A); số liệu của A không đổi", bi.j.totals.reviews === 1 && bi.j.hardestCards.length === 1 && bi.j.hardestCards[0].id === bCard.id && (await INS(I, "&days=7")).j.totals.reviews === 5 && JSON.stringify((await TOP(BS, B)).j) === JSON.stringify({ topics: [{ topic: "bee", cards: 1 }] }), bi.j);

    // ---- /cards/topics ----
    const suspended = (await db.select().from(studyCards).where(eq(studyCards.subjectId, I))).filter((c) => c.suspended).length;
    const tp = await TOP(I);
    check("topics: đếm mọi thẻ KỂ CẢ thẻ tạm dừng (2 thẻ travel/work đang tạm dừng); mỗi thẻ tính một lần cho mỗi chủ đề", suspended === 2 && tp.s === 200 && tp.j.topics.find((x: any) => x.topic === "travel").cards === 12 && tp.j.topics.find((x: any) => x.topic === "work").cards === 25, tp.j);
    check("topics: nhiều thẻ trước, bằng nhau theo chữ cái (alpha trước beta); hình dạng { topics: [{topic, cards}] }", JSON.stringify(tp.j) === JSON.stringify({ topics: [{ topic: "work", cards: 25 }, { topic: "travel", cards: 12 }, { topic: "daily life", cards: 10 }, { topic: "rare", cards: 5 }, { topic: "alpha", cards: 2 }, { topic: "beta", cards: 2 }] }), tp.j);

    // ---- môn trống ----
    const ei = await INS(E), et = await TOP(E);
    check("môn trống: số 0 và mảng rỗng, không lỗi", ei.s === 200 && JSON.stringify(ei.j) === JSON.stringify({ days: 30, minCards: 10, totals: { reviews: 0, notYetRate: 0, promotedToWeekly: 0 }, byKind: [], byTopic: [], byLesson: [], hardestCards: [] }), ei.j);
    check("môn trống: topics rỗng", et.s === 200 && JSON.stringify(et.j) === JSON.stringify({ topics: [] }), et.j);
    // xoá buổi nguồn → thẻ mất nhóm buổi học (source_log_id về null), các nhóm khác giữ nguyên
    await db.delete(studyLogs).where(eq(studyLogs.id, lesson1));
    const after = await INS(I, "&days=7");
    check("xoá buổi học nguồn: nhóm buổi đó biến mất, nhóm loại/chủ đề giữ nguyên", !after.j.byLesson.some((x: any) => x.key === lesson1) && after.j.byKind.length === 3 && after.j.byTopic.length === 3, after.j.byLesson.map((x: any) => x.key));
  } finally {
    // user tạm xoá → môn, thẻ, lượt ôn, buổi học đều cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const leftS = await db.select({ id: studySubjects.id }).from(studySubjects).where(eq(studySubjects.userId, a.id));
    const leftC = await db.select({ id: studyCards.id }).from(studyCards).where(eq(studyCards.userId, a.id));
    const leftR = await db.select({ id: studyCardReviews.id }).from(studyCardReviews).where(eq(studyCardReviews.userId, a.id));
    const leftL = await db.select({ id: studyLogs.id }).from(studyLogs).where(eq(studyLogs.userId, a.id));
    const leftB = await db.select({ id: studyCards.id }).from(studyCards).where(eq(studyCards.userId, b.id));
    check("dọn dữ liệu test (môn, thẻ, lượt ôn, buổi học của cả hai user)", leftS.length + leftC.length + leftR.length + leftL.length + leftB.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
