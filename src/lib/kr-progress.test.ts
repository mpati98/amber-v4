// Test hàm thuần tính tiến độ KR — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { krProgress } from "./kr-progress";

test("MANUAL: current / target", () => {
  assert.equal(krProgress({ mode: "MANUAL", current: 3, target: 5 }, 0, 0), 0.6);
});

test("MANUAL: bỏ qua số việc gắn vào", () => {
  assert.equal(krProgress({ mode: "MANUAL", current: 1, target: 4 }, 10, 10), 0.25);
});

test("MANUAL: target 0 thì 0 (không chia cho 0)", () => {
  assert.equal(krProgress({ mode: "MANUAL", current: 0, target: 0 }, 0, 0), 0);
});

test("MANUAL: đạt đủ target thì 1; vượt thì chặn ở 1", () => {
  assert.equal(krProgress({ mode: "MANUAL", current: 5, target: 5 }, 0, 0), 1);
  assert.equal(krProgress({ mode: "MANUAL", current: 9, target: 5 }, 0, 0), 1);
});

test("AUTO: linkedDone / linkedTotal", () => {
  assert.equal(krProgress({ mode: "AUTO", current: 0, target: 0 }, 4, 1), 0.25);
});

test("AUTO: không có việc nào thì 0", () => {
  assert.equal(krProgress({ mode: "AUTO", current: 0, target: 0 }, 0, 0), 0);
});

test("AUTO: bỏ qua current/target", () => {
  assert.equal(krProgress({ mode: "AUTO", current: 99, target: 1 }, 2, 2), 1);
});
