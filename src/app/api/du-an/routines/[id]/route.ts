import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { routineLogs, routines } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { checkStudySubject, findOwnedRoutine, routineViews } from "@/lib/routines";
import { routineKindSchema, weekdaysSchema } from "@/lib/routine-input";
import { vnToday } from "@/lib/vn-time";

const patchRoutineSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  weekdays: weekdaysSchema.optional(),
  kind: routineKindSchema.optional(),
  // Đổi môn của routine STUDY.
  studySubjectId: z.string().optional(),
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
  // Vào/ra khỏi STUDY là đổi bản chất routine (log tay ↔ tự tính từ nhật ký học) → khoá hẳn.
  if (parsed.data.kind !== undefined && parsed.data.kind !== routine.kind && (parsed.data.kind === "STUDY" || routine.kind === "STUDY")) {
    return NextResponse.json({ error: "kind_locked" }, { status: 409 });
  }
  if (parsed.data.studySubjectId !== undefined) {
    if (routine.kind !== "STUDY") return NextResponse.json({ error: "study_subject_not_allowed" }, { status: 400 });
    if (parsed.data.studySubjectId !== routine.studySubjectId) {
      const error = await checkStudySubject(parsed.data.studySubjectId, userId, routine.id);
      if (error) return error;
    }
  }
  // Đã có log thì không đổi loại: log CHECK và log WORKOUT có dữ liệu khác nhau.
  if (parsed.data.kind !== undefined && parsed.data.kind !== routine.kind) {
    const [anyLog] = await db.select({ id: routineLogs.id }).from(routineLogs).where(eq(routineLogs.routineId, routine.id)).limit(1);
    if (anyLog) return NextResponse.json({ error: "kind_locked" }, { status: 409 });
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
