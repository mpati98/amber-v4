// Test phần thuần của nhật ký amber-brain — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correctedActionSchema, decodeCursor, encodeCursor, exportQuerySchema, feedbackSchema, ingestLogSchema, parseExportQuery,
  parseListQuery, patchSchema, ROUTES, shouldApplyOutcome, vnDayStart,
} from "./brain-logs";
import { fullColumns, summaryColumns } from "./brain-logs-db";

const ID = "11111111-1111-4111-8111-111111111111";

test("outcome: bản mới hơn thắng, brain không có mốc thì không đè", () => {
  const t1 = new Date("2026-10-10T00:00:00Z"), t2 = new Date("2026-10-11T00:00:00Z");
  assert.equal(shouldApplyOutcome(null, t1), true);
  assert.equal(shouldApplyOutcome(t1, t2), true);
  assert.equal(shouldApplyOutcome(t2, t1), false);
  assert.equal(shouldApplyOutcome(t1, t1), false);
  assert.equal(shouldApplyOutcome(t1, null), false);
  assert.equal(shouldApplyOutcome(null, null), false);
});

test("con trỏ phân trang: vòng đi vòng về, rác thì null", () => {
  const d = new Date("2026-10-10T12:34:56.789Z");
  assert.deepEqual(decodeCursor(encodeCursor(d, ID)), { createdAt: d, id: ID });
  for (const bad of ["", "abc", Buffer.from("x|y").toString("base64url"), Buffer.from(`nope|${ID}`).toString("base64url")]) {
    assert.equal(decodeCursor(bad), null, bad);
  }
});

test("danh sách: mặc định, giới hạn, lọc ngày theo giờ VN", () => {
  const ok = parseListQuery(new URLSearchParams("agent=expense&outcome=corrected&from=2026-10-01&to=2026-10-02&limit=10"));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.limit, 10);
    assert.equal(ok.value.from?.toISOString(), "2026-09-30T17:00:00.000Z"); // 0h ngày 1/10 giờ VN
    assert.equal(ok.value.toExclusive?.toISOString(), "2026-10-02T17:00:00.000Z"); // hết ngày 2/10 giờ VN
  }
  const def = parseListQuery(new URLSearchParams(""));
  assert.ok(def.ok && def.value.limit === 50);
  for (const q of ["limit=0", "limit=201", "limit=x", "outcome=great", "from=10/10", "cursor=@@@"]) {
    assert.equal(parseListQuery(new URLSearchParams(q)).ok, false, q);
  }
  assert.equal(vnDayStart("2026-10-10").toISOString(), "2026-10-09T17:00:00.000Z");
});

test("ingest: nhận dòng hợp lệ, bỏ trường lạ (userId, excludeFromTraining), từ chối id/ngày sai", () => {
  const ok = ingestLogSchema.safeParse({ id: ID, createdAt: "2026-10-10T10:00:00+00:00", agent: "expense", userInput: "chi 45k",
    userId: "x", excludeFromTraining: true, messages: [{ role: "user", content: "hi" }], parsedOutput: "text" });
  assert.ok(ok.success);
  if (ok.success) {
    assert.equal("userId" in ok.data, false);
    assert.equal("excludeFromTraining" in ok.data, false);
    assert.equal(ok.data.outcome, "unknown");
    assert.equal(ok.data.source, "agent");
  }
  assert.equal(ingestLogSchema.safeParse({ id: "nope", createdAt: "2026-10-10T10:00:00Z", agent: "a" }).success, false);
  assert.equal(ingestLogSchema.safeParse({ id: ID, createdAt: "không phải ngày", agent: "a" }).success, false);
  assert.equal(ingestLogSchema.safeParse({ id: ID, createdAt: "2026-10-10T10:00:00Z", agent: "a", outcome: "great" }).success, false);
});

test("feedback chỉ accepted/rejected; PATCH nhận excludeFromTraining hoặc correctedOutput", () => {
  assert.ok(feedbackSchema.safeParse({ outcome: "accepted" }).success);
  assert.ok(feedbackSchema.safeParse({ outcome: "rejected" }).success);
  for (const bad of [{ outcome: "retried" }, { outcome: "accepted", x: 1 }, {}]) assert.equal(feedbackSchema.safeParse(bad).success, false);
  assert.ok(patchSchema.safeParse({ excludeFromTraining: true }).success);
  assert.ok(patchSchema.safeParse({ correctedOutput: null }).success);
  assert.ok(patchSchema.safeParse({ correctedOutput: { action: "chitchat", reply: "Hi." } }).success);
  for (const bad of [{}, { excludeFromTraining: "yes" }, { excludeFromTraining: true, userInput: "x" }, { outcome: "accepted" }, { messages: [] }]) {
    assert.equal(patchSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("corrected action schema accepts every Gemma action with its required fields", () => {
  const actions = [
    { action: "task_add", system: "work", title: "Call Linh", deadline_text: null },
    { action: "task_list", system: null, range_text: "today" },
    { action: "task_complete", title: "Call Linh" },
    { action: "expense_add", type: "expense", amount_text: "45k", category: "Food", note: "lunch", date_text: null },
    { action: "expense_query", type: "income", category: null, range_text: "this month" },
    { action: "tutor", mode: "correct", text: "I goed home" },
    { action: "news", topic: null, range_text: null },
    { action: "clarify", intent: "expense_add", missing: ["amount", "category"], reply: "What was it?" },
    { action: "chitchat", reply: "Hello!" },
  ];
  for (const action of actions) {
    assert.ok(correctedActionSchema.safeParse(action).success, JSON.stringify(action));
  }
});

test("corrected action schema rejects missing required fields, unknown actions and extra keys", () => {
  for (const bad of [
    { action: "expense_add", type: "expense", category: "Food", note: "", date_text: null },
    { action: "expense_query", type: "expense", category: null },
    { action: "tutor", mode: "sing", text: "x" },
    { action: "unknown", reply: "x" },
    { action: "chitchat", reply: "hi", route: "CLOUD" },
  ]) {
    assert.equal(correctedActionSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("export route filter accepts only LOCAL or CLOUD", () => {
  assert.deepEqual(parseExportQuery(new URLSearchParams("")), { ok: true, value: {} });
  assert.deepEqual(parseExportQuery(new URLSearchParams("route=")), { ok: true, value: {} });
  for (const route of ROUTES) {
    assert.deepEqual(parseExportQuery(new URLSearchParams(`route=${route}`)), { ok: true, value: { route } });
  }
  for (const route of ["cloud", "EDGE", "LOCAL,CLOUD", "null"]) {
    assert.deepEqual(parseExportQuery(new URLSearchParams(`route=${route}`)), { ok: false, error: "invalid_query" });
  }
  assert.ok(exportQuerySchema.safeParse({ route: "CLOUD" }).success);
});

// --- route / cloudModel (migration 0009) -----------------------------------------------------------------------

const BASE = { id: ID, createdAt: "2026-10-10T10:00:00+00:00", agent: "chat", userInput: "hi" };

test("ingest: dòng KHÔNG có route/cloudModel (brain đang chạy production) vẫn nhận y như trước", () => {
  // đúng hình dạng brain đẩy hôm nay: mọi cột đều có mặt, giá trị thiếu là null, không có route/cloudModel
  const live = { ...BASE, sessionId: null, turnIndex: 1, source: "agent", lang: "en", modelName: "amber-gemma4", adapterVersion: "base",
    promptVersion: "gemma-v1", retrievedContext: null, messages: [{ role: "user", content: "hi" }], tools: null, rawOutput: "{}",
    parsedOutput: { action: "chitchat" }, parseOk: true, toolName: null, toolArgs: null, toolResult: { route: "CLOUD" }, toolOk: null,
    error: null, entityType: null, entityId: null, latencyMs: 12, promptTokens: 5, completionTokens: 3, outcome: "unknown",
    outcomeAt: null, correctedOutput: null, correctedAt: null };
  const r = ingestLogSchema.safeParse(live);
  assert.ok(r.success);
  if (r.success) {
    assert.equal(r.data.route, undefined);      // thiếu = không đổi gì ở DB (update bỏ qua undefined, insert để null)
    assert.equal(r.data.cloudModel, undefined);
    assert.deepEqual(r.data.toolResult, { route: "CLOUD" }); // route cũ nằm trong toolResult vẫn là JSON thường
  }
  assert.ok(ingestLogSchema.safeParse(BASE).success);
});

test("ingest: nhận route LOCAL|CLOUD và cloudModel; null cũng được", () => {
  for (const route of ROUTES) {
    const r = ingestLogSchema.safeParse({ ...BASE, route, cloudModel: route === "CLOUD" ? "openai/gpt-oss-120b" : null });
    assert.ok(r.success, route);
    if (r.success) assert.equal(r.data.route, route);
  }
  const n = ingestLogSchema.safeParse({ ...BASE, route: null, cloudModel: null });
  assert.ok(n.success && n.data.route === null && n.data.cloudModel === null);
});

test("ingest: route sai giá trị bị ép về null, dòng VẪN được nhận (không invalid, không 400)", () => {
  for (const route of ["cloud", "local", "EDGE", "", "LOCAL ", 1, true, ["CLOUD"], { r: "CLOUD" }]) {
    const r = ingestLogSchema.safeParse({ ...BASE, userInput: "giữ lại", route, cloudModel: "m" });
    assert.ok(r.success, JSON.stringify(route));
    if (r.success) {
      assert.equal(r.data.route, null, JSON.stringify(route));
      assert.equal(r.data.userInput, "giữ lại"); // phần còn lại của dòng không bị ảnh hưởng
      assert.equal(r.data.cloudModel, "m");
    }
  }
  // route hợp lệ / null / thiếu không bị đổi bởi catch
  assert.equal(ingestLogSchema.parse({ ...BASE, route: "CLOUD" }).route, "CLOUD");
  assert.equal(ingestLogSchema.parse({ ...BASE, route: "LOCAL" }).route, "LOCAL");
  assert.equal(ingestLogSchema.parse({ ...BASE, route: null }).route, null);
  assert.equal(ingestLogSchema.parse(BASE).route, undefined);
  // cloudModel không nằm trong quy tắc ép: sai kiểu / quá dài vẫn làm hỏng dòng đó (chỉ dòng đó)
  assert.equal(ingestLogSchema.safeParse({ ...BASE, route: "CLOUD", cloudModel: "x".repeat(257) }).success, false);
  assert.equal(ingestLogSchema.safeParse({ ...BASE, route: "CLOUD", cloudModel: 5 }).success, false);
});

test("ingest: trường lạ không gây lỗi — bị bỏ lặng lẽ, kể cả khi trông giống trường mới", () => {
  const r = ingestLogSchema.safeParse({ ...BASE, route: "CLOUD", serverHost: "api.duangmai.io.vn", server_host: "x", futureField: { a: 1 },
    routes: "LOCAL", cloud_model: "snake-case-is-not-camel" });
  assert.ok(r.success);
  if (r.success) {
    for (const k of ["serverHost", "server_host", "futureField", "routes", "cloud_model"]) assert.equal(k in r.data, false, k);
    assert.equal(r.data.route, "CLOUD");
    assert.equal(r.data.cloudModel, undefined); // snake_case không được tự map
  }
});

test("danh sách: ?route= chỉ nhận LOCAL|CLOUD (đúng chữ hoa), không có thì không lọc", () => {
  for (const route of ROUTES) {
    const q = parseListQuery(new URLSearchParams(`route=${route}&agent=chat`));
    assert.ok(q.ok && q.value.route === route && q.value.agent === "chat", route);
  }
  const none = parseListQuery(new URLSearchParams("agent=chat"));
  assert.ok(none.ok && none.value.route === undefined);
  const blank = parseListQuery(new URLSearchParams("route="));
  assert.ok(blank.ok && blank.value.route === undefined); // giá trị rỗng bị bỏ như các bộ lọc khác
  for (const bad of ["route=cloud", "route=local", "route=EDGE", "route=CLOUD,LOCAL", "route=null"]) {
    assert.equal(parseListQuery(new URLSearchParams(bad)).ok, false, bad);
  }
});

test("cột trả ra: danh sách tóm tắt, chi tiết và export đều có route + cloudModel; userId vẫn không lộ", () => {
  for (const cols of [summaryColumns, fullColumns]) {
    assert.ok("route" in cols && "cloudModel" in cols);
    assert.equal("userId" in cols, false);
  }
});
