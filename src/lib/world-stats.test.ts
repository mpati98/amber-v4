// Test công thức chỉ số màn chủ 3D — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityEvent, heThong, kyNang, nganKho, sucKhoe, triThuc } from "./world-stats";

test("sucKhoe: lấy giá trị kinh tế, ghi debuff, 3 ngày không dữ liệu ⇒ sample", () => {
  assert.deepEqual(sucKhoe({ value: 72.4, base: 72.4, recentDays: 2 }), { v: 72, src: "Ngủ, vận động · nền 72" });
  assert.deepEqual(sucKhoe({ value: 47.4, base: 72.4, recentDays: 1 }), { v: 47, src: "Ngủ, vận động · nền 72 · debuff −25" });
  const s = sucKhoe({ value: 70, base: 70, recentDays: 0 });
  assert.equal(s.sample, true);
  assert.equal(s.v, 70);
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
