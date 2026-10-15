// Test lịch học — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchedule, needsForecast, type ScheduleCourse, type ScheduleInput } from "./study-schedule";

// 2026-10-14 thứ Tư; 2026-10-18 Chủ nhật (ngày ôn).
const live: ScheduleCourse = { id: "c1", title: "Khóa 1", status: "ACTIVE", baselineFinishDate: "2026-10-16", forecastFinishDate: "2026-10-17", deltaDays: 1, finishedDate: null };
const done: ScheduleCourse = { id: "c0", title: "Khóa 0", status: "DONE", baselineFinishDate: "2026-10-10", forecastFinishDate: "2026-10-12", deltaDays: 2, finishedDate: "2026-10-12" };
const item = (minutes: number) => ({ courseId: "c1", sectionId: "s", title: "P", minutes });

const input = (o: Partial<ScheduleInput> = {}): ScheduleInput => ({
  today: "2026-10-14", from: "2026-10-12", to: "2026-10-18", goalMinutes: 60, reviewWeekdays: [7],
  totals: new Map([["2026-10-12", 90], ["2026-10-13", 30]]), reasons: new Map([["2026-10-13", { code: "BUSY", text: null }]]),
  logs: [{ id: "l1", logDate: "2026-10-13", courseTitle: "Khóa 1", minutes: 30, sections: [{ title: "P1", markedDone: true }] }],
  courses: [done, live],
  forecastDays: [
    { date: "2026-10-14", items: [item(40)] }, { date: "2026-10-15", items: [item(40)] },
    { date: "2026-10-16", items: [item(40)] }, { date: "2026-10-17", items: [item(10)] },
  ],
  ...o,
});
// Các ngày có hình dạng khác nhau theo kind — test đọc trường tuỳ ý nên để any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const day = (r: ReturnType<typeof buildSchedule>, d: string) => r.days.find((x) => x.date === d) as any;

test("kind past/today/planned và số ngày", () => {
  const r = buildSchedule(input());
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.days.map((d) => d.kind), ["past", "past", "today", "planned", "planned", "planned", "planned"]);
});

test("quá khứ: minutes, done, extraMinutes, reason, logs", () => {
  const r = buildSchedule(input());
  const d12 = day(r, "2026-10-12");
  assert.equal(d12.minutes, 90);
  assert.equal(d12.done, true);
  assert.equal(d12.extraMinutes, 30);
  assert.equal(d12.reason, null);
  const d13 = day(r, "2026-10-13");
  assert.equal(d13.done, false);
  assert.equal(d13.extraMinutes, 0);
  assert.deepEqual(d13.reason, { code: "BUSY", text: null });
  assert.deepEqual(d13.logs, [{ id: "l1", courseTitle: "Khóa 1", minutes: 30, sections: [{ title: "P1", markedDone: true }] }]);
  assert.equal("plannedItems" in d13, false);
});

test("hôm nay chưa có log → có plannedItems; có log → không có plannedItems", () => {
  const empty = day(buildSchedule(input()), "2026-10-14");
  assert.deepEqual(empty.logs, []);
  assert.equal(empty.plannedItems.length, 1);
  assert.equal(empty.plannedItems[0].courseTitle, "Khóa 1");
  const withLog = day(buildSchedule(input({
    totals: new Map([["2026-10-14", 20]]),
    logs: [{ id: "l2", logDate: "2026-10-14", courseTitle: null, minutes: 20, sections: [] }],
    forecastDays: [{ date: "2026-10-15", items: [item(40)] }],
  })), "2026-10-14");
  assert.equal(withLog.minutes, 20);
  assert.equal("plannedItems" in withLog, false);
});

test("ngày ôn tập (planned): plannedItems rỗng dù forecast có", () => {
  const r = buildSchedule(input({ forecastDays: [{ date: "2026-10-18", items: [item(40)] }] }));
  assert.deepEqual(day(r, "2026-10-18").plannedItems, []);
  assert.equal(day(r, "2026-10-18").isReviewDay, true);
});

test("milestone: ngày forecast xong (planned) và ngày finished_at (past)", () => {
  const r = buildSchedule(input());
  assert.deepEqual(day(r, "2026-10-17").milestones, [{ courseId: "c1", courseTitle: "Khóa 1", type: "finish" }]);
  assert.deepEqual(day(r, "2026-10-12").milestones, [{ courseId: "c0", courseTitle: "Khóa 0", type: "finish" }]);
  assert.deepEqual(day(r, "2026-10-15").milestones, []);
});

test("summary: minutes đã học, plannedMinutes từ hôm nay, vsBaseline chỉ khóa ACTIVE/QUEUED", () => {
  const r = buildSchedule(input());
  assert.equal(r.summary.minutes, 120);
  assert.equal(r.summary.plannedMinutes, 130);
  assert.deepEqual(r.summary.vsBaseline, [{ courseId: "c1", courseTitle: "Khóa 1", status: "ACTIVE", baselineFinishDate: "2026-10-16", forecastFinishDate: "2026-10-17", deltaDays: 1 }]);
});

test("khoảng toàn quá khứ: không có plannedItems / plannedMinutes, không cần forecast", () => {
  assert.equal(needsForecast("2026-10-14", "2026-10-13"), false);
  assert.equal(needsForecast("2026-10-14", "2026-10-14"), true);
  const r = buildSchedule(input({ from: "2026-10-12", to: "2026-10-13", forecastDays: [] }));
  assert.ok(r.days.every((d) => d.kind === "past" && !("plannedItems" in d)));
  assert.equal(r.summary.plannedMinutes, 0);
});

test("khoảng toàn tương lai: chỉ planned, không có minutes", () => {
  const r = buildSchedule(input({ from: "2026-10-15", to: "2026-10-16", totals: new Map(), logs: [], reasons: new Map() }));
  assert.ok(r.days.every((d) => d.kind === "planned" && !("minutes" in d)));
  assert.equal(r.summary.minutes, 0);
});

test("môn không mục tiêu: done false, extraMinutes 0", () => {
  const d = day(buildSchedule(input({ goalMinutes: null })), "2026-10-12");
  assert.equal(d.done, false);
  assert.equal(d.extraMinutes, 0);
  assert.equal(d.goalMinutes, null);
});

test("needsReason: chỉ ngày đã qua thiếu phút và chưa có lý do; hôm nay / planned luôn false", () => {
  const r = buildSchedule(input({ reasons: new Map(), totals: new Map([["2026-10-12", 90], ["2026-10-13", 30]]) }));
  assert.equal(day(r, "2026-10-12").needsReason, false, "đủ mục tiêu");
  assert.equal(day(r, "2026-10-13").needsReason, true, "thiếu và chưa có lý do");
  assert.equal(day(r, "2026-10-14").needsReason, false, "hôm nay chưa tính");
  assert.equal(day(r, "2026-10-16").needsReason, false, "dự kiến");
  const withReason = buildSchedule(input()); // fixture mặc định đã có lý do cho 10-13
  assert.equal(day(withReason, "2026-10-13").needsReason, false);
});

test("needsReason: trước ngày tạo môn / routine, ngày không đến hạn của routine → false", () => {
  const base = { reasons: new Map(), totals: new Map<string, number>() };
  const afterSubject = buildSchedule(input({ ...base, subjectCreatedDate: "2026-10-13" }));
  assert.equal(day(afterSubject, "2026-10-12").needsReason, false, "trước ngày tạo môn");
  assert.equal(day(afterSubject, "2026-10-13").needsReason, true);
  const withRoutine = buildSchedule(input({ ...base, routine: { createdDate: "2026-10-01", weekdays: [1, 3] } })); // T2, T4
  assert.equal(day(withRoutine, "2026-10-12").needsReason, true, "thứ Hai đến hạn");
  assert.equal(day(withRoutine, "2026-10-13").needsReason, false, "thứ Ba không đến hạn của routine");
  const routineLater = buildSchedule(input({ ...base, subjectCreatedDate: "2026-09-01", routine: { createdDate: "2026-10-13", weekdays: [1, 2, 3, 4, 5, 6, 7] } }));
  assert.equal(day(routineLater, "2026-10-12").needsReason, false, "trước ngày tạo routine");
});

test("needsReason: 20 ngày trước vẫn tính (khoảng lịch dài), môn không mục tiêu luôn false", () => {
  const r = buildSchedule(input({ from: "2026-09-20", to: "2026-09-26", today: "2026-10-14", reasons: new Map(), totals: new Map(), logs: [], forecastDays: [] }));
  assert.ok(r.days.every((d) => d.needsReason === true));
  const noGoal = buildSchedule(input({ goalMinutes: null, reasons: new Map() }));
  assert.ok(noGoal.days.every((d) => d.needsReason === false));
});
