import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { routines } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { findOwnedRoutine, routineViews } from "@/lib/routines";
import { weekdaysSchema } from "@/lib/routine-input";
import { vnToday } from "@/lib/vn-time";

const patchRoutineSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  weekdays: weekdaysSchema.optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "routine_not_found" }, { status: 404 });

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const routine = await findOwnedRoutine(id, userId);
  if (!routine) return notFound();

  const parsed = patchRoutineSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 });
  }
  const [updated] = await db.update(routines).set(parsed.data).where(eq(routines.id, routine.id)).returning();
  const [view] = await routineViews([updated], vnToday());
  return NextResponse.json(view);
});

// Xoá hẳn; routine_logs xoá theo (ON DELETE CASCADE).
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const routine = await findOwnedRoutine(id, userId);
  if (!routine) return notFound();
  await db.delete(routines).where(eq(routines.id, routine.id));
  return NextResponse.json({ ok: true });
});
