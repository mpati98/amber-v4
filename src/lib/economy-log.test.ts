// Test nhật ký luật cho màn chủ — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogLines, parseEventRef } from "./economy-log";

const T = "11111111-2222-3333-4444-555555555555";

test("gộp Nguyên Tệ + Thể lực theo (sự kiện, luật), giữ thứ tự mới trước, có tên", () => {
  const lines = buildLogLines(
    [
      { eventId: `study-log:${T}`, ruleId: "study", key: "stamina", amount: -3, occurredAt: "2026-11-15T03:00:00.000Z" },
      { eventId: `study-log:${T}`, ruleId: "study", key: "nguyen_te", amount: 10, occurredAt: "2026-11-15T03:00:00.000Z" },
      { eventId: `amber-task:${T}:done`, ruleId: "task_late_waived", key: "stamina", amount: -12, occurredAt: "2026-11-15T02:00:00.000Z" },
    ],
    new Map([[`study-log:${T}`, "Tiếng Anh"]]),
  );
  assert.deepEqual(lines.map((l) => [l.text, l.nguyenTe, l.stamina]), [
    ["Học: Tiếng Anh", 10, -3],
    ["Xong việc trễ hạn (được miễn phạt)", 0, -12],
  ]);
});

test("giới hạn số dòng; luật lạ hiện id", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ eventId: `x:${i}`, ruleId: "custom_rule", key: "nguyen_te", amount: 1, occurredAt: "2026-11-15T00:00:00.000Z" }));
  const lines = buildLogLines(many, new Map(), 3);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, "custom_rule");
});

test("parseEventRef", () => {
  assert.deepEqual(parseEventRef(`amber-task:${T}:done`), { kind: "task", id: T });
  assert.deepEqual(parseEventRef(`amber-task-occ:${T}:2026-11-15:done`), { kind: "task", id: T });
  assert.deepEqual(parseEventRef(`study-log:${T}`), { kind: "study", id: T });
  assert.deepEqual(parseEventRef(`routine-log:${T}`), { kind: "routine", id: T });
  assert.deepEqual(parseEventRef("redeem:abc"), { kind: null, id: null });
});
