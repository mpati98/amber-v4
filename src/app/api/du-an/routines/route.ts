import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { routines } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { listRoutines, routineViews } from "@/lib/routines";
import { ALL_WEEKDAYS, weekdaysSchema } from "@/lib/routine-input";
import { dateString } from "@/lib/project-input";
import { vnToday } from "@/lib/vn-time";

const createRoutineSchema = z.object({
  name: z.string().min(1).max(255),
  weekdays: weekdaysSchema.optional(),
});

export const GET = withAuth(async (req, userId) => {
  const dateParam = req.nextUrl.searchParams.get("date");
  const date = dateParam === null ? { success: true as const, data: vnToday() } : dateString.safeParse(dateParam);
  if (!date.success) {
    return NextResponse.json({ error: date.error.flatten() }, { status: 400 });
  }
  return NextResponse.json(await routineViews(await listRoutines(userId), date.data));
});

export const POST = withAuth(async (req, userId) => {
  const parsed = createRoutineSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const [created] = await db
    .insert(routines)
    .values({ userId, name: parsed.data.name, weekdays: parsed.data.weekdays ?? ALL_WEEKDAYS })
    .returning();
  const [view] = await routineViews([created], vnToday());
  return NextResponse.json(view, { status: 201 });
});
