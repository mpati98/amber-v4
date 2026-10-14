// Test tổng quan Học tập — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverview, datesBetween, dayDiff, lastQueueDelta, mondayOf, suggestedPerDay, weekBounds } from "./study-overview";

// 2026-10-14 là thứ Tư; tuần 10-12 (T2) → 10-18 (CN).
const course = (o: Partial<{ id: string; title: string; status: string; queuePosition: number | null; deltaDays: number | null; next: string | null }> = {}) => ({
  id: o.id ?? "c", title: o.title ?? "Khóa", status: o.status ?? "QUEUED", queuePosition: o.queuePosition ?? null, deltaDays: o.deltaDays ?? null,
  nextSection: o.next === null ? null : { id: `${o.id ?? "c"}-s`, title: o.next ?? "Phần" },
});

test("tuần cắt đúng thứ Hai–Chủ nhật", () => {
  assert.deepEqual(weekBounds("2026-10-14"), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(weekBounds("2026-10-12"), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(weekBounds("2026-10-18"), { start: "2026-10-12", end: "2026-10-18" });
  assert.deepEqual(weekBounds("2026-10-19"), { start: "2026-10-19", end: "2026-10-25" });
  assert.equal(mondayOf("2026-10-18"), "2026-10-12");
  assert.equal(dayDiff("2026-10-12", "2026-10-18"), 6);
  assert.equal(datesBetween("2026-10-12", "2026-10-14").length, 3);
});

test("suggestedPerDay: làm tròn lên, 0 khi đã đủ", () => {
  assert.equal(suggestedPerDay(100, 3), 34);
  assert.equal(suggestedPerDay(90, 3), 30);
  assert.equal(suggestedPerDay(0, 3), 0);
  assert.equal(suggestedPerDay(-5, 3), 0);
});

const base = {
  today: "2026-10-14",
  subjects: [
    { id: "a", name: "Anh", dailyGoalMinutes: 60 },
    { id: "b", name: "Code", dailyGoalMinutes: 30 },
    { id: "n", name: "Không mục tiêu", dailyGoalMinutes: null },
  ],
  totals: new Map([
    ["a", new Map([["2026-10-12", 60], ["2026-10-13", 40], ["2026-10-14", 20], ["2026-10-11", 500]])],
    ["b", new Map([["2026-10-12", 30]])],
    ["n", new Map([["2026-10-12", 999]])],
  ]),
  todayLogCounts: new Map([["a", 2]]),
  todayReasons: new Map([["b", { code: "BUSY", text: null }]]),
  coursesBySubject: new Map(),
};

test("tuần: chỉ môn có mục tiêu; ngày ngoài tuần và môn không mục tiêu không tính", () => {
  const w = buildOverview(base).week;
  assert.equal(w.goalMinutes, 90 * 7);
  assert.equal(w.minutes, 60 + 40 + 20 + 30);
  assert.equal(w.remainingMinutes, (420 - 120) + (210 - 30)); // theo từng môn: A 300 + B 180
  assert.equal(w.remainingDays, 5); // T4..CN
  assert.equal(w.suggestedPerDay, 60 + 36); // A: max(60, ceil(300/5)=60); B: max(30, ceil(180/5)=36)
  assert.equal(w.days.length, 7);
  assert.deepEqual(w.days[0], { date: "2026-10-12", minutes: 90, goalMinutes: 90, done: true });
  assert.equal(w.days[1].done, false);
  assert.deepEqual(w.bySubject.map((s) => [s.subjectId, s.goalMinutes, s.minutes]), [["a", 420, 120], ["b", 210, 30]]);
  assert.deepEqual(w.bySubject.map((s) => [s.remainingMinutes, s.suggestedPerDay]), [[300, 60], [180, 36]]);
});

test("1 môn học vượt đầu tuần: remaining 0 nhưng suggestedPerDay vẫn = mục tiêu ngày (60)", () => {
  const o = buildOverview({ ...base, subjects: [{ id: "a", name: "Anh", dailyGoalMinutes: 60 }], totals: new Map([["a", new Map([["2026-10-12", 900]])]]) });
  assert.equal(o.week.remainingMinutes, 0);
  assert.equal(o.week.suggestedPerDay, 60);
  assert.deepEqual([o.week.bySubject[0].remainingMinutes, o.week.bySubject[0].suggestedPerDay], [0, 60]);
});

test("2 môn: A vượt, B thiếu → remaining chỉ tính phần thiếu của B; A không bù cho B", () => {
  const o = buildOverview({
    ...base,
    subjects: [{ id: "a", name: "A", dailyGoalMinutes: 60 }, { id: "b", name: "B", dailyGoalMinutes: 60 }],
    totals: new Map([["a", new Map([["2026-10-12", 2000]])], ["b", new Map([["2026-10-12", 60]])]]),
  });
  assert.equal(o.week.remainingMinutes, 420 - 60); // chỉ B
  assert.equal(o.week.suggestedPerDay, 60 + Math.max(60, Math.ceil(360 / 5))); // A 60 + B 72
  assert.deepEqual(o.week.bySubject.map((s) => [s.subjectId, s.remainingMinutes, s.suggestedPerDay]), [["a", 0, 60], ["b", 360, 72]]);
});

test("môn không mục tiêu không ảnh hưởng remaining / suggestedPerDay", () => {
  const withN = buildOverview({ ...base, subjects: [{ id: "a", name: "A", dailyGoalMinutes: 60 }, { id: "n", name: "n", dailyGoalMinutes: null }], totals: new Map([["a", new Map([["2026-10-12", 60]])], ["n", new Map([["2026-10-12", 9999]])]]) });
  const without = buildOverview({ ...base, subjects: [{ id: "a", name: "A", dailyGoalMinutes: 60 }], totals: new Map([["a", new Map([["2026-10-12", 60]])]]) });
  assert.equal(withN.week.remainingMinutes, without.week.remainingMinutes);
  assert.equal(withN.week.suggestedPerDay, without.week.suggestedPerDay);
  assert.equal(withN.week.bySubject.length, 1);
});

test("chủ nhật: remainingDays = 1", () => {
  assert.equal(buildOverview({ ...base, today: "2026-10-18" }).week.remainingDays, 1);
});

test("không có môn nào có mục tiêu → mọi số 0, day.done false", () => {
  const o = buildOverview({ ...base, subjects: [{ id: "n", name: "x", dailyGoalMinutes: null }] });
  assert.equal(o.week.goalMinutes, 0);
  assert.equal(o.week.suggestedPerDay, 0);
  assert.ok(o.week.days.every((d) => !d.done));
});

test("môn: today, reason, done chỉ khi có mục tiêu", () => {
  const s = buildOverview(base).subjects;
  assert.deepEqual(s[0].today, { minutes: 20, logCount: 2, done: false, reason: null });
  assert.deepEqual(s[1].today, { minutes: 0, logCount: 0, done: false, reason: { code: "BUSY", text: null } });
  assert.equal(s[2].goalMinutes, null);
  assert.equal(s[2].today.done, false);
});

test("next: phần kế tiếp của khóa ACTIVE, không có thì khóa QUEUED đầu hàng; counts; activeCourse", () => {
  const withActive = buildOverview({ ...base, coursesBySubject: new Map([["a", [
    course({ id: "q2", status: "QUEUED", queuePosition: 2, next: "Q2" }),
    course({ id: "act", status: "ACTIVE", next: "A1" }),
    course({ id: "q1", status: "QUEUED", queuePosition: 1, next: "Q1" }),
    course({ id: "d", status: "DONE", next: null }),
    course({ id: "w", status: "WISHLIST" }),
  ]]]) }).subjects[0];
  assert.deepEqual(withActive.next, { courseId: "act", courseTitle: "Khóa", sectionId: "act-s", sectionTitle: "A1" });
  assert.equal(withActive.activeCourse?.id, "act");
  assert.deepEqual(withActive.counts, { QUEUED: 2, DONE: 1, WISHLIST: 1 });

  const noActive = buildOverview({ ...base, coursesBySubject: new Map([["a", [
    course({ id: "q2", status: "QUEUED", queuePosition: 2, next: "Q2" }),
    course({ id: "q1", status: "QUEUED", queuePosition: 1, next: "Q1" }),
  ]]]) }).subjects[0];
  assert.equal(noActive.next?.courseId, "q1");
  assert.equal(noActive.activeCourse, null);
  assert.equal(buildOverview(base).subjects[0].next, null);
});

test("vsBaseline: khóa cuối hàng học có delta; bỏ qua khóa thiếu baseline", () => {
  assert.equal(lastQueueDelta([
    course({ id: "a", status: "ACTIVE", deltaDays: 2 }),
    course({ id: "b", status: "QUEUED", queuePosition: 1, deltaDays: -3 }),
    course({ id: "c", status: "QUEUED", queuePosition: 2, deltaDays: null }),
    course({ id: "d", status: "DONE", deltaDays: 99 }),
  ]), -3);
  assert.equal(lastQueueDelta([course({ status: "DONE", deltaDays: 5 })]), null);
  assert.equal(lastQueueDelta([]), null);
});

test("week.days[].done theo từng môn: A 90/60 + B 30/60 → false; cả hai đủ → true; không môn có mục tiêu → false", () => {
  const subjects = [{ id: "a", name: "A", dailyGoalMinutes: 60 }, { id: "b", name: "B", dailyGoalMinutes: 60 }];
  const doneOn = (a: number, b: number) =>
    buildOverview({ ...base, subjects, totals: new Map([["a", new Map([["2026-10-12", a]])], ["b", new Map([["2026-10-12", b]])]]) }).week.days[0];
  const lopsided = doneOn(90, 30); // tổng 120 ≥ 120 nhưng B thiếu
  assert.equal(lopsided.minutes, 120);
  assert.equal(lopsided.goalMinutes, 120);
  assert.equal(lopsided.done, false);
  assert.equal(doneOn(60, 60).done, true);
  assert.equal(doneOn(90, 60).done, true);
  assert.equal(doneOn(0, 0).done, false);
  const none = buildOverview({ ...base, subjects: [{ id: "n", name: "n", dailyGoalMinutes: null }] }).week.days[0];
  assert.equal(none.done, false);
});

test("môn không có mục tiêu không chặn done của ngày", () => {
  const o = buildOverview({ ...base, subjects: [{ id: "a", name: "A", dailyGoalMinutes: 60 }, { id: "n", name: "n", dailyGoalMinutes: null }], totals: new Map([["a", new Map([["2026-10-12", 60]])]]) });
  assert.equal(o.week.days[0].done, true);
});
