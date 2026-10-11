// Kiểm thử tích hợp /api/brain-logs trên Neon DEV BRANCH (npm run dev phải đang chạy ở :3000).
// Chạy: npx tsx scripts/brain-logs-e2e.ts — tạo user tạm + dòng log tạm, kiểm tra xác thực, cô lập giữa user, phân trang,
// lọc, thống kê, feedback, PATCH, ingest, export, rồi XÓA hết dữ liệu tạm. Từ chối chạy nếu DB là production. Không in token/URL.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentLogs, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";

const host = (u?: string) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Từ chối chạy: DATABASE_URL không phải nhánh dev (trùng host production hoặc chưa đặt).");
  process.exit(3);
}
const BASE = "http://localhost:3000/api/brain-logs";
let fails = 0;
const check = (name: string, ok: boolean, extra?: unknown) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(extra)}`); };
const call = async (tok: string | null, method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), "Content-Type": "application/json" }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j };
};
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const msgs = [{ role: "system", content: "s" }, { role: "user", content: "chi 45k" }];

async function main() {
  const [a] = await db.select({ id: users.id }).from(users).limit(1);
  const [b] = await db.insert(users).values({ email: `brainlogs-e2e-${randomUUID()}@example.invalid`, passwordHash: "x" }).returning({ id: users.id });
  const ids: Record<string, string> = { exp: randomUUID(), chat: randomUUID(), cor: randomUUID(), rej: randomUUID(), fresh: randomUUID(), bad: randomUUID() };
  const idList: string[] = Object.values(ids);
  try {
    const A = await signAccessToken(a.id), B = await signAccessToken(b.id);
    for (const [m, p] of [["GET", ""], ["GET", "/stats"], ["GET", "/export"], ["GET", `/${ids.exp}`], ["PATCH", `/${ids.exp}`], ["POST", `/${ids.exp}/feedback`], ["POST", "/ingest"]])
      check(`401 không token ${m} ${p || "/"}`, (await call(null, m, p, {})).s === 401);

    const rowExp = { id: ids.exp, createdAt: ago(5), agent: "expense", userInput: "chi 45k ăn trưa", lang: "vi", messages: msgs, tools: [{ type: "function" }],
      rawOutput: "{}", parsedOutput: { kind: "EXPENSE", amount_text: "45k" }, parseOk: true, toolName: "them_giao_dich", toolArgs: { kind: "EXPENSE" }, toolOk: true, latencyMs: 12, promptTokens: 5, completionTokens: 3 };
    const rowChat = { id: ids.chat, createdAt: ago(4), agent: "chat", userInput: "hi", messages: msgs, parsedOutput: "Hello!", parseOk: true, outcome: "accepted", outcomeAt: ago(1) };
    const rowCor = { id: ids.cor, createdAt: ago(3), agent: "expense", userInput: "mua cà phê 30k", messages: msgs, parsedOutput: { a: 1 }, toolName: "them_giao_dich", toolOk: true,
      outcome: "corrected", outcomeAt: ago(2), correctedOutput: { a: 2 }, correctedAt: ago(2), entityType: "transaction", entityId: "tx-1" };
    const rowRej = { id: ids.rej, createdAt: ago(2), agent: "expense", userInput: "x", messages: msgs, parsedOutput: { a: 3 }, toolOk: true, outcome: "rejected", outcomeAt: ago(1) };
    const rowFresh = { id: ids.fresh, createdAt: ago(0.1), agent: "expense", userInput: "mới", messages: msgs, parsedOutput: { a: 4 }, toolOk: true };

    let r = await call(A, "POST", "/ingest", { logs: [rowExp, rowChat, rowCor, rowRej, rowFresh, { id: ids.bad, createdAt: "không phải ngày", agent: "x" }] });
    check("ingest: lưu 5, 1 invalid", r.s === 200 && r.j.saved.length === 5 && r.j.invalid.length === 1 && r.j.invalid[0].id === ids.bad, r);
    r = await call(A, "POST", "/ingest", { logs: [rowExp, rowChat] });
    check("ingest lặp lại idempotent", r.s === 200 && r.j.saved.length === 2, r);
    r = await call(A, "POST", "/ingest", { logs: Array.from({ length: 26 }, () => rowExp) });
    check("ingest > 25 dòng → 400", r.s === 400, r.s);
    r = await call(A, "POST", "/ingest", { logs: [] });
    check("ingest rỗng → 400", r.s === 400, r.s);

    r = await call(A, "GET", `/${ids.exp}`);
    check("chi tiết đầy đủ + jsonb object nguyên vẹn", r.s === 200 && r.j.parsedOutput?.amount_text === "45k" && Array.isArray(r.j.messages) && r.j.messages.length === 2 && !("userId" in r.j), r.j);
    r = await call(A, "GET", `/${ids.chat}`);
    check("jsonb chuỗi không bị mã hóa 2 lần", r.j?.parsedOutput === "Hello!", r.j?.parsedOutput);
    check("chi tiết id lạ → 404", (await call(A, "GET", `/${randomUUID()}`)).s === 404 && (await call(A, "GET", "/not-a-uuid")).s === 404);

    r = await call(A, "GET", "?limit=2");
    const seen: string[] = r.j.items.map((i: any) => i.id);
    let cur = r.j.nextCursor, pages = 1;
    while (cur) { const p = await call(A, "GET", `?limit=2&cursor=${cur}`); seen.push(...p.j.items.map((i: any) => i.id)); cur = p.j.nextCursor; pages++; }
    const mine = seen.filter((i) => idList.includes(i));
    check("phân trang: đủ 5 dòng, không trùng, mới trước", mine.length === 5 && new Set(seen).size === seen.length && pages >= 3 && mine[0] === ids.fresh, { mine, pages });
    check("danh sách chỉ có trường tóm tắt", !("messages" in r.j.items[0]) && !("rawOutput" in r.j.items[0]) && "hasCorrection" in r.j.items[0] && "userInput" in r.j.items[0], Object.keys(r.j.items[0]));
    r = await call(A, "GET", "?outcome=corrected"); check("lọc outcome", r.j.items.some((i: any) => i.id === ids.cor) && r.j.items.every((i: any) => i.outcome === "corrected") && r.j.items.find((i: any) => i.id === ids.cor).hasCorrection === true, r.j.items.length);
    r = await call(A, "GET", "?agent=chat"); check("lọc agent", r.j.items.every((i: any) => i.agent === "chat") && r.j.items.some((i: any) => i.id === ids.chat));
    const day = ago(4).slice(0, 10);
    r = await call(A, "GET", `?from=${day}&to=${day}`); check("lọc khoảng ngày", r.s === 200 && r.j.items.every((i: any) => i.createdAt.slice(0, 10) >= ago(5).slice(0, 10)), r.j.items.map((i: any) => i.createdAt));
    for (const q of ["?outcome=x", "?limit=999", "?cursor=zzz", "?from=bad"]) check(`query sai ${q} → 400`, (await call(A, "GET", q)).s === 400);

    // user khác
    r = await call(B, "GET", ""); check("user B không thấy log của A", r.s === 200 && r.j.items.length === 0, r.j);
    check("B GET chi tiết → 404", (await call(B, "GET", `/${ids.exp}`)).s === 404);
    check("B PATCH → 404", (await call(B, "PATCH", `/${ids.exp}`, { excludeFromTraining: true })).s === 404);
    check("B feedback → 404", (await call(B, "POST", `/${ids.exp}/feedback`, { outcome: "rejected" })).s === 404);
    r = await call(B, "POST", "/ingest", { logs: [{ ...rowExp, userInput: "ĐÃ BỊ GHI ĐÈ" }] }); check("B ingest id của A → conflicts", r.j.conflicts?.[0] === ids.exp && r.j.saved.length === 0, r.j);
    r = await call(A, "GET", `/${ids.exp}`); check("log của A không bị B ghi đè / sửa", r.j.userInput === "chi 45k ăn trưa" && r.j.excludeFromTraining === false && r.j.outcome === "unknown", r.j);
    check("B stats rỗng", (await call(B, "GET", "/stats")).j.total === 0);
    check("B export rỗng", (await call(B, "GET", "/export")).j.items.length === 0);

    // stats: exp(unknown,tool_ok,5 ngày)=đủ, chat(accepted)=đủ, cor(corrected)=đủ, rej=không, fresh(unknown<3 ngày)=không
    r = await call(A, "GET", "/stats");
    const ex = r.j.byAgent.find((x: any) => x.agent === "expense"), ch = r.j.byAgent.find((x: any) => x.agent === "chat");
    check("stats: theo agent × outcome", ex && ch && ex.outcomes.rejected >= 1 && ex.outcomes.corrected >= 1 && ch.outcomes.accepted >= 1, r.j);
    const base = { exp: ex.eligible, ch: ch.eligible, total: r.j.eligible };
    check("stats: eligible đếm đủ (>=2 expense, >=1 chat)", ex.eligible >= 2 && ch.eligible >= 1, base);

    // feedback + gộp outcome theo mốc
    r = await call(A, "POST", `/${ids.fresh}/feedback`, { outcome: "accepted" }); check("feedback accepted", r.s === 200 && r.j.outcome === "accepted", r);
    check("feedback giá trị sai → 400", (await call(A, "POST", `/${ids.fresh}/feedback`, { outcome: "retried" })).s === 400);
    r = await call(A, "GET", "/stats"); check("feedback làm mẫu mới đủ điều kiện", r.j.byAgent.find((x: any) => x.agent === "expense").eligible === base.exp + 1, r.j);
    await call(A, "POST", "/ingest", { logs: [{ ...rowFresh, outcome: "rejected", outcomeAt: ago(1) }] });  // brain đẩy mốc CŨ hơn feedback
    check("ingest mốc cũ không đè feedback", (await call(A, "GET", `/${ids.fresh}`)).j.outcome === "accepted");
    // brain gửi outcome KHÔNG kèm mốc (chưa từng đặt) hoặc mốc bằng/cũ hơn: không bao giờ đè đánh giá đặt trong app
    for (const [name, at] of [["không mốc", null], ["mốc 1 năm trước", ago(365)]] as const) {
      await call(A, "POST", "/ingest", { logs: [{ ...rowFresh, outcome: "rejected", outcomeAt: at }] });
      check(`ingest outcome ${name} không đè đánh giá trong app`, (await call(A, "GET", `/${ids.fresh}`)).j.outcome === "accepted");
    }
    // ingest KHÔNG BAO GIỜ đặt excludeFromTraining: dòng mới kèm cờ này vẫn lưu false; dòng cũ giữ nguyên cờ app đã đặt
    const sneaky = randomUUID(); ids.bad = sneaky as typeof ids.bad;
    await call(A, "POST", "/ingest", { logs: [{ ...rowFresh, id: sneaky, excludeFromTraining: true }] });
    check("ingest dòng mới kèm excludeFromTraining:true → vẫn false", (await call(A, "GET", `/${sneaky}`)).j.excludeFromTraining === false);
    await call(A, "PATCH", `/${ids.fresh}`, { excludeFromTraining: true });
    await call(A, "POST", "/ingest", { logs: [{ ...rowFresh, excludeFromTraining: false }] });
    check("ingest excludeFromTraining:false không bỏ cờ app đã đặt", (await call(A, "GET", `/${ids.fresh}`)).j.excludeFromTraining === true);
    await call(A, "PATCH", `/${ids.fresh}`, { excludeFromTraining: false });
    await call(A, "POST", "/ingest", { logs: [{ ...rowFresh, userInput: "mới (cập nhật)", outcome: "corrected", outcomeAt: new Date(Date.now() + 5000).toISOString(), correctedOutput: { a: 9 }, correctedAt: new Date().toISOString() }] });
    r = await call(A, "GET", `/${ids.fresh}`); check("ingest mốc mới hơn thắng + cập nhật nội dung", r.j.outcome === "corrected" && r.j.correctedOutput?.a === 9 && r.j.userInput === "mới (cập nhật)", r.j);

    // PATCH exclude
    r = await call(A, "PATCH", `/${ids.exp}`, { excludeFromTraining: true }); check("PATCH exclude", r.s === 200 && r.j.excludeFromTraining === true, r);
    for (const bad of [{ userInput: "sửa" }, { excludeFromTraining: true, outcome: "accepted" }, {}, { excludeFromTraining: "yes" }])
      check(`PATCH sai ${JSON.stringify(bad)} → 400`, (await call(A, "PATCH", `/${ids.exp}`, bad)).s === 400);
    r = await call(A, "GET", `/${ids.exp}`); check("PATCH không đổi nội dung log", r.j.userInput === "chi 45k ăn trưa" && r.j.excludeFromTraining === true);
    await call(A, "POST", "/ingest", { logs: [rowExp] });
    check("ingest không reset exclude", (await call(A, "GET", `/${ids.exp}`)).j.excludeFromTraining === true);
    r = await call(A, "GET", "/stats"); check("loại mẫu: eligible giảm 1", r.j.byAgent.find((x: any) => x.agent === "expense").eligible === base.exp, r.j);
    await call(A, "PATCH", `/${ids.exp}`, { excludeFromTraining: false });

    // export
    await call(A, "PATCH", `/${ids.cor}`, { excludeFromTraining: true });
    let ex2: string[] = [], c2: string | null = null;
    do { const p = await call(A, "GET", "/export" + (c2 ? `?cursor=${c2}` : "")); ex2.push(...p.j.items.map((i: any) => i.id)); c2 = p.j.nextCursor; } while (c2);
    check("export: có exp/chat/fresh, không có rejected/bị loại", ex2.includes(ids.exp) && ex2.includes(ids.chat) && ex2.includes(ids.fresh) && !ex2.includes(ids.rej) && !ex2.includes(ids.cor), ex2.filter((i) => idList.includes(i)));
    const first = (await call(A, "GET", "/export")).j.items[0]; check("export trả dòng đầy đủ", "messages" in first && "tools" in first && !("userId" in first));

    // Luật "mẫu đủ điều kiện": CÙNG ca kiểm thử với amber-brain (tests/fixtures/eligibility.json) -> cùng số mẫu theo agent.
    const fx = JSON.parse(readFileSync(new URL("../../amber-brain/tests/fixtures/eligibility.json", import.meta.url), "utf8"));
    const fxIds: Record<string, string> = {};
    const logs = fx.rows.map((r: any) => {
      fxIds[r.key] = randomUUID();
      return { id: fxIds[r.key], createdAt: ago(r.daysAgo), agent: r.agent, userInput: r.userInput, outcome: r.outcome,
        outcomeAt: r.outcome === "unknown" ? null : ago(r.daysAgo), toolOk: r.toolOk, parsedOutput: r.parsedOutput ?? undefined,
        correctedOutput: r.correctedOutput ?? undefined, messages: r.hasMessages ? [{ role: "user", content: r.userInput }] : undefined };
    });
    r = await call(B, "POST", "/ingest", { logs });
    check("fixture: ingest đủ dòng", r.j.saved.length === fx.rows.length && r.j.invalid.length === 0, r.j);
    for (const row of fx.rows.filter((x: any) => x.exclude)) await call(B, "PATCH", `/${fxIds[row.key]}`, { excludeFromTraining: true });
    r = await call(B, "GET", "/stats");
    const got = Object.fromEntries(r.j.byAgent.map((x: any) => [x.agent, x.eligible]));
    check("fixture: số mẫu đủ điều kiện theo agent khớp bản Python (có bỏ trùng)", JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(fx.expectedEligible).sort()), { got, want: fx.expectedEligible });
    check("fixture: tổng eligible", r.j.eligible === Object.values(fx.expectedEligible).reduce((a: number, b: any) => a + b, 0), r.j.eligible);
  } finally {
    await db.delete(agentLogs).where(inArray(agentLogs.id, Object.values(ids)));
    await db.delete(users).where(eq(users.id, b.id));
  }
  console.log(fails ? `\n${fails} FAIL` : "\nTẤT CẢ PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error("LỖI", e?.message); process.exit(2); });
