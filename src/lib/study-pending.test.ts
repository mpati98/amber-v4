// Test ngày còn thiếu lý do — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePendingReasonDates, PENDING_REASON_LOOKBACK_DAYS } from "./study-pending";

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
