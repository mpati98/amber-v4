import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { routines } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { checkStudySubject, listRoutines, routineViews } from "@/lib/routines";
import { ALL_WEEKDAYS, routineKindSchema, weekdaysSchema } from "@/lib/routine-input";
import { dateString } from "@/lib/project-input";
import { vnToday } from "@/lib/vn-time";

const createRoutineSchema = z.object({
  name: z.string().min(1).max(255),
  weekdays: weekdaysSchema.optional(),
  kind: routineKindSchema.optional(),
  // Chỉ dùng (và bắt buộc) với kind STUDY.
  studySubjectId: z.string().optional(),
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
  const kind = parsed.data.kind ?? "CHECK";
  const { studySubjectId } = parsed.data;
  if (kind === "STUDY") {
    if (!studySubjectId) return NextResponse.json({ error: "study_subject_required" }, { status: 400 });
    const error = await checkStudySubject(studySubjectId, userId);
    if (error) return error;
  } else if (studySubjectId !== undefined) {
    return NextResponse.json({ error: "study_subject_not_allowed" }, { status: 400 });
  }
  const [created] = await db
    .insert(routines)
    .values({ userId, name: parsed.data.name, weekdays: parsed.data.weekdays ?? ALL_WEEKDAYS, kind, ...(kind === "STUDY" ? { studySubjectId } : {}) })
    .returning();
  const [view] = await routineViews([created], vnToday());
  return NextResponse.json(view, { status: 201 });
});
