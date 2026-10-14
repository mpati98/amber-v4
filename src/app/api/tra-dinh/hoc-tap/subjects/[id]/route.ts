import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { routines, studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, invalidBody, patchSubjectSchema, readJson } from "@/lib/study-input";
import { findOwnedSubject, subjectView } from "@/lib/study-courses";

type RouteParams = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "subject_not_found" }, { status: 404 });

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const subject = await findOwnedSubject(db, id, userId);
  if (!subject) return notFound();

  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = patchSubjectSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;
  if (Object.keys(d).length === 0) return badRequest("empty_patch");

  // Bỏ mục tiêu ngày khi còn routine STUDY theo dõi môn này: routine không còn gì để tính.
  if (d.dailyGoalMinutes === null) {
    const [study] = await db
      .select({ id: routines.id })
      .from(routines)
      .where(and(eq(routines.studySubjectId, subject.id), eq(routines.kind, "STUDY"), isNull(routines.archivedAt)))
      .limit(1);
    if (study) return NextResponse.json({ error: "subject_in_use" }, { status: 409 });
  }

  const [updated] = await db
    .update(studySubjects)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.dailyGoalMinutes !== undefined ? { dailyGoalMinutes: d.dailyGoalMinutes } : {}),
      ...(d.videoMinutesPerDay !== undefined ? { videoMinutesPerDay: d.videoMinutesPerDay } : {}),
      ...(d.reviewWeekdays !== undefined ? { reviewWeekdays: [...d.reviewWeekdays].sort((a, b) => a - b) } : {}),
      ...(d.position !== undefined ? { position: d.position } : {}),
    })
    .where(and(eq(studySubjects.id, subject.id), eq(studySubjects.userId, userId)))
    .returning();
  return NextResponse.json(subjectView(updated));
});

// Xoá môn: khóa học, phần, log, lý do xoá theo (cascade); đang có việc hằng ngày trỏ tới thì chặn.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const subject = await findOwnedSubject(db, id, userId);
  if (!subject) return notFound();

  const [inUse] = await db.select({ id: routines.id }).from(routines).where(eq(routines.studySubjectId, subject.id)).limit(1);
  if (inUse) return NextResponse.json({ error: "subject_in_use" }, { status: 409 });

  await db.delete(studySubjects).where(and(eq(studySubjects.id, subject.id), eq(studySubjects.userId, userId)));
  logActivity({ userId, source: "TRA_DINH", action: "study_subject.deleted", title: `Xoá môn học: ${subject.name}`, metadata: { subjectId: subject.id } });
  return NextResponse.json({ ok: true });
});
