// Test quy tắc số liệu KR — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveKrNumbers } from "./key-result-input";

test("AUTO: bỏ qua target/current gửi lên, lưu 0", () => {
  assert.deepEqual(resolveKrNumbers("AUTO", { target: 9, current: 4 }), { ok: true, target: 0, current: 0 });
});

test("MANUAL tạo mới: target bắt buộc ≥ 1", () => {
  assert.equal(resolveKrNumbers("MANUAL", {}).ok, false);
  assert.equal(resolveKrNumbers("MANUAL", { target: 0 }).ok, false);
  assert.deepEqual(resolveKrNumbers("MANUAL", { target: 5 }), { ok: true, target: 5, current: 0 });
});

test("MANUAL: current vượt target hoặc âm thì lỗi", () => {
  assert.equal(resolveKrNumbers("MANUAL", { target: 5, current: 6 }).ok, false);
  assert.equal(resolveKrNumbers("MANUAL", { target: 5, current: -1 }).ok, false);
  assert.equal(resolveKrNumbers("MANUAL", { target: 5, current: 5 }).ok, true);
});

test("MANUAL sửa: chỉ gửi current, kiểm tra theo target hiện có", () => {
  const existing = { target: 5, current: 0 };
  assert.deepEqual(resolveKrNumbers("MANUAL", { current: 3 }, existing), { ok: true, target: 5, current: 3 });
  assert.equal(resolveKrNumbers("MANUAL", { current: 9 }, existing).ok, false);
});

test("MANUAL sửa: hạ target dưới current thì current về bằng target", () => {
  assert.deepEqual(resolveKrNumbers("MANUAL", { target: 2 }, { target: 5, current: 3 }), { ok: true, target: 2, current: 2 });
});

test("MANUAL sửa: hạ target nhưng gửi current vượt target mới thì lỗi", () => {
  assert.equal(resolveKrNumbers("MANUAL", { target: 2, current: 3 }, { target: 5, current: 3 }).ok, false);
});

test("Đổi AUTO → MANUAL mà không gửi target thì lỗi", () => {
  assert.equal(resolveKrNumbers("MANUAL", {}, { target: 0, current: 0 }).ok, false);
});
