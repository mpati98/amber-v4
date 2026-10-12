import { z } from "zod";

// Một bài tập theo cách đo: REPS cần reps; SETS_REPS cần sets + reps; DURATION cần durationSeconds.
// Trường không thuộc kiểu đo bị từ chối (không lưu rác); ghi vào DB luôn là null cho trường đó.
const name = z.string().trim().min(1).max(100);
const count = (max: number) => z.number().int().min(1).max(max);

const repsExercise = z.object({ name, measure: z.literal("REPS"), reps: count(10000) }).strict();
const setsRepsExercise = z.object({ name, measure: z.literal("SETS_REPS"), sets: count(1000), reps: count(10000) }).strict();
const durationExercise = z.object({ name, measure: z.literal("DURATION"), durationSeconds: count(86400) }).strict();

export const exerciseSchema = z.discriminatedUnion("measure", [repsExercise, setsRepsExercise, durationExercise]);

export const MAX_EXERCISES = 50;

/** Body PUT log của routine WORKOUT. durationMinutes bắt buộc; exercises có thể rỗng (chỉ ghi số phút). */
export const workoutLogSchema = z
  .object({
    durationMinutes: z.number().int().min(1).max(1440),
    exercises: z.array(exerciseSchema).max(MAX_EXERCISES).default([]),
  })
  .strict();

export type WorkoutExerciseInput = z.infer<typeof exerciseSchema>;

/** Dòng workout_exercises từ input; position = thứ tự trong mảng (0-based). */
export function toExerciseRows(routineLogId: string, exercises: WorkoutExerciseInput[]) {
  return exercises.map((e, position) => ({
    routineLogId,
    position,
    name: e.name,
    measure: e.measure,
    sets: e.measure === "SETS_REPS" ? e.sets : null,
    reps: e.measure === "REPS" || e.measure === "SETS_REPS" ? e.reps : null,
    durationSeconds: e.measure === "DURATION" ? e.durationSeconds : null,
  }));
}
