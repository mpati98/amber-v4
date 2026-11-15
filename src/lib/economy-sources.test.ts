// Test chuyển dữ liệu thật → sự kiện kinh tế và đối soát — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { vnToday } from "./vn-time";
import type { EconomyEvent } from "./economy-engine";
import { diffEvents, isManagedEventId, minDate, routineLogToEvent, sameEvent, studyLogToEvent } from "./economy-sources";

test("buổi học → study.logged, eventId theo id, thời điểm = lúc tạo", () => {
  const at = new Date("2026-11-15T02:00:00Z");
  assert.deepEqual(studyLogToEvent({ id: "s1", minutes: 45, createdAt: at }), {
    eventId: "study-log:s1",
    type: "study.logged",
    source: "auto",
    occurredAt: at,
    data: { minutes: 45 },
  });
});

test("buổi tập → exercise.logged; không phút ⇒ không sự kiện; dòng cũ không created_at ⇒ 21:30 VN", () => {
  assert.equal(routineLogToEvent({ id: "r1", logDate: "2026-11-15", durationMinutes: null, createdAt: null }), null);
  assert.equal(routineLogToEvent({ id: "r1", logDate: "2026-11-15", durationMinutes: 0, createdAt: null }), null);
  const old = routineLogToEvent({ id: "r1", logDate: "2026-11-15", durationMinutes: 40, createdAt: null })!;
  assert.equal(old.occurredAt.toISOString(), "2026-11-15T14:30:00.000Z");
  assert.equal(old.eventId, "routine-log:r1");
  const at = new Date("2026-11-15T23:00:00Z");
  assert.equal(routineLogToEvent({ id: "r2", logDate: "2026-11-16", durationMinutes: 40, createdAt: at })!.occurredAt, at);
});

test("tiền tố được đối soát quản lý; sự kiện cửa hàng không bao giờ bị đối soát xoá", () => {
  for (const id of ["amber-task:x:done", "amber-task-occ:x:2026-11-15:done", "study-log:x", "routine-log:x"]) assert.ok(isManagedEventId(id), id);
  for (const id of ["redeem:x", "buy-card:x", "ats-task:x:done", "amber-taskx"]) assert.ok(!isManagedEventId(id), id);
});

const ev = (id: string, iso: string, data: Record<string, unknown> = { minutes: 30 }): EconomyEvent => ({
  eventId: id,
  type: "study.logged",
  source: "auto",
  occurredAt: new Date(iso),
  data,
});

test("sameEvent bỏ qua thứ tự khoá jsonb", () => {
  assert.ok(sameEvent(ev("a", "2026-11-15T01:00:00Z", { a: 1, b: true }), ev("a", "2026-11-15T01:00:00Z", { b: true, a: 1 })));
  assert.ok(!sameEvent(ev("a", "2026-11-15T01:00:00Z", { a: 1 }), ev("a", "2026-11-15T01:00:01Z", { a: 1 })));
});

test("diffEvents: thêm / sửa / xoá, ngày sớm nhất gồm cả bản cũ; không đổi ⇒ rỗng", () => {
  const existing = [
    ev("study-log:keep", "2026-11-10T01:00:00Z"),
    ev("study-log:edit", "2026-11-12T01:00:00Z"),
    ev("study-log:gone", "2026-11-11T01:00:00Z"),
    ev("redeem:r1", "2026-11-01T01:00:00Z"),
  ];
  const desired = [
    ev("study-log:keep", "2026-11-10T01:00:00Z"),
    ev("study-log:edit", "2026-11-12T01:00:00Z", { minutes: 60 }),
    ev("study-log:new", "2026-11-14T01:00:00Z"),
  ];
  const d = diffEvents(desired, existing, vnToday);
  assert.deepEqual(d.upsert.map((e) => e.eventId).sort(), ["study-log:edit", "study-log:new"]);
  assert.deepEqual(d.remove, ["study-log:gone"]); // redeem:r1 không bị đụng
  assert.equal(d.earliest, "2026-11-11");

  const same = diffEvents(desired, desired, vnToday);
  assert.deepEqual(same, { upsert: [], remove: [], earliest: null });

  // Task mở lại về trước: dời ngày hoàn thành lùi lại ⇒ ngày sớm nhất là bản MỚI
  const moved = diffEvents([ev("study-log:keep", "2026-11-05T01:00:00Z")], [ev("study-log:keep", "2026-11-10T01:00:00Z")], vnToday);
  assert.equal(moved.earliest, "2026-11-05");
});

test("minDate", () => {
  assert.equal(minDate(null, "2026-11-02", undefined, "2026-11-01"), "2026-11-01");
  assert.equal(minDate(null, undefined), null);
});
