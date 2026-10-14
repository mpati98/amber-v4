import { NextResponse } from "next/server";
import { asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { studySubjects } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { createSubjectSchema, badRequest, invalidBody, readJson } from "@/lib/study-input";
import { subjectView } from "@/lib/study-courses";

export const GET = withAuth(async (_req, userId) => {
  const rows = await db
    .select()
    .from(studySubjects)
    .where(eq(studySubjects.userId, userId))
    .orderBy(asc(studySubjects.position), asc(studySubjects.createdAt), asc(studySubjects.id));
  return NextResponse.json(rows.map(subjectView));
});

export const POST = withAuth(async (req, userId) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = createSubjectSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;

  // Không gửi position → xếp cuối danh sách.
  let position = d.position;
  if (position === undefined) {
    const [row] = await db.select({ m: max(studySubjects.position) }).from(studySubjects).where(eq(studySubjects.userId, userId));
    position = row?.m == null ? 0 : row.m + 1;
  }
  const [created] = await db
    .insert(studySubjects)
    .values({
      userId,
      name: d.name,
      dailyGoalMinutes: d.dailyGoalMinutes ?? null,
      ...(d.videoMinutesPerDay !== undefined ? { videoMinutesPerDay: d.videoMinutesPerDay } : {}),
      ...(d.reviewWeekdays !== undefined ? { reviewWeekdays: [...d.reviewWeekdays].sort((a, b) => a - b) } : {}),
      position,
    })
    .returning();

  logActivity({ userId, source: "TRA_DINH", action: "study_subject.created", title: `Thêm môn học: ${created.name}`, metadata: { subjectId: created.id } });
  return NextResponse.json(subjectView(created), { status: 201 });
});
