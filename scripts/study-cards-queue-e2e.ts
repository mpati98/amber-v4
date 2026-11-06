// Kiểm thử tích hợp hàng ôn thẻ từ vựng trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/study-cards-queue-e2e.ts — tạo 2 user tạm rồi kiểm tra GET /cards/queue (tạo kế hoạch một lần,
// bù thêm, giới hạn 20), POST /cards/[id]/review (ôn thêm, NOT_YET quay lại, các mã 409, ôn song song), khối `cards`
// của GET /overview (không tạo kế hoạch); rồi XÓA user tạm (cascade) kể cả khi có check hỏng.
// Từ chối chạy nếu DB là production. Bỏ qua nếu còn < 10 phút tới nửa đêm giờ VN (NOT_YET quay lại cần hạn trong ngày).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyCardDayPlanItems, studyCardReviews, studyCards, studySubjects, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";
import { dayBounds } from "@/lib/study-card-day";
import { addDaysIso } from "@/lib/deadline-alert";
import { firstReviewDayOf, monthBoundsOfIso, nextReviewDay, vnDayStart, vnToday } from "@/lib/vn-time";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
if (dayBounds(vnToday()).end.getTime() - Date.now() < 10 * 60_000) {
  console.log("Bỏ qua: còn < 10 phút tới nửa đêm giờ VN, chạy lại sau.");
  process.exit(0);
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
const DAY = 86_400_000;

async function main() {
  const today = vnToday();
  const mk = async () => (await db.insert(users).values({ email: `study-cards-queue-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id }))[0];
  const a = await mk(), b = await mk();
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    const H = (m: string, p: string, body?: unknown, tok: string | null = A) => call(tok, m, HT + p, body);
    const Q = (sid: string, tok: string | null = A) => H("GET", `/cards/queue?subjectId=${sid}`, undefined, tok);
    const R = (cid: string, rating: string, tok: string | null = A) => H("POST", `/cards/${cid}/review`, { rating }, tok);
    const planRows = (sid: string) => db.select().from(studyCardDayPlanItems).where(eq(studyCardDayPlanItems.subjectId, sid));
    const card = async (id: string) => (await db.select().from(studyCards).where(eq(studyCards.id, id)))[0];
    const reviewsOf = (id: string) => db.select().from(studyCardReviews).where(eq(studyCardReviews.cardId, id)).orderBy(asc(studyCardReviews.reviewedAt));
    const insertCards = async (sid: string, rows: Partial<typeof studyCards.$inferInsert>[], prefix: string) =>
      db.insert(studyCards).values(rows.map((r, i) => ({ userId: a.id, subjectId: sid, phrase: `${prefix} phrase ${i}`, phraseKey: `${prefix} phrase ${i}`, meaning: "m", example: "e", kind: "COLLOCATION" as const, ...r }))).returning();
    const oldNotYet = async (cardId: string, times: number) => {
      for (let i = 0; i < times; i++) await db.insert(studyCardReviews).values({ userId: a.id, cardId, reviewedAt: new Date(Date.now() - (3 + i) * DAY), rating: "NOT_YET", bucket: "NEW", stageBefore: "WEEKLY", stageAfter: "LEARNING" });
    };
    const future = (days: number) => new Date(Date.now() + days * DAY);

    // ===== Môn H: NEW + HARD + RANDOM =====
    const H1 = (await H("POST", "/subjects", { name: "Môn thẻ" })).j.id as string;
    const [hardA, hardB] = await insertCards(H1, [{ stage: "WEEKLY", dueAt: future(10), reviewCount: 3, notYetCount: 2 }, { stage: "WEEKLY", dueAt: future(11), reviewCount: 3, notYetCount: 2 }], "hard");
    const [rnd] = await insertCards(H1, [{ stage: "MONTHLY", dueAt: future(20) }], "rnd");
    const news = await insertCards(H1, [0, 1, 2].map((i) => ({ createdAt: new Date(Date.now() - (10 - i) * 60_000) })), "new");
    await oldNotYet(hardA.id, 2);
    await oldNotYet(hardB.id, 2);

    check("401 không token", (await Q(H1, null)).s === 401 && (await call(null, "POST", `${HT}/cards/${hardA.id}/review`, { rating: "NOT_YET" })).s === 401);

    // ---- overview trước khi có kế hoạch: planned 0 và KHÔNG tạo kế hoạch ----
    const ov0 = await H("GET", "/overview");
    const o0 = ov0.j.subjects.find((s: any) => s.subjectId === H1);
    check("overview.cards khi chưa có kế hoạch: planned 0, finished 0, quota 20, nextReviewDay là Chủ nhật kế tiếp", ov0.s === 200 && o0.cards.planned === 0 && o0.cards.finished === 0 && o0.cards.quota === 20 && o0.cards.nextReviewDay === nextReviewDay(today, [7]), o0?.cards);
    check("overview giữ nguyên các trường cũ", ov0.j.today === today && !!ov0.j.week && o0.goalMinutes === null && !!o0.today && "next" in o0 && "activeCourse" in o0 && !!o0.counts && "vsBaseline" in o0, Object.keys(o0));
    check("GET /overview không tạo kế hoạch", (await planRows(H1)).length === 0);

    // ---- queue: kế hoạch tạo một lần ----
    const q1 = await Q(H1);
    check("queue: 200, date/quota/progress/counts/soonestDueAt", q1.s === 200 && q1.j.date === today && q1.j.quota === 20 && q1.j.soonestDueAt === null && q1.j.counts.total === 6 && q1.j.counts.WEEKLY === 2 && q1.j.counts.NEW === 3, q1.j);
    const rows1 = await planRows(H1);
    const bucketOf = (id: string) => rows1.find((r) => r.cardId === id)?.bucket;
    check("kế hoạch lưu 6 thẻ: 3 NEW, 2 HARD, 1 RANDOM", rows1.length === 6 && news.every((c) => bucketOf(c.id) === "NEW") && bucketOf(hardA.id) === "HARD" && bucketOf(hardB.id) === "HARD" && bucketOf(rnd.id) === "RANDOM", rows1.map((r) => r.bucket));
    check("progress: planned 6, finished 0, remaining 6, theo nhóm", q1.j.progress.planned === 6 && q1.j.progress.finished === 0 && q1.j.progress.remaining === 6 && q1.j.progress.byBucket.NEW.planned === 3 && q1.j.progress.byBucket.HARD.planned === 2 && q1.j.progress.byBucket.RANDOM.planned === 1 && q1.j.progress.byBucket.DUE.planned === 0, q1.j.progress);
    check("hàng ôn theo thứ tự kế hoạch (NEW → HARD → RANDOM), mỗi thẻ có bucket và next", q1.j.cards.map((c: any) => c.bucket).join() === "NEW,NEW,NEW,HARD,HARD,RANDOM" && q1.j.cards.slice(0, 3).map((c: any) => c.id).join() === news.map((c) => c.id).join() && q1.j.cards.every((c: any) => ["NOT_YET", "REVIEW_AGAIN", "REMEMBERED"].every((r) => c.next[r].stage && "dueAt" in c.next[r])), q1.j.cards.map((c: any) => c.bucket));
    const hCard = q1.j.cards.find((c: any) => c.id === hardA.id);
    check("next của thẻ HARD (lượt đầu = ôn thêm): Đã nhớ giữ nguyên giai đoạn và hạn; Chưa nhớ → LEARNING", hCard.next.REMEMBERED.stage === "WEEKLY" && new Date(hCard.next.REMEMBERED.dueAt).getTime() === hardA.dueAt!.getTime() && hCard.next.NOT_YET.stage === "LEARNING", hCard.next);
    const nCard = q1.j.cards.find((c: any) => c.id === news[0].id);
    check("next của thẻ NEW: Đã nhớ → WEEKLY ngày ôn kế tiếp (đầu ngày VN), Cần ôn lại → đầu ngày mai", nCard.next.REMEMBERED.stage === "WEEKLY" && new Date(nCard.next.REMEMBERED.dueAt).getTime() === vnDayStart(nextReviewDay(today, [7])).getTime() && new Date(nCard.next.REVIEW_AGAIN.dueAt).getTime() === dayBounds(today).end.getTime(), nCard.next);
    const q2 = await Q(H1);
    const rows2 = await planRows(H1);
    check("gọi lại: cùng kế hoạch (không thêm, không đổi), cùng hàng ôn", rows2.length === 6 && rows2.map((r) => r.id).sort().join() === rows1.map((r) => r.id).sort().join() && q2.j.cards.map((c: any) => c.id).join() === q1.j.cards.map((c: any) => c.id).join());
    const parallelQ = await Promise.all([1, 2, 3].map(() => Q(H1)));
    check("gọi song song: vẫn đúng 6 mục kế hoạch", parallelQ.every((r) => r.s === 200) && (await planRows(H1)).length === 6);

    // ---- bù thêm ----
    const imp = await H("POST", "/cards/import", { subjectId: H1, cards: [0, 1, 2].map((i) => ({ phrase: `topup phrase ${i}`, meaning: "m", example: "e", kind: "IDIOM" })) });
    const q3 = await Q(H1);
    const rows3 = await planRows(H1);
    check("nhập thêm 3 thẻ mới → bù vào kế hoạch: 9 mục, mục cũ giữ nguyên", imp.j.created === 3 && rows3.length === 9 && rows1.every((r) => rows3.some((x) => x.id === r.id && x.bucket === r.bucket)) && q3.j.progress.planned === 9 && q3.j.progress.byBucket.NEW.planned === 6, q3.j.progress);

    // ---- review: ôn thêm (HARD, lượt đầu) ----
    const hardAdue = hardA.dueAt!.getTime();
    const r1 = await R(hardA.id, "REMEMBERED");
    const hA = await card(hardA.id);
    check("review lượt đầu HARD + Đã nhớ: giai đoạn và hạn KHÔNG đổi; đếm +1; lastReviewedAt đặt", r1.s === 201 && hA.stage === "WEEKLY" && hA.dueAt!.getTime() === hardAdue && hA.reviewCount === 4 && hA.notYetCount === 2 && hA.lastReviewedAt !== null, hA);
    check("response review: card (có bucket, next), progress, soonestDueAt", r1.j.card.id === hardA.id && r1.j.card.bucket === "HARD" && !!r1.j.card.next && r1.j.progress.finished === 1 && r1.j.progress.remaining === 8 && r1.j.progress.byBucket.HARD.finished === 1 && r1.j.soonestDueAt === null, r1.j);
    const revA = await reviewsOf(hardA.id).then((x) => x.filter((r) => r.reviewedAt.getTime() > Date.now() - 60_000));
    check("review row: bucket HARD, WEEKLY → WEEKLY, dueAfter = hạn cũ", revA.length === 1 && revA[0].bucket === "HARD" && revA[0].rating === "REMEMBERED" && revA[0].stageBefore === "WEEKLY" && revA[0].stageAfter === "WEEKLY" && revA[0].dueAfter!.getTime() === hardAdue && revA[0].userId === a.id, revA);
    const qA = await Q(H1);
    check("thẻ đã xong rời hàng ôn", !qA.j.cards.some((c: any) => c.id === hardA.id) && qA.j.cards.length === 8);

    // ---- 409 ----
    check("409 already_finished_today (ôn lại thẻ đã xong)", (await R(hardA.id, "REMEMBERED")).j?.error === "already_finished_today" && (await R(hardA.id, "NOT_YET")).s === 409);
    await H("PATCH", `/cards/${news[2].id}`, { suspended: true });
    const qSusp = await Q(H1);
    check("409 card_suspended; thẻ tạm dừng không còn trong hàng ôn và không tính vào tiến độ (9 → 8)", (await R(news[2].id, "REMEMBERED")).j?.error === "card_suspended" && !qSusp.j.cards.some((c: any) => c.id === news[2].id) && qSusp.j.progress.planned === 8 && (await planRows(H1)).length === 9, qSusp.j.progress);
    await H("PATCH", `/cards/${news[2].id}`, { suspended: false });

    // ---- NOT_YET → quay lại ----
    const rn = await R(hardB.id, "NOT_YET");
    const hB1 = await card(hardB.id);
    check("NOT_YET: LEARNING, hạn ≈ +5 phút, notYetCount +1, progress chưa tính finished", rn.s === 201 && hB1.stage === "LEARNING" && Math.abs(hB1.dueAt!.getTime() - (Date.now() + 5 * 60_000)) < 60_000 && hB1.notYetCount === 3 && hB1.reviewCount === 4 && rn.j.progress.finished === 1, [rn.j, hB1]);
    check("NOT_YET: soonestDueAt = hạn của thẻ; thẻ ra khỏi hàng ôn", new Date(rn.j.soonestDueAt).getTime() === hB1.dueAt!.getTime() && !(await Q(H1)).j.cards.some((c: any) => c.id === hardB.id) && new Date((await Q(H1)).j.soonestDueAt).getTime() === hB1.dueAt!.getTime());
    const rEarly = await R(hardB.id, "REMEMBERED");
    check("409 not_due_yet (RETURNING chưa đến hạn); thẻ không đổi", rEarly.j?.error === "not_due_yet" && (await card(hardB.id)).stage === "LEARNING", rEarly);
    await db.update(studyCards).set({ dueAt: new Date(Date.now() - 60_000) }).where(eq(studyCards.id, hardB.id));
    const qB = await Q(H1);
    check("hết hạn chờ: thẻ quay lại hàng ôn (nhóm HARD), soonestDueAt null", qB.j.cards.some((c: any) => c.id === hardB.id && c.bucket === "HARD") && qB.j.soonestDueAt === null, qB.j.soonestDueAt);
    const rb = await R(hardB.id, "REMEMBERED");
    const hB2 = await card(hardB.id);
    check("lượt sau NOT_YET là lượt THƯỜNG: LEARNING → WEEKLY, hạn = ngày ôn kế tiếp", rb.s === 201 && hB2.stage === "WEEKLY" && hB2.dueAt!.getTime() === vnDayStart(nextReviewDay(today, [7])).getTime() && hB2.reviewCount === 5 && hB2.notYetCount === 3, hB2);
    const revB = await reviewsOf(hardB.id).then((x) => x.filter((r) => r.reviewedAt.getTime() > Date.now() - 60_000));
    check("review rows của thẻ HARD đó: NOT_YET (WEEKLY→LEARNING) rồi REMEMBERED (LEARNING→WEEKLY), cùng bucket HARD", revB.length === 2 && revB[0].rating === "NOT_YET" && revB[0].stageBefore === "WEEKLY" && revB[0].stageAfter === "LEARNING" && revB[1].rating === "REMEMBERED" && revB[1].stageBefore === "LEARNING" && revB[1].stageAfter === "WEEKLY" && revB.every((r) => r.bucket === "HARD"), revB);
    check("thẻ xong sau NOT_YET + REMEMBERED: progress.finished 2", (await Q(H1)).j.progress.finished === 2);

    // ---- REVIEW_AGAIN tính là xong ----
    const ra = await R(news[0].id, "REVIEW_AGAIN");
    const n0 = await card(news[0].id);
    check("REVIEW_AGAIN: LEARNING, hạn đầu ngày mai VN, tính finished, notYetCount không đổi", ra.s === 201 && n0.stage === "LEARNING" && n0.dueAt!.getTime() === dayBounds(today).end.getTime() && n0.notYetCount === 0 && n0.reviewCount === 1 && ra.j.progress.finished === 3 && ra.j.soonestDueAt === null, [ra.j.progress, n0]);
    const rows4 = await reviewsOf(news[0].id);
    check("review row thẻ NEW: bucket NEW, NEW → LEARNING", rows4.length === 1 && rows4[0].bucket === "NEW" && rows4[0].stageBefore === "NEW" && rows4[0].stageAfter === "LEARNING" && rows4[0].rating === "REVIEW_AGAIN");
    const rr = await R(news[1].id, "REMEMBERED");
    check("thẻ NEW + Đã nhớ → WEEKLY (không phải ôn thêm)", rr.s === 201 && (await card(news[1].id)).stage === "WEEKLY" && (await card(news[1].id)).dueAt!.getTime() === vnDayStart(nextReviewDay(today, [7])).getTime());
    check("RANDOM lượt đầu + Đã nhớ: giữ nguyên giai đoạn/hạn (ôn thêm); review bucket RANDOM", (await R(rnd.id, "REMEMBERED")).s === 201 && (await card(rnd.id)).stage === "MONTHLY" && (await card(rnd.id)).dueAt!.getTime() === rnd.dueAt!.getTime() && (await reviewsOf(rnd.id)).at(-1)!.bucket === "RANDOM");

    // ---- ôn song song cùng một thẻ: đúng một lần thành công ----
    const pc = news[0] && (await db.select().from(studyCards).where(and(eq(studyCards.subjectId, H1), eq(studyCards.phrase, "topup phrase 0"))))[0];
    const par = await Promise.all([1, 2, 3, 4].map(() => R(pc.id, "REMEMBERED")));
    const okCount = par.filter((r) => r.s === 201).length;
    const pcAfter = await card(pc.id);
    check("4 lượt ôn song song cùng thẻ: đúng 1 thành công, còn lại 409 already_finished_today", okCount === 1 && par.filter((r) => r.s === 409 && r.j.error === "already_finished_today").length === 3 && pcAfter.reviewCount === 1 && (await reviewsOf(pc.id)).length === 1, par.map((r) => [r.s, r.j?.error]));
    const pcN = (await db.select().from(studyCards).where(and(eq(studyCards.subjectId, H1), eq(studyCards.phrase, "topup phrase 1"))))[0];
    const parN = await Promise.all([1, 2].map(() => R(pcN.id, "NOT_YET")));
    check("2 lượt NOT_YET song song: đúng 1 thành công (không cộng notYetCount hai lần), kia 409 not_due_yet", parN.filter((r) => r.s === 201).length === 1 && parN.filter((r) => r.s === 409 && r.j.error === "not_due_yet").length === 1 && (await card(pcN.id)).notYetCount === 1, parN.map((r) => [r.s, r.j?.error]));

    // ---- notYetCount chỉ tăng khi NOT_YET ----
    const all = await db.select().from(studyCards).where(eq(studyCards.subjectId, H1));
    const allRev = await db.select().from(studyCardReviews).where(and(eq(studyCardReviews.userId, a.id)));
    const todayStart = dayBounds(today).start.getTime();
    const todays = allRev.filter((r) => r.reviewedAt.getTime() >= todayStart);
    check("notYetCount tăng đúng bằng số lượt NOT_YET hôm nay (so với giá trị gài sẵn)", all.every((c) => c.notYetCount === (c.id === hardA.id || c.id === hardB.id ? 2 : 0) + todays.filter((r) => r.cardId === c.id && r.rating === "NOT_YET").length), all.map((c) => [c.phrase, c.notYetCount]));

    // ---- phân quyền ----
    check("404 card_not_found: thẻ của user khác, id lạ, không phải uuid", (await R(hardA.id, "NOT_YET", B)).j?.error === "card_not_found" && (await R(randomUUID(), "NOT_YET")).j?.error === "card_not_found" && (await R("abc", "NOT_YET")).s === 404);
    check("404 subject_not_found: queue môn của user khác / lạ / không phải uuid; thiếu subjectId → 400", (await Q(H1, B)).j?.error === "subject_not_found" && (await Q(randomUUID())).s === 404 && (await Q("abc")).s === 404 && (await H("GET", "/cards/queue")).s === 400);
    check("400: rating sai / thiếu / JSON hỏng", (await R(news[1].id, "MAYBE")).s === 400 && (await H("POST", `/cards/${news[1].id}/review`, {})).s === 400);
    check("kế hoạch của A còn nguyên 9 mục sau mọi yêu cầu của B", (await planRows(H1)).length === 9);

    // ===== Môn D: 25 thẻ đến hạn → đúng 20, cũ nhất trước =====
    const D = (await H("POST", "/subjects", { name: "Nhiều thẻ đến hạn" })).j.id as string;
    const dueRows = await insertCards(D, Array.from({ length: 25 }, (_, i) => ({ stage: "WEEKLY" as const, dueAt: new Date(Date.now() - (30 - i) * 3_600_000) })), "due"); // i = 0 quá hạn lâu nhất
    await insertCards(D, [{}, {}], "dnew");
    const qd = await Q(D);
    const oldest20 = dueRows.slice(0, 20).map((c) => c.id);
    check("25 thẻ đến hạn → kế hoạch đúng 20, toàn DUE, không có thẻ mới", qd.s === 200 && qd.j.progress.planned === 20 && qd.j.progress.byBucket.DUE.planned === 20 && qd.j.progress.byBucket.NEW.planned === 0 && (await planRows(D)).length === 20, qd.j.progress);
    check("20 thẻ DUE là 20 thẻ quá hạn lâu nhất, hàng ôn xếp cũ nhất trước", qd.j.cards.map((c: any) => c.id).join() === oldest20.join(), qd.j.cards.length);
    check("409 not_in_today_plan: thẻ đến hạn nhưng bị dồn sang ngày sau", (await R(dueRows[24].id, "REMEMBERED")).j?.error === "not_in_today_plan");
    const nextMonth = monthBoundsOfIso(addDaysIso(monthBoundsOfIso(today).end, 1));
    const rd = await R(oldest20[0], "REMEMBERED");
    const dCard = await card(oldest20[0]);
    check("review thẻ DUE: bucket DUE, WEEKLY → MONTHLY (không phải ôn thêm), hạn = Chủ nhật đầu tháng sau", rd.s === 201 && rd.j.card.bucket === "DUE" && dCard.stage === "MONTHLY" && dCard.dueAt!.getTime() === vnDayStart(firstReviewDayOf(nextMonth.start, nextMonth.end, [7])!).getTime() && (await reviewsOf(oldest20[0]))[0].bucket === "DUE" && rd.j.progress.byBucket.DUE.finished === 1, rd.j);

    // ===== Môn S: chưa có kế hoạch, thứ ôn tuỳ chỉnh; overview chỉ đọc =====
    const S = (await H("POST", "/subjects", { name: "Chưa mở hàng ôn", reviewWeekdays: [3, 6] })).j.id as string;
    const [snew] = await insertCards(S, [{}, {}, {}], "snew");
    const rNoPlan = await R(snew.id, "NOT_YET");
    check("409 not_in_today_plan: thẻ chưa vào kế hoạch (môn chưa mở hàng ôn); không ghi lượt ôn", rNoPlan.s === 409 && rNoPlan.j.error === "not_in_today_plan" && (await reviewsOf(snew.id)).length === 0 && (await planRows(S)).length === 0, rNoPlan);
    const ovS = (await H("GET", "/overview")).j.subjects.find((s: any) => s.subjectId === S);
    check("overview: môn chưa có kế hoạch → planned 0; nextReviewDay theo thứ ôn của môn; vẫn không tạo kế hoạch", ovS.cards.planned === 0 && ovS.cards.finished === 0 && ovS.cards.nextReviewDay === nextReviewDay(today, [3, 6]) && (await planRows(S)).length === 0, ovS.cards);
    const ovAfter = (await H("GET", "/overview")).j.subjects;
    const oh = ovAfter.find((s: any) => s.subjectId === H1).cards, od = ovAfter.find((s: any) => s.subjectId === D).cards;
    const qNow = await Q(H1);
    check("overview.cards khớp progress của queue (môn H) và môn D", oh.planned === qNow.j.progress.planned && oh.finished === qNow.j.progress.finished && oh.quota === 20 && od.planned === 20 && od.finished === 1, [oh, qNow.j.progress, od]);
    check("overview user khác: không thấy môn của A", (await H("GET", "/overview", undefined, B)).j.subjects.length === 0);
  } finally {
    // user tạm xoá → môn, thẻ, lượt ôn, kế hoạch đều cascade
    await db.delete(users).where(eq(users.id, a.id));
    await db.delete(users).where(eq(users.id, b.id));
    const leftS = await db.select({ id: studySubjects.id }).from(studySubjects).where(eq(studySubjects.userId, a.id));
    const leftC = await db.select({ id: studyCards.id }).from(studyCards).where(eq(studyCards.userId, a.id));
    const leftP = await db.select({ id: studyCardDayPlanItems.id }).from(studyCardDayPlanItems).where(eq(studyCardDayPlanItems.userId, a.id));
    const leftR = await db.select({ id: studyCardReviews.id }).from(studyCardReviews).where(eq(studyCardReviews.userId, a.id));
    check("dọn dữ liệu test (môn, thẻ, kế hoạch, lượt ôn)", leftS.length + leftC.length + leftP.length + leftR.length === 0);
  }
  console.log(fails === 0 ? "\nTẤT CẢ PASS" : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
