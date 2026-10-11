// Test phần thuần của nhật ký amber-brain — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeCursor, encodeCursor, feedbackSchema, ingestLogSchema, parseListQuery, patchSchema, shouldApplyOutcome, vnDayStart,
} from "./brain-logs";

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

test("feedback chỉ accepted/rejected; PATCH chỉ excludeFromTraining", () => {
  assert.ok(feedbackSchema.safeParse({ outcome: "accepted" }).success);
  assert.ok(feedbackSchema.safeParse({ outcome: "rejected" }).success);
  for (const bad of [{ outcome: "retried" }, { outcome: "accepted", x: 1 }, {}]) assert.equal(feedbackSchema.safeParse(bad).success, false);
  assert.ok(patchSchema.safeParse({ excludeFromTraining: true }).success);
  for (const bad of [{}, { excludeFromTraining: "yes" }, { excludeFromTraining: true, userInput: "x" }, { outcome: "accepted" }, { messages: [] }]) {
    assert.equal(patchSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});
