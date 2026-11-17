// Test client ats-app với fetch giả (không gọi mạng) — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AtsError, fetchAtsTaskIds, fetchAtsTasks, parseTasksPage, readAtsConfig } from "./ats-client";

const CFG = { url: "https://ats.example/api/external/tasks", token: "tok" };
const T = (id: string) => ({
  id,
  title: `Việc ${id}`,
  status: "DOING",
  dueDate: "2026-11-20",
  doneAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-02T00:00:00.000Z",
  project: { id: "p", name: "P", type: "FAIR", archived: false },
});

function fakeFetch(pages: Record<string, unknown>, calls: { url: URL; init: RequestInit }[] = [], status = 200) {
  return async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push({ url, init });
    const key = url.searchParams.get("after") ?? "";
    return new Response(JSON.stringify(pages[key] ?? {}), { status });
  };
}

test("readAtsConfig: nêu tên biến thiếu, không nêu giá trị", () => {
  assert.throws(() => readAtsConfig({}), (e: unknown) => e instanceof AtsError && e.code === "missing_env" && /ATS_TASKS_URL, ATS_TASKS_TOKEN/.test(e.message));
  assert.throws(() => readAtsConfig({ ATS_TASKS_URL: "khong-phai-url", ATS_TASKS_TOKEN: "x" }), /ATS_TASKS_URL không phải URL/);
  assert.deepEqual(readAtsConfig({ ATS_TASKS_URL: " https://a.b/c ", ATS_TASKS_TOKEN: " t " }), { url: "https://a.b/c", token: "t" });
});

test("fetchAtsTasks: GET + Bearer, lặp theo nextCursor, serverTime của trang đầu", async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const pages = {
    "": { serverTime: "2026-11-17T01:00:00.000Z", tasks: [T("1"), T("2")], nextCursor: "c2" },
    c2: { serverTime: "2026-11-17T01:00:05.000Z", tasks: [T("3")], nextCursor: null },
  };
  const r = await fetchAtsTasks(CFG, { updatedSince: new Date("2026-11-16T00:00:00Z") }, fakeFetch(pages, calls));
  assert.deepEqual(r.tasks.map((t) => t.id), ["1", "2", "3"]);
  assert.equal(r.serverTime, "2026-11-17T01:00:00.000Z");
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.init.method, "GET");
    assert.equal((c.init.headers as Record<string, string>).Authorization, "Bearer tok");
    assert.equal(c.url.searchParams.get("updatedSince"), "2026-11-16T00:00:00.000Z");
    assert.equal(c.url.searchParams.get("limit"), "1000");
  }
  assert.equal(calls[1].url.searchParams.get("after"), "c2");
});

test("fetchAtsTasks: không có updatedSince thì không gửi tham số", async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  await fetchAtsTasks(CFG, {}, fakeFetch({ "": { serverTime: "2026-11-17T01:00:00Z", tasks: [] } }, calls));
  assert.equal(calls[0].url.searchParams.has("updatedSince"), false);
});

test("fetchAtsTaskIds: idsOnly=1, id số được đổi sang chuỗi", async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const r = await fetchAtsTaskIds(CFG, fakeFetch({ "": { serverTime: "2026-11-17T01:00:00Z", ids: ["a", 7] } }, calls));
  assert.deepEqual(r.ids, ["a", "7"]);
  assert.equal(calls[0].url.searchParams.get("idsOnly"), "1");
});

test("lỗi: 401 → unauthorized, 500 → http_error, sai dạng → bad_payload, con trỏ lặp → bad_payload", async () => {
  const ok = { "": { serverTime: "2026-11-17T01:00:00Z", tasks: [] } };
  await assert.rejects(fetchAtsTasks(CFG, {}, fakeFetch(ok, [], 401)), (e: unknown) => e instanceof AtsError && e.code === "unauthorized");
  await assert.rejects(fetchAtsTasks(CFG, {}, fakeFetch(ok, [], 500)), (e: unknown) => e instanceof AtsError && e.code === "http_error");
  const bad = { "": { serverTime: "2026-11-17T01:00:00Z", tasks: [{ ...T("1"), status: "LẠ" }] } };
  await assert.rejects(fetchAtsTasks(CFG, {}, fakeFetch(bad)), (e: unknown) => e instanceof AtsError && e.code === "bad_payload" && /tasks\.0\.status/.test(e.message));
  const loop = { "": { serverTime: "2026-11-17T01:00:00Z", tasks: [], nextCursor: "x" }, x: { serverTime: "2026-11-17T01:00:00Z", tasks: [], nextCursor: "x" } };
  await assert.rejects(fetchAtsTasks(CFG, {}, fakeFetch(loop)), /con trỏ lặp lại/);
});

test("lỗi mạng / timeout", async () => {
  const net = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(fetchAtsTasks(CFG, {}, net), (e: unknown) => e instanceof AtsError && e.code === "network");
  const slow = async () => {
    throw Object.assign(new Error("t"), { name: "TimeoutError" });
  };
  await assert.rejects(fetchAtsTasks(CFG, {}, slow), (e: unknown) => e instanceof AtsError && e.code === "timeout");
});

test("parseTasksPage: dueDate phải YYYY-MM-DD, project được phép null", () => {
  assert.throws(() => parseTasksPage({ serverTime: "2026-11-17T01:00:00Z", tasks: [{ ...T("1"), dueDate: "17/11/2026" }] }), /dueDate/);
  const p = parseTasksPage({ serverTime: "2026-11-17T01:00:00Z", tasks: [{ ...T("1"), project: null }], nextCursor: null });
  assert.equal(p.tasks[0].project, null);
});
