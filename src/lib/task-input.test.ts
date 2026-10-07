// Test quy tắc chéo trường của việc — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { taskRuleError } from "./task-input";

test("dueDate < startDate → end_before_start", () => {
  assert.equal(taskRuleError({ startDate: "2026-10-10", dueDate: "2026-10-01", notifyDeadline: false }), "end_before_start");
});

test("dueDate = startDate hoặc thiếu một trong hai thì hợp lệ", () => {
  assert.equal(taskRuleError({ startDate: "2026-10-10", dueDate: "2026-10-10", notifyDeadline: false }), null);
  assert.equal(taskRuleError({ startDate: null, dueDate: "2026-10-10", notifyDeadline: false }), null);
  assert.equal(taskRuleError({ startDate: "2026-10-10", dueDate: null, notifyDeadline: false }), null);
});

test("bật thông báo mà không có dueDate → notify_requires_due_date", () => {
  assert.equal(taskRuleError({ startDate: null, dueDate: null, notifyDeadline: true }), "notify_requires_due_date");
  assert.equal(taskRuleError({ startDate: null, dueDate: "2026-10-10", notifyDeadline: true }), null);
});
