// Test validate giấc ngủ — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sleepDateError, sleepLogSchema } from "./sleep-input";

test("sleepLogSchema: nhận đủ trường hợp lệ, từ chối phút / chất lượng sai và khoá lạ", () => {
  assert.equal(sleepLogSchema.safeParse({ date: "2026-11-15", sleepMinutes: 420 }).success, true);
  assert.equal(sleepLogSchema.safeParse({ date: "2026-11-15", sleepMinutes: 420, quality: 4, note: "ổn" }).success, true);
  assert.equal(sleepLogSchema.safeParse({ date: "2026-11-15", sleepMinutes: 1441 }).success, false);
  assert.equal(sleepLogSchema.safeParse({ date: "2026-11-15", sleepMinutes: 420, quality: 6 }).success, false);
  assert.equal(sleepLogSchema.safeParse({ date: "15/11/2026", sleepMinutes: 420 }).success, false);
  assert.equal(sleepLogSchema.safeParse({ date: "2026-11-15", sleepMinutes: 420, userId: "x" }).success, false);
});

test("sleepDateError: không cho tương lai, không quá 60 ngày", () => {
  assert.equal(sleepDateError("2026-11-15", "2026-11-15"), null);
  assert.equal(sleepDateError("2026-11-16", "2026-11-15"), "future_date");
  assert.equal(sleepDateError("2026-09-16", "2026-11-15"), null);
  assert.equal(sleepDateError("2026-09-15", "2026-11-15"), "too_old");
});
