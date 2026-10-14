// Test thống kê học tập — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStats, planDelta, progressPct, statsBounds, type StatsCourse, type StatsInput, type StatsLog } from "./study-stats";

const log = (logDate: string, minutes: number, o: Partial<StatsLog> = {}): StatsLog => ({ subjectId: "a", courseId: "c1", courseTitle: "Khóa 1", logDate, minutes, ...o });
const course = (o: Partial<StatsCourse> = {}): StatsCourse => ({
  id: "c1", subjectId: "a", title: "Khóa 1", status: "ACTIVE", queuePosition: null, progressPct: 50,
  baselineFinishDate: "2026-10-20", forecastFinishDate: "2026-10-22", finishedDate: null, deltaDays: null, ...o,
});
// 2026-10-14 là thứ Tư.
const input = (o: Partial<StatsInput> = {}): StatsInput => ({
  today: "2026-10-14", range: "7", subjects: [{ id: "a", dailyGoalMinutes: 60 }],
  logs: [], firstLogDates: new Map(), reasons: [], courses: [], ...o,
});

test("khoảng 7/30 ngày kết thúc hôm nay; all từ log đầu tiên; không log → chỉ hôm nay", () => {
  assert.deepEqual(statsBounds("2026-10-14", "7", []), { from: "2026-10-08", to: "2026-10-14" });
  assert.deepEqual(statsBounds("2026-10-14", "30", []), { from: "2026-09-15", to: "2026-10-14" });
  assert.deepEqual(statsBounds("2026-10-14", "all", ["2026-09-01", "2026-08-20"]), { from: "2026-08-20", to: "2026-10-14" });
  assert.deepEqual(statsBounds("2026-10-14", "all", []), { from: "2026-10-14", to: "2026-10-14" });
});

test("range=all không có log: mọi số 0, mảng rỗng", () => {
  const s = buildStats(input({ range: "all" }));
  assert.equal(s.totalMinutes, 0);
  assert.equal(s.logCount, 0);
  assert.equal(s.avgPerDay, 0);
  assert.deepEqual(s.goalDays, { met: 0, total: 0 });
  assert.deepEqual([s.series, s.byCourse, s.vsPlan], [[], [], []]);
  assert.equal(s.longestDay, null);
  assert.equal(s.topWeekday, null);
  assert.deepEqual(s.reasonCounts, { BUSY: 0, TIRED: 0, AWAY: 0, OTHER: 0 });
});

test("tổng, avgPerDay (làm tròn), series theo ngày có cả ngày 0", () => {
  const s = buildStats(input({ logs: [log("2026-10-12", 60), log("2026-10-12", 30), log("2026-10-14", 25)], firstLogDates: new Map([["a", "2026-10-12"]]) }));
  assert.equal(s.totalMinutes, 115);
  assert.equal(s.logCount, 3);
  assert.equal(s.avgPerDay, 16); // 115 / 7 = 16.43
  assert.equal(s.bucket, "day");
  assert.equal(s.series.length, 7);
  assert.deepEqual(s.series[4], { start: "2026-10-12", minutes: 90, goalMinutes: 60 });
  assert.equal(s.series[5].minutes, 0);
});

test("goalDays: tính từ ngày log đầu tiên; hôm nay chưa đủ thì không phạt; hôm nay đủ thì tính", () => {
  const first = new Map([["a", "2026-10-12"]]);
  const notYet = buildStats(input({ logs: [log("2026-10-12", 60), log("2026-10-13", 10), log("2026-10-14", 20)], firstLogDates: first }));
  assert.deepEqual(notYet.goalDays, { met: 1, total: 2 }); // 12 đạt, 13 chưa, 14 (hôm nay) bỏ
  const doneToday = buildStats(input({ logs: [log("2026-10-12", 60), log("2026-10-13", 10), log("2026-10-14", 60)], firstLogDates: first }));
  assert.deepEqual(doneToday.goalDays, { met: 2, total: 3 });
});

test("goalDays: môn không mục tiêu hoặc chưa có log thì bỏ qua", () => {
  const s = buildStats(input({ subjects: [{ id: "a", dailyGoalMinutes: null }, { id: "b", dailyGoalMinutes: 30 }], logs: [log("2026-10-13", 99)], firstLogDates: new Map([["a", "2026-10-13"]]) }));
  assert.deepEqual(s.goalDays, { met: 0, total: 0 });
});

test("goalDays: first log trước khoảng thì tính từ đầu khoảng", () => {
  const s = buildStats(input({ logs: [], firstLogDates: new Map([["a", "2026-01-01"]]) }));
  assert.deepEqual(s.goalDays, { met: 0, total: 6 }); // 08..13, hôm nay bỏ
});

test("bucket week khi range=all và > 92 ngày; gom theo thứ Hai", () => {
  const s = buildStats(input({ range: "all", logs: [log("2026-06-01", 10), log("2026-06-03", 20), log("2026-10-14", 5)], firstLogDates: new Map([["a", "2026-06-01"]]) }));
  assert.equal(s.bucket, "week");
  assert.equal(s.series[0].start, "2026-06-01"); // thứ Hai
  assert.equal(s.series[0].minutes, 30);
  assert.equal(s.series[0].goalMinutes, 60 * 7);
  assert.equal(s.series[s.series.length - 1].start, "2026-10-12");
  assert.equal(s.series[s.series.length - 1].goalMinutes, 60 * 3); // 12,13,14
  assert.equal(s.series.reduce((n, p) => n + p.minutes, 0), 35);
});

test("đúng 92 ngày vẫn theo ngày, 93 ngày gom tuần", () => {
  const at = (first: string) => buildStats(input({ range: "all", logs: [log(first, 5)], firstLogDates: new Map([["a", first]]) })).bucket;
  assert.equal(at("2026-07-15"), "day"); // 15/7 → 14/10 = 92 ngày
  assert.equal(at("2026-07-14"), "week"); // 93 ngày
  assert.equal(buildStats(input({ range: "30", logs: [log("2026-10-14", 5)], firstLogDates: new Map([["a", "2026-10-14"]]) })).bucket, "day");
});

test("byCourse gom 'Ôn tập' cho log không khóa, nhiều phút trước", () => {
  const s = buildStats(input({ logs: [log("2026-10-13", 10, { courseId: null, courseTitle: null }), log("2026-10-13", 15, { courseId: null, courseTitle: null }), log("2026-10-14", 20), log("2026-10-12", 5, { courseId: "c2", courseTitle: "Khóa 2" })], firstLogDates: new Map([["a", "2026-10-12"]]) }));
  assert.deepEqual(s.byCourse, [
    { courseId: null, title: "Ôn tập", minutes: 25, logCount: 2 },
    { courseId: "c1", title: "Khóa 1", minutes: 20, logCount: 1 },
    { courseId: "c2", title: "Khóa 2", minutes: 5, logCount: 1 },
  ]);
});

test("longestDay, topWeekday, reasonCounts (chỉ trong khoảng)", () => {
  const s = buildStats(input({
    logs: [log("2026-10-12", 30), log("2026-10-12", 40), log("2026-10-13", 70), log("2026-10-14", 10)],
    firstLogDates: new Map([["a", "2026-10-12"]]),
    reasons: [{ subjectId: "a", date: "2026-10-13", code: "BUSY" }, { subjectId: "a", date: "2026-10-12", code: "BUSY" }, { subjectId: "a", date: "2026-10-11", code: "TIRED" }, { subjectId: "a", date: "2026-09-01", code: "AWAY" }],
  }));
  assert.deepEqual(s.longestDay, { date: "2026-10-12", minutes: 70 }); // hoà 70 → ngày sớm hơn
  assert.deepEqual(s.topWeekday, { weekday: 1, minutes: 70 }); // T2 = 70, T3 = 70 → thứ nhỏ hơn
  assert.deepEqual(s.reasonCounts, { BUSY: 2, TIRED: 1, AWAY: 0, OTHER: 0 });
});

test("vsPlan: khóa DONE delta = finishedDate − baseline; ACTIVE dùng forecast; WISHLIST bị loại", () => {
  const s = buildStats(input({ courses: [
    course(),
    course({ id: "d", title: "Xong", status: "DONE", progressPct: 100, baselineFinishDate: "2026-10-10", forecastFinishDate: "2026-10-09", finishedDate: "2026-10-09" }),
    course({ id: "w", status: "WISHLIST" }),
    course({ id: "n", status: "QUEUED", baselineFinishDate: null }),
  ] }));
  assert.deepEqual(s.vsPlan.map((c) => [c.courseId, c.deltaDays]), [["c1", 2], ["d", -1], ["n", null]]);
  assert.equal(planDelta(course({ status: "DONE", baselineFinishDate: "2026-10-10", finishedDate: "2026-10-12" })), 2);
});

test("overallDeltaDays: mỗi môn lấy delta của khóa cuối hàng học", () => {
  const s = buildStats(input({
    subjects: [{ id: "a", dailyGoalMinutes: 60 }, { id: "b", dailyGoalMinutes: null }],
    courses: [
      course({ id: "c1", status: "ACTIVE" }),
      course({ id: "c2", status: "QUEUED", queuePosition: 1, forecastFinishDate: "2026-10-18" }), // −2
      course({ id: "x", subjectId: "b", status: "ACTIVE", baselineFinishDate: null }),
    ],
  }));
  assert.deepEqual(s.overallDeltaDays, [{ subjectId: "a", deltaDays: -2 }, { subjectId: "b", deltaDays: null }]);
});

test("progressPct", () => {
  assert.equal(progressPct("DONE", { doneSections: 0, totalSections: 3, doneMinutes: 0, totalMinutes: 30 }), 100);
  assert.equal(progressPct("ACTIVE", { doneSections: 1, totalSections: 3, doneMinutes: 10, totalMinutes: 40 }), 25);
  assert.equal(progressPct("ACTIVE", { doneSections: 1, totalSections: 4, doneMinutes: 0, totalMinutes: 0 }), 25);
  assert.equal(progressPct("ACTIVE", { doneSections: 0, totalSections: 0, doneMinutes: 0, totalMinutes: 0 }), 0);
});
