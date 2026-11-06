// Test lịch ôn thẻ theo giai đoạn (mọi ngày theo giờ VN) — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextFor, scheduleCard, type CardRating, type CardStage } from "./study-card-schedule";
import { vnToday } from "./vn-time";

// Giờ VN (UTC+7) viết thẳng bằng offset để test không phụ thuộc múi giờ máy.
const vn = (s: string) => new Date(`${s}+07:00`);
const run = (stage: CardStage, rating: CardRating, now: string, extra: { reviewWeekdays?: number[]; isExtra?: boolean; dueAt?: Date | null } = {}) =>
  scheduleCard({ stage, dueAt: extra.dueAt ?? null, rating, now: vn(now), reviewWeekdays: extra.reviewWeekdays, isExtra: extra.isExtra });
const dueDay = (d: Date | null) => (d ? vnToday(d) : null);
const atMidnight = (d: Date | null, day: string) => d !== null && d.getTime() === vn(`${day}T00:00:00`).getTime();

// 2026-11-06 là thứ Sáu; 2026-11-08, 2026-12-06, 2027-01-03, 2027-04-04 đều là Chủ nhật.
test("thứ Sáu 06/11 LEARNING + Đã nhớ → WEEKLY, hạn Chủ nhật 08/11", () => {
  const r = run("LEARNING", "REMEMBERED", "2026-11-06T10:00:00");
  assert.equal(r.stage, "WEEKLY");
  assert.ok(atMidnight(r.dueAt, "2026-11-08"));
});

test("Chủ nhật 08/11 WEEKLY + Đã nhớ → MONTHLY, hạn Chủ nhật 06/12", () => {
  const r = run("WEEKLY", "REMEMBERED", "2026-11-08T09:00:00");
  assert.equal(r.stage, "MONTHLY");
  assert.ok(atMidnight(r.dueAt, "2026-12-06"));
});

test("Chủ nhật 06/12 MONTHLY + Đã nhớ → QUARTERLY, hạn Chủ nhật 03/01/2027", () => {
  const r = run("MONTHLY", "REMEMBERED", "2026-12-06T09:00:00");
  assert.equal(r.stage, "QUARTERLY");
  assert.ok(atMidnight(r.dueAt, "2027-01-03"));
});

test("Chủ nhật 03/01/2027 QUARTERLY + Đã nhớ → QUARTERLY, hạn Chủ nhật 04/04/2027", () => {
  const r = run("QUARTERLY", "REMEMBERED", "2027-01-03T09:00:00");
  assert.equal(r.stage, "QUARTERLY");
  assert.ok(atMidnight(r.dueAt, "2027-04-04"));
});

test("hôm nay là Chủ nhật, LEARNING + Đã nhớ → hạn Chủ nhật tuần sau", () => {
  const r = run("LEARNING", "REMEMBERED", "2026-11-08T08:00:00");
  assert.equal(r.stage, "WEEKLY");
  assert.ok(atMidnight(r.dueAt, "2026-11-15"));
});

test("NEW + Đã nhớ đi như LEARNING", () => {
  const r = run("NEW", "REMEMBERED", "2026-11-06T10:00:00");
  assert.equal(r.stage, "WEEKLY");
  assert.ok(atMidnight(r.dueAt, "2026-11-08"));
});

test("Chưa nhớ từ mọi giai đoạn → LEARNING, hạn +5 phút", () => {
  for (const stage of ["NEW", "LEARNING", "WEEKLY", "MONTHLY", "QUARTERLY"] as const) {
    const now = vn("2026-11-06T10:00:00");
    const r = scheduleCard({ stage, dueAt: null, rating: "NOT_YET", now });
    assert.equal(r.stage, "LEARNING");
    assert.equal(r.dueAt!.getTime(), now.getTime() + 5 * 60_000);
  }
});

test("Cần ôn lại → LEARNING, hạn đầu ngày mai giờ VN", () => {
  const r = run("QUARTERLY", "REVIEW_AGAIN", "2026-11-06T10:00:00");
  assert.equal(r.stage, "LEARNING");
  assert.ok(atMidnight(r.dueAt, "2026-11-07"));
});

test("Cần ôn lại ở 23:59 giờ VN (16:59Z): ngày mai là 07/11, không phải 06/11", () => {
  const r = scheduleCard({ stage: "WEEKLY", dueAt: null, rating: "REVIEW_AGAIN", now: new Date("2026-11-06T16:59:00Z") });
  assert.equal(r.dueAt!.toISOString(), "2026-11-06T17:00:00.000Z");
});

test("Cần ôn lại lúc 00:00 giờ VN (17:00Z) đã sang ngày 07/11 → hạn 08/11", () => {
  const r = scheduleCard({ stage: "WEEKLY", dueAt: null, rating: "REVIEW_AGAIN", now: new Date("2026-11-06T17:00:00Z") });
  assert.equal(r.dueAt!.toISOString(), "2026-11-07T17:00:00.000Z");
});

test("00:30 Chủ nhật giờ VN (17:30Z thứ Bảy) vẫn là Chủ nhật → hạn Chủ nhật sau, không phải hôm nay", () => {
  const r = scheduleCard({ stage: "LEARNING", dueAt: null, rating: "REMEMBERED", now: new Date("2026-11-07T17:30:00Z") });
  assert.ok(atMidnight(r.dueAt, "2026-11-15"));
});

test("00:30 mùng 1/1 giờ VN (17:30Z 31/12): MONTHLY thuộc quý 1 → hạn quý 2, Chủ nhật 04/04/2027", () => {
  const r = scheduleCard({ stage: "MONTHLY", dueAt: null, rating: "REMEMBERED", now: new Date("2026-12-31T17:30:00Z") });
  assert.ok(atMidnight(r.dueAt, "2027-04-04"));
});

test("00:30 ngày 1/12 giờ VN (17:30Z 30/11): WEEKLY → tháng sau là tháng 1/2027 → Chủ nhật 03/01", () => {
  const r = scheduleCard({ stage: "WEEKLY", dueAt: null, rating: "REMEMBERED", now: new Date("2026-11-30T17:30:00Z") });
  assert.ok(atMidnight(r.dueAt, "2027-01-03"));
});

test("ranh giới tháng và năm: WEEKLY ngày 15/12 → Chủ nhật đầu tháng 1/2027", () => {
  assert.ok(atMidnight(run("WEEKLY", "REMEMBERED", "2026-12-15T12:00:00").dueAt, "2027-01-03"));
});

test("ranh giới quý: MONTHLY ngày 30/09 → Chủ nhật đầu quý 4 (04/10)", () => {
  assert.ok(atMidnight(run("MONTHLY", "REMEMBERED", "2026-09-30T12:00:00").dueAt, "2026-10-04"));
});

test("hai thứ ôn (thứ Tư, thứ Bảy): LEARNING thứ Sáu → thứ Bảy 07/11; thứ Bảy → thứ Tư 11/11", () => {
  assert.ok(atMidnight(run("LEARNING", "REMEMBERED", "2026-11-06T10:00:00", { reviewWeekdays: [3, 6] }).dueAt, "2026-11-07"));
  assert.ok(atMidnight(run("LEARNING", "REMEMBERED", "2026-11-07T10:00:00", { reviewWeekdays: [3, 6] }).dueAt, "2026-11-11"));
});

test("hai thứ ôn: WEEKLY → thứ Tư đầu tháng 12 (02/12); MONTHLY → thứ Bảy đầu quý 1/2027 (02/01)", () => {
  assert.ok(atMidnight(run("WEEKLY", "REMEMBERED", "2026-11-06T10:00:00", { reviewWeekdays: [3, 6] }).dueAt, "2026-12-02"));
  assert.ok(atMidnight(run("MONTHLY", "REMEMBERED", "2026-11-06T10:00:00", { reviewWeekdays: [3, 6] }).dueAt, "2027-01-02"));
});

test("ôn thêm + Đã nhớ: giữ nguyên giai đoạn và hạn", () => {
  const due = vn("2026-12-06T00:00:00");
  const r = run("MONTHLY", "REMEMBERED", "2026-11-06T10:00:00", { isExtra: true, dueAt: due });
  assert.equal(r.stage, "MONTHLY");
  assert.equal(r.dueAt!.getTime(), due.getTime());
});

test("ôn thêm + Chưa nhớ / Cần ôn lại vẫn áp dụng như thường", () => {
  const due = vn("2026-12-06T00:00:00");
  const a = run("MONTHLY", "NOT_YET", "2026-11-06T10:00:00", { isExtra: true, dueAt: due });
  assert.equal(a.stage, "LEARNING");
  assert.equal(a.dueAt!.getTime(), vn("2026-11-06T10:05:00").getTime());
  const b = run("MONTHLY", "REVIEW_AGAIN", "2026-11-06T10:00:00", { isExtra: true, dueAt: due });
  assert.equal(b.stage, "LEARNING");
  assert.ok(atMidnight(b.dueAt, "2026-11-07"));
});

test("dueAt chỉ null khi giữ nguyên NEW; mọi kết quả đổi giai đoạn đều có hạn", () => {
  for (const stage of ["NEW", "LEARNING", "WEEKLY", "MONTHLY", "QUARTERLY"] as const) {
    for (const rating of ["NOT_YET", "REVIEW_AGAIN", "REMEMBERED"] as const) {
      assert.notEqual(run(stage, rating, "2026-11-06T10:00:00").dueAt, null);
    }
  }
});

test("nextFor: đủ 3 mức cho nhãn nút", () => {
  const n = nextFor({ stage: "LEARNING", dueAt: null }, vn("2026-11-06T10:00:00"));
  assert.equal(n.NOT_YET.stage, "LEARNING");
  assert.equal(n.NOT_YET.dueAt!.getTime(), vn("2026-11-06T10:05:00").getTime());
  assert.ok(atMidnight(n.REVIEW_AGAIN.dueAt, "2026-11-07"));
  assert.equal(n.REMEMBERED.stage, "WEEKLY");
  assert.equal(dueDay(n.REMEMBERED.dueAt), "2026-11-08");
});

test("nextFor với thẻ ôn thêm: Đã nhớ giữ hạn hiện tại", () => {
  const due = vn("2027-01-03T00:00:00");
  const n = nextFor({ stage: "QUARTERLY", dueAt: due }, vn("2026-11-06T10:00:00"), undefined, true);
  assert.equal(n.REMEMBERED.stage, "QUARTERLY");
  assert.equal(n.REMEMBERED.dueAt!.getTime(), due.getTime());
});
