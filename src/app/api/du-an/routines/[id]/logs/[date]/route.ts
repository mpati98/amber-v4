import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { routineLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { findOwnedRoutine, routineViews } from "@/lib/routines";
import { isoWeekday } from "@/lib/routine-stats";
import { dateString } from "@/lib/project-input";
import { vnToday } from "@/lib/vn-time";

type RouteParams = { params: Promise<{ id: string; date: string }> };

const notFound = () => NextResponse.json({ error: "routine_not_found" }, { status: 404 });

// Đánh dấu đã làm (idempotent). Không cho ngày tương lai, không cho ngày không đến hạn.
export const PUT = withAuth(async (_req, userId, { params }: RouteParams) => {
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

  await db.insert(routineLogs).values({ routineId: routine.id, logDate: parsedDate.data }).onConflictDoNothing();
  const [view] = await routineViews([routine], today);
  return NextResponse.json(view);
});

// Bỏ đánh dấu. Chỉ kiểm tra định dạng ngày — xoá log của ngày không còn đến hạn (do đổi weekdays) vẫn được.
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
