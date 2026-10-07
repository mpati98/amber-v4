// Test thống kê việc hằng ngày với ngày cố định — chạy: npm test (node:test qua tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekday, routineStats } from "./routine-stats";

const ALL = [1, 2, 3, 4, 5, 6, 7];
// 2026-10-07 là thứ Tư (3).

test("isoWeekday: 1 = thứ Hai … 7 = Chủ nhật", () => {
  assert.equal(isoWeekday("2026-10-05"), 1);
  assert.equal(isoWeekday("2026-10-07"), 3);
  assert.equal(isoWeekday("2026-10-11"), 7);
});

test("chưa làm gì: streak 0, last7 có 7 ngày cũ → mới", () => {
  const s = routineStats(ALL, [], "2026-10-07");
  assert.equal(s.streak, 0);
  assert.equal(s.dueToday, true);
  assert.equal(s.doneToday, false);
  assert.equal(s.last7.length, 7);
  assert.equal(s.last7[0].date, "2026-10-01");
  assert.equal(s.last7[6].date, "2026-10-07");
});

test("làm hôm nay và hôm qua → streak 2", () => {
  assert.equal(routineStats(ALL, ["2026-10-07", "2026-10-06"], "2026-10-07").streak, 2);
});

test("hôm nay đến hạn nhưng chưa làm: đếm từ hôm qua", () => {
  const s = routineStats(ALL, ["2026-10-06", "2026-10-05"], "2026-10-07");
  assert.equal(s.streak, 2);
  assert.equal(s.doneToday, false);
});

test("bỏ lỡ một ngày đến hạn thì chuỗi đứt", () => {
  assert.equal(routineStats(ALL, ["2026-10-07", "2026-10-05"], "2026-10-07").streak, 1);
});

test("ngày không đến hạn bỏ qua, không đứt chuỗi (T2, T4, T6)", () => {
  // ref = thứ Tư 10-07; đến hạn: T4 10-07, T2 10-05, T6 10-02, T4 09-30
  const s = routineStats([1, 3, 5], ["2026-10-07", "2026-10-05", "2026-10-02"], "2026-10-07");
  assert.equal(s.streak, 3);
});

test("ref không đến hạn: không tính ngày ref, đếm từ ngày đến hạn trước đó", () => {
  // ref = thứ Năm 10-08, weekdays T2/T4 → ref không đến hạn
  const s = routineStats([1, 3], ["2026-10-07", "2026-10-05"], "2026-10-08");
  assert.equal(s.dueToday, false);
  assert.equal(s.streak, 2);
});

test("log của ngày không đến hạn vẫn hiện done trong last7 nhưng không cộng streak", () => {
  const s = routineStats([1], ["2026-10-07"], "2026-10-07"); // thứ Tư không đến hạn
  assert.equal(s.streak, 0);
  assert.equal(s.last7[6].done, true);
  assert.equal(s.last7[6].due, false);
});

test("nhìn lùi tối đa 400 ngày", () => {
  const dates: string[] = [];
  const base = Date.UTC(2026, 9, 7);
  for (let i = 0; i < 1000; i++) dates.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  assert.equal(routineStats(ALL, dates, "2026-10-07").streak, 401);
});
