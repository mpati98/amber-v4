import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { routineLogs, workoutExercises } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { findOwnedRoutine, routineViews } from "@/lib/routines";
import { isoWeekday } from "@/lib/routine-stats";
import { dateString } from "@/lib/project-input";
import { toExerciseRows, workoutLogSchema } from "@/lib/workout-input";
import { vnToday } from "@/lib/vn-time";

type RouteParams = { params: Promise<{ id: string; date: string }> };

const notFound = () => NextResponse.json({ error: "routine_not_found" }, { status: 404 });

// CHECK: đánh dấu đã làm (idempotent), không cho ngày tương lai, không cho ngày không đến hạn.
// WORKOUT: ghi buổi tập {durationMinutes, exercises[]} — chỉ cho HÔM NAY; thay cả danh sách bài
// (upsert log + xoá/ghi lại bài trong 1 transaction), gọi lại cùng ngày là sửa buổi tập.
export const PUT = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id, date } = await params;
  const routine = await findOwnedRoutine(id, userId);
  if (!routine) return notFound();

  const parsedDate = dateString.safeParse(date);
  if (!parsedDate.success) {
    return NextResponse.json({ error: parsedDate.error.flatten() }, { status: 400 });
  }
  const today = vnToday();
  if (parsedDate.data > today) {
    return NextResponse.json({ error: "future_date" }, { status: 400 });
  }
  if (!routine.weekdays.includes(isoWeekday(parsedDate.data))) {
    return NextResponse.json({ error: "not_scheduled" }, { status: 400 });
  }

  if (routine.kind === "WORKOUT") {
    if (parsedDate.data !== today) {
      return NextResponse.json({ error: "not_today" }, { status: 400 });
    }
    const body = await req.json().catch(() => undefined);
    const parsed = workoutLogSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    await db.transaction(async (tx) => {
      const [log] = await tx
        .insert(routineLogs)
        .values({ routineId: routine.id, logDate: parsedDate.data, durationMinutes: parsed.data.durationMinutes })
        .onConflictDoUpdate({
          target: [routineLogs.routineId, routineLogs.logDate],
          set: { durationMinutes: parsed.data.durationMinutes },
        })
        .returning({ id: routineLogs.id });
      await tx.delete(workoutExercises).where(eq(workoutExercises.routineLogId, log.id));
      if (parsed.data.exercises.length > 0) {
        await tx.insert(workoutExercises).values(toExerciseRows(log.id, parsed.data.exercises));
      }
    });
    const [view] = await routineViews([routine], today);
    return NextResponse.json(view);
  }

  await db.insert(routineLogs).values({ routineId: routine.id, logDate: parsedDate.data }).onConflictDoNothing();
  const [view] = await routineViews([routine], today);
  return NextResponse.json(view);
});

// Bỏ đánh dấu / xoá buổi tập (bài tập xoá theo bằng ON DELETE CASCADE). Chỉ kiểm tra định dạng ngày — xoá log của ngày không còn đến hạn (do đổi weekdays) vẫn được.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id, date } = await params;
  const routine = await findOwnedRoutine(id, userId);
  if (!routine) return notFound();

  const parsedDate = dateString.safeParse(date);
  if (!parsedDate.success) {
    return NextResponse.json({ error: parsedDate.error.flatten() }, { status: 400 });
  }
  await db.delete(routineLogs).where(and(eq(routineLogs.routineId, routine.id), eq(routineLogs.logDate, parsedDate.data)));
  const [view] = await routineViews([routine], vnToday());
  return NextResponse.json(view);
});
