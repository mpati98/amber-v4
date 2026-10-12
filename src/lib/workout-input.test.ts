// Test validate body ghi buổi tập — chạy: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toExerciseRows, workoutLogSchema } from "./workout-input";

const ok = (b: unknown) => workoutLogSchema.safeParse(b);

test("hợp lệ: đủ ba kiểu đo, exercises mặc định []", () => {
  const r = ok({
    durationMinutes: 30,
    exercises: [
      { name: "Chống đẩy", measure: "REPS", reps: 20 },
      { name: "Squat", measure: "SETS_REPS", sets: 3, reps: 15 },
      { name: "Plank", measure: "DURATION", durationSeconds: 60 },
    ],
  });
  assert.equal(r.success, true);
  assert.deepEqual(ok({ durationMinutes: 10 }).data?.exercises, []);
});

test("thiếu trường theo kiểu đo → lỗi", () => {
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "REPS" }] }).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "SETS_REPS", reps: 5 }] }).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "SETS_REPS", sets: 3 }] }).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "DURATION" }] }).success, false);
});

test("trường thừa không thuộc kiểu đo bị từ chối", () => {
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "REPS", reps: 5, sets: 2 }] }).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "DURATION", durationSeconds: 5, reps: 1 }] }).success, false);
});

test("giá trị biên: số phút/số lần phải nguyên dương, tên không rỗng, tối đa 50 bài", () => {
  assert.equal(ok({ durationMinutes: 0 }).success, false);
  assert.equal(ok({ durationMinutes: 1.5 }).success, false);
  assert.equal(ok({ durationMinutes: 1441 }).success, false);
  assert.equal(ok({}).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "  ", measure: "REPS", reps: 1 }] }).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "REPS", reps: 0 }] }).success, false);
  assert.equal(ok({ durationMinutes: 5, exercises: [{ name: "a", measure: "XYZ", reps: 1 }] }).success, false);
  const many = (n: number) => Array.from({ length: n }, () => ({ name: "a", measure: "REPS", reps: 1 }));
  assert.equal(ok({ durationMinutes: 5, exercises: many(50) }).success, true);
  assert.equal(ok({ durationMinutes: 5, exercises: many(51) }).success, false);
});

test("toExerciseRows: position theo thứ tự, trường không dùng là null, tên được trim", () => {
  const parsed = workoutLogSchema.parse({
    durationMinutes: 20,
    exercises: [
      { name: " Plank ", measure: "DURATION", durationSeconds: 60 },
      { name: "Squat", measure: "SETS_REPS", sets: 3, reps: 15 },
    ],
  });
  assert.deepEqual(toExerciseRows("L", parsed.exercises), [
    { routineLogId: "L", position: 0, name: "Plank", measure: "DURATION", sets: null, reps: null, durationSeconds: 60 },
    { routineLogId: "L", position: 1, name: "Squat", measure: "SETS_REPS", sets: 3, reps: 15, durationSeconds: null },
  ]);
});
