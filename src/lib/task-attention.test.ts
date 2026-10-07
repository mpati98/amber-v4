// Test cờ cần chú ý của việc — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTENTION_IDLE_DAYS, diffDaysIso, taskAttention } from "./task-attention";

const TODAY = "2026-10-07";
// 12:00 giờ VN của ngày d = 05:00Z cùng ngày.
const at = (d: string) => `${d}T05:00:00.000Z`;

test("diffDaysIso", () => {
  assert.equal(diffDaysIso("2026-10-06", "2026-10-07"), 1);
  assert.equal(diffDaysIso("2026-09-30", "2026-10-07"), 7);
  assert.equal(diffDaysIso("2026-10-07", "2026-10-07"), 0);
});

test("DONE → null dù quá hạn hay nằm im", () => {
  assert.equal(taskAttention({ status: "DONE", dueDate: "2026-01-01", statusChangedAt: at("2026-01-01") }, TODAY), null);
});

test("quá hạn → OVERDUE với số ngày; hạn hôm nay chưa quá hạn", () => {
  assert.deepEqual(taskAttention({ status: "PREP", dueDate: "2026-10-06", statusChangedAt: at(TODAY) }, TODAY), { kind: "OVERDUE", days: 1 });
  assert.equal(taskAttention({ status: "PREP", dueDate: TODAY, statusChangedAt: at(TODAY) }, TODAY), null);
});

test("OVERDUE ưu tiên hơn IDLE", () => {
  assert.deepEqual(
    taskAttention({ status: "IN_PROGRESS", dueDate: "2026-10-01", statusChangedAt: at("2026-09-01") }, TODAY),
    { kind: "OVERDUE", days: 6 }
  );
});

test("IDLE: IN_PROGRESS/REVIEW đủ ngưỡng thì có, thiếu 1 ngày thì không", () => {
  assert.equal(ATTENTION_IDLE_DAYS, 5);
  assert.deepEqual(taskAttention({ status: "IN_PROGRESS", dueDate: null, statusChangedAt: at("2026-10-02") }, TODAY), { kind: "IDLE", days: 5 });
  assert.deepEqual(taskAttention({ status: "REVIEW", dueDate: null, statusChangedAt: at("2026-10-01") }, TODAY), { kind: "IDLE", days: 6 });
  assert.equal(taskAttention({ status: "IN_PROGRESS", dueDate: null, statusChangedAt: at("2026-10-03") }, TODAY), null);
});

test("PREP nằm im lâu không bị IDLE", () => {
  assert.equal(taskAttention({ status: "PREP", dueDate: null, statusChangedAt: at("2026-01-01") }, TODAY), null);
});

test("IDLE tính theo ngày lịch VN: 20:00Z ngày 10-01 là 03:00 ngày 10-02 giờ VN", () => {
  assert.deepEqual(
    taskAttention({ status: "IN_PROGRESS", dueDate: null, statusChangedAt: "2026-10-01T20:00:00.000Z" }, TODAY),
    { kind: "IDLE", days: 5 }
  );
});
