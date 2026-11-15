// Test công thức chỉ số màn chủ 3D — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityEvent, heThong, kyNang, nganKho, sinhLuc, sleepScore, triThuc, workoutScore } from "./world-stats";

test("sleepScore: 7–9 giờ = 100, 3 giờ = 0, ngủ quá nhiều trừ nhẹ, chất lượng nhân hệ số", () => {
  assert.equal(sleepScore(8 * 60), 100);
  assert.equal(sleepScore(7 * 60), 100);
  assert.equal(sleepScore(5 * 60), 50);
  assert.equal(sleepScore(3 * 60), 0);
  assert.equal(sleepScore(2 * 60), 0);
  assert.equal(sleepScore(12 * 60), 70);
  assert.equal(sleepScore(8 * 60, 5), 100);
  assert.equal(sleepScore(8 * 60, 1), 60);
});

test("workoutScore: 150 phút/tuần = 100, không vượt 100", () => {
  assert.equal(workoutScore(0), 0);
  assert.equal(workoutScore(75), 50);
  assert.equal(workoutScore(400), 100);
});

test("sinhLuc: chưa ghi giấc ngủ 3 ngày → dùng đêm mẫu, đánh dấu sample", () => {
  const s = sinhLuc({ lastSleep: null, today: "2026-11-15", workoutMinutes7d: 150 });
  assert.equal(s.sample, true);
  assert.equal(s.v, Math.round(0.6 * 80 + 0.4 * 100)); // 7 giờ, chất lượng 3 → 80
  const old = sinhLuc({ lastSleep: { date: "2026-11-12", minutes: 480, quality: null }, today: "2026-11-15", workoutMinutes7d: 0 });
  assert.equal(old.sample, true);
});

test("sinhLuc: có giấc ngủ đêm qua → dùng thật", () => {
  const s = sinhLuc({ lastSleep: { date: "2026-11-15", minutes: 480, quality: null }, today: "2026-11-15", workoutMinutes7d: 0 });
  assert.equal(s.sample, undefined);
  assert.equal(s.v, 60);
  assert.match(s.src, /ngủ 8,0 giờ đêm qua/);
});

test("nganKho: còn bao nhiêu phần ngân sách; thiếu tháng / ngân sách → null", () => {
  assert.equal(nganKho({ hasMonth: true, limitTotal: 1000, spentInBudgeted: 250 }).v, 75);
  assert.equal(nganKho({ hasMonth: true, limitTotal: 1000, spentInBudgeted: 1500 }).v, 0);
  assert.equal(nganKho({ hasMonth: true, limitTotal: 0, spentInBudgeted: 0 }).v, null);
  assert.equal(nganKho({ hasMonth: false, limitTotal: 1000, spentInBudgeted: 0 }).v, null);
});

test("triThuc: so với nhịp mục tiêu tới hôm nay, có sàn để đầu năm không chia cho ~0", () => {
  assert.equal(triThuc({ targetBooks: 12, finished: 6, partial: 0, dayOfYear: 183, daysInYear: 365 }).v, 100);
  assert.equal(triThuc({ targetBooks: 12, finished: 3, partial: 0, dayOfYear: 183, daysInYear: 365 }).v, 50);
  assert.equal(triThuc({ targetBooks: 12, finished: 0, partial: 0, dayOfYear: 1, daysInYear: 365 }).v, 0);
  assert.equal(triThuc({ targetBooks: null, finished: 3, partial: 0, dayOfYear: 1, daysInYear: 365 }).v, null);
});

test("kyNang: trung bình điểm có giá trị", () => {
  assert.equal(kyNang([60, null, 80]).v, 70);
  assert.equal(kyNang([null, null]).v, null);
});

test("heThong: ≤ 24 giờ = 100, mỗi ngày sau −15", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  assert.equal(heThong(new Date("2026-11-15T02:00:00Z"), now).v, 100);
  assert.equal(heThong(new Date("2026-11-13T12:00:00Z"), now).v, 85);
  assert.equal(heThong(new Date("2026-11-01T12:00:00Z"), now).v, 0);
  assert.equal(heThong(null, now).v, null);
});

test("activityEvent: nguồn → công trình, xoá → info", () => {
  const at = new Date("2026-11-15T01:00:00Z");
  assert.deepEqual(activityEvent({ id: "a", source: "FINANCE", action: "finance.transaction_created", title: "Chi 50.000đ", createdAt: at }),
    { id: "a", from: "nghisu", lvl: "ok", text: "Chi 50.000đ", at: at.toISOString() });
  assert.equal(activityEvent({ id: "b", source: "MUSIC", action: "music.track_deleted", title: "x", createdAt: at }).lvl, "info");
  assert.equal(activityEvent({ id: "c", source: "LAI", action: "x", title: "x", createdAt: at }).from, "center");
});
