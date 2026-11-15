// Test validate check-in + debuff — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInSchema, checkInValues, debuffChangedFrom, debuffCreateSchema, debuffPatchSchema, debuffTimeError } from "./health-input";

test("check-in: mỗi mốc chỉ nhận trường của nó", () => {
  assert.ok(checkInSchema.safeParse({ date: "2026-11-15", slot: "noon", staminaSelf: 3 }).success);
  assert.ok(!checkInSchema.safeParse({ date: "2026-11-15", slot: "noon" }).success);
  assert.ok(!checkInSchema.safeParse({ date: "2026-11-15", slot: "noon", staminaSelf: 6 }).success);
  assert.ok(!checkInSchema.safeParse({ date: "2026-11-15", slot: "noon", staminaSelf: 3, exerciseMinutes: 10 }).success);
  assert.ok(checkInSchema.safeParse({ date: "2026-11-15", slot: "evening", exerciseMinutes: 30, sportMinutes: null, restDay: false }).success);
  assert.ok(checkInSchema.safeParse({ date: "2026-11-15", slot: "evening" }).success);
  assert.ok(!checkInSchema.safeParse({ date: "2026-11-15", slot: "evening", staminaSelf: 3 }).success);
  assert.ok(!checkInSchema.safeParse({ date: "2026-11-15", slot: "evening", exerciseMinutes: 1441 }).success);
  assert.ok(!checkInSchema.safeParse({ date: "2026-11-15", slot: "morning" }).success);
});

test("check-in: giá trị ghi DB thay toàn bộ mốc", () => {
  assert.deepEqual(checkInValues({ date: "2026-11-15", slot: "noon", staminaSelf: 2 }), { staminaSelf: 2, exerciseMinutes: null, sportMinutes: null, restDay: false });
  assert.deepEqual(checkInValues({ date: "2026-11-15", slot: "evening", sportMinutes: 20 }), { staminaSelf: null, exerciseMinutes: null, sportMinutes: 20, restDay: false });
});

test("debuff: schema tạo / sửa", () => {
  assert.ok(debuffCreateSchema.safeParse({ level: "medium" }).success);
  assert.ok(debuffCreateSchema.safeParse({ level: "heavy", label: "Sốt", startedAt: "2026-11-15T08:00:00+07:00" }).success);
  assert.ok(!debuffCreateSchema.safeParse({ level: "severe" }).success);
  assert.ok(!debuffCreateSchema.safeParse({ level: "light", startedAt: "2026-11-15" }).success);
  assert.ok(!debuffCreateSchema.safeParse({ level: "light", endedAt: "2026-11-15T08:00:00Z" }).success);
  assert.ok(debuffPatchSchema.safeParse({ endedAt: null }).success);
  assert.ok(debuffPatchSchema.safeParse({ endedAt: "2026-11-15T08:00:00Z" }).success);
  assert.ok(!debuffPatchSchema.safeParse({}).success);
  assert.ok(!debuffPatchSchema.safeParse({ startedAt: "2026-11-15T08:00:00Z" }).success);
});

test("debuff: mốc thời gian", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  assert.equal(debuffTimeError(new Date("2026-11-15T09:00:00Z"), null, now), null);
  assert.equal(debuffTimeError(new Date("2026-11-15T11:00:00Z"), null, now), "future_start");
  assert.equal(debuffTimeError(new Date("2026-09-01T00:00:00Z"), null, now), "too_old");
  assert.equal(debuffTimeError(new Date("2026-11-15T09:00:00Z"), new Date("2026-11-15T08:00:00Z"), now), "ended_before_started");
  assert.equal(debuffTimeError(new Date("2026-11-15T09:00:00Z"), new Date("2026-11-15T12:00:00Z"), now), "future_end");
});

test("debuff: ngày dựng lại = mốc sớm nhất theo giờ VN", () => {
  assert.equal(debuffChangedFrom(new Date("2026-11-14T18:00:00Z"), null, new Date("2026-11-15T03:00:00Z")), "2026-11-15");
  assert.equal(debuffChangedFrom(new Date("2026-11-14T16:59:00Z"), undefined), "2026-11-14");
});
