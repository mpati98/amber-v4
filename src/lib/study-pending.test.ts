// Test ngày còn thiếu lý do — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePendingReasonDates, dayNeedsReason, PENDING_REASON_LOOKBACK_DAYS } from "./study-pending";

const ALL = [1, 2, 3, 4, 5, 6, 7];
// 2026-10-14 là thứ Tư.
const base = { today: "2026-10-14", createdDate: "2026-01-01", weekdays: ALL, goalMinutes: 60, totals: new Map<string, number>(), reasonDates: new Set<string>() };

test("giới hạn 14 ngày: d từ today−14 đến today−1", () => {
  const r = computePendingReasonDates(base);
  assert.equal(PENDING_REASON_LOOKBACK_DAYS, 14);
  assert.equal(r.length, 14);
  assert.equal(r[0], "2026-09-30");
  assert.equal(r[13], "2026-10-13");
});

test("không tính hôm nay", () => {
  assert.ok(!computePendingReasonDates(base).includes("2026-10-14"));
});

test("cắt theo ngày tạo routine", () => {
  const r = computePendingReasonDates({ ...base, createdDate: "2026-10-11" });
  assert.deepEqual(r, ["2026-10-11", "2026-10-12", "2026-10-13"]);
});

test("routine tạo hôm nay → không có ngày nào", () => {
  assert.deepEqual(computePendingReasonDates({ ...base, createdDate: "2026-10-14" }), []);
});

test("bỏ ngày không đến hạn (chỉ T2/T4/T6)", () => {
  // 10-12 T2, 10-13 T3, 10-11 CN
  const r = computePendingReasonDates({ ...base, createdDate: "2026-10-09", weekdays: [1, 3, 5] });
  assert.deepEqual(r, ["2026-10-09", "2026-10-12"]); // 10-09 là T6
});

test("bỏ ngày đã đủ mục tiêu (≥ goal) và ngày đã có lý do", () => {
  const r = computePendingReasonDates({
    ...base,
    createdDate: "2026-10-10",
    totals: new Map([["2026-10-10", 60], ["2026-10-11", 59]]),
    reasonDates: new Set(["2026-10-12"]),
  });
  assert.deepEqual(r, ["2026-10-11", "2026-10-13"]);
});

test("goal null → rỗng", () => {
  assert.deepEqual(computePendingReasonDates({ ...base, goalMinutes: null }), []);
});

// ----- dayNeedsReason (dùng cho needsReason của lịch) -----
const need = { date: "2026-10-10", goalMinutes: 60 as number | null, minutes: 20, hasReason: false };

test("needsReason: thiếu phút, chưa có lý do → true", () => {
  assert.equal(dayNeedsReason(need), true);
});

test("needsReason: ngày trước khi tạo môn / routine → false", () => {
  assert.equal(dayNeedsReason({ ...need, notBefore: "2026-10-11" }), false);
  assert.equal(dayNeedsReason({ ...need, notBefore: "2026-10-10" }), true, "đúng ngày tạo thì tính");
});

test("needsReason: ngày không đến hạn của routine → false (2026-10-10 là thứ Bảy = 6)", () => {
  assert.equal(dayNeedsReason({ ...need, weekdays: [1, 2, 3, 4, 5] }), false);
  assert.equal(dayNeedsReason({ ...need, weekdays: [6, 7] }), true);
  assert.equal(dayNeedsReason({ ...need, weekdays: null }), true);
});

test("needsReason: đủ mục tiêu / đã có lý do / môn không mục tiêu → false", () => {
  assert.equal(dayNeedsReason({ ...need, minutes: 60 }), false);
  assert.equal(dayNeedsReason({ ...need, minutes: 90 }), false);
  assert.equal(dayNeedsReason({ ...need, hasReason: true }), false);
  assert.equal(dayNeedsReason({ ...need, goalMinutes: null }), false);
});

test("needsReason: ngày 20 ngày trước vẫn thiếu → true (không giới hạn 14 ngày), trong khi pendingReasonDates thì cắt ở 14", () => {
  const today = "2026-10-14";
  const old = "2026-09-24"; // 20 ngày trước
  assert.equal(dayNeedsReason({ ...need, date: old, notBefore: "2026-01-01" }), true);
  const pending = computePendingReasonDates({ today, createdDate: "2026-01-01", weekdays: [1, 2, 3, 4, 5, 6, 7], goalMinutes: 60, totals: new Map(), reasonDates: new Set() });
  assert.ok(!pending.includes(old));
  assert.equal(pending.length, PENDING_REASON_LOOKBACK_DAYS);
});
