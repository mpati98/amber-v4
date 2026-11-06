// Test helper lịch VN cho thẻ từ vựng — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstReviewDayOf, monthBoundsOfIso, nextReviewDay, quarterBoundsOfIso, vnDayStart, vnQuarterBounds } from "./vn-time";

// 2026-11-01 là Chủ nhật, 2026-11-06 là thứ Sáu.
test("vnQuarterBounds: bốn quý và cuối năm", () => {
  assert.deepEqual(quarterBoundsOfIso("2026-01-01"), { year: 2026, quarter: 1, start: "2026-01-01", end: "2026-03-31" });
  assert.deepEqual(quarterBoundsOfIso("2026-05-15"), { year: 2026, quarter: 2, start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(quarterBoundsOfIso("2026-09-30"), { year: 2026, quarter: 3, start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(quarterBoundsOfIso("2026-12-31"), { year: 2026, quarter: 4, start: "2026-10-01", end: "2026-12-31" });
});

test("vnQuarterBounds: 17:30Z ngày 31/12 đã là 01/01 giờ VN → quý 1 năm sau", () => {
  assert.deepEqual(vnQuarterBounds(new Date("2026-12-31T17:30:00Z")), { year: 2027, quarter: 1, start: "2027-01-01", end: "2027-03-31" });
  assert.equal(vnQuarterBounds(new Date("2026-12-31T16:30:00Z")).quarter, 4);
});

test("monthBoundsOfIso: tháng 2 năm nhuận và không nhuận", () => {
  assert.equal(monthBoundsOfIso("2028-02-10").end, "2028-02-29");
  assert.equal(monthBoundsOfIso("2027-02-10").end, "2027-02-28");
});

test("vnDayStart: 00:00 giờ VN = 17:00Z hôm trước", () => {
  assert.equal(vnDayStart("2026-11-07").toISOString(), "2026-11-06T17:00:00.000Z");
});

test("firstReviewDayOf: Chủ nhật đầu tháng", () => {
  assert.equal(firstReviewDayOf("2026-12-01", "2026-12-31"), "2026-12-06");
  assert.equal(firstReviewDayOf("2026-11-01", "2026-11-30"), "2026-11-01"); // chính ngày đầu kỳ cũng được tính
});

test("firstReviewDayOf: hai thứ ôn (thứ Tư, thứ Bảy) và kỳ không có ngày nào", () => {
  assert.equal(firstReviewDayOf("2026-12-01", "2026-12-31", [3, 6]), "2026-12-02");
  assert.equal(firstReviewDayOf("2026-11-02", "2026-11-04", [7]), null);
});

test("firstReviewDayOf / nextReviewDay: danh sách rỗng hoặc sai dùng Chủ nhật", () => {
  assert.equal(firstReviewDayOf("2026-12-01", "2026-12-31", []), "2026-12-06");
  assert.equal(nextReviewDay("2026-11-06", [0, 9]), "2026-11-08");
});

test("nextReviewDay: thứ Sáu → Chủ nhật; Chủ nhật → Chủ nhật tuần sau (nghiêm ngặt sau ngày đó)", () => {
  assert.equal(nextReviewDay("2026-11-06"), "2026-11-08");
  assert.equal(nextReviewDay("2026-11-08"), "2026-11-15");
});

test("nextReviewDay: hai thứ ôn và qua ranh giới tháng, năm", () => {
  assert.equal(nextReviewDay("2026-11-07", [3, 6]), "2026-11-11");
  assert.equal(nextReviewDay("2026-12-31", [7]), "2027-01-03");
});
