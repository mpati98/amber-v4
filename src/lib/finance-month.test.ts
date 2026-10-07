// Test tìm tháng tài chính theo ngày (ranh giới tháng giờ VN) — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMonthForDate, isInCurrentVnMonth, vnDateOf } from "./finance-month";

const months = [
  { id: "sep", startDate: "2026-09-01", endDate: "2026-09-30" },
  { id: "oct", startDate: "2026-10-01", endDate: "2026-10-31" },
];

test("tìm đúng tháng, kể cả ngày đầu và ngày cuối", () => {
  assert.equal(findMonthForDate(months, "2026-09-30")?.id, "sep");
  assert.equal(findMonthForDate(months, "2026-10-01")?.id, "oct");
  assert.equal(findMonthForDate(months, "2026-10-31")?.id, "oct");
});

test("không có tháng chứa ngày → null", () => {
  assert.equal(findMonthForDate(months, "2025-01-15"), null);
  assert.equal(findMonthForDate(months, "2026-11-01"), null);
});

test("bỏ qua tháng thiếu startDate/endDate", () => {
  assert.equal(findMonthForDate([{ id: "x", startDate: null, endDate: null }], "2026-10-05"), null);
});

test("ranh giới theo giờ VN: 17:00Z ngày 30/9 đã là 00:00 ngày 1/10 ở VN", () => {
  const at = new Date("2026-09-30T17:00:00Z");
  assert.equal(vnDateOf(at), "2026-10-01");
  assert.equal(findMonthForDate(months, vnDateOf(at))?.id, "oct");
  const before = new Date("2026-09-30T16:59:00Z");
  assert.equal(vnDateOf(before), "2026-09-30");
  assert.equal(findMonthForDate(months, vnDateOf(before))?.id, "sep");
});

test("isInCurrentVnMonth: cùng tháng VN thì đúng, khác tháng thì sai", () => {
  const now = new Date("2026-10-07T03:00:00Z");
  assert.equal(isInCurrentVnMonth(new Date("2026-09-30T17:30:00Z"), now), true); // 1/10 giờ VN
  assert.equal(isInCurrentVnMonth(new Date("2026-09-30T16:30:00Z"), now), false); // 30/9 giờ VN
  assert.equal(isInCurrentVnMonth(new Date("2025-01-15T00:00:00Z"), now), false);
});

test("năm nhuận: tháng 2/2028 kết thúc 29/2", () => {
  const feb = [{ id: "feb", startDate: "2028-02-01", endDate: "2028-02-29" }];
  assert.equal(findMonthForDate(feb, "2028-02-29")?.id, "feb");
  assert.equal(findMonthForDate(feb, "2028-03-01"), null);
});
