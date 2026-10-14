import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studyDayReasons } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { dateString } from "@/lib/project-input";
import { badRequest, invalidBody, reasonBodySchema, readJson } from "@/lib/study-input";
import { findOwnedSubject, guardStudy } from "@/lib/study-courses";
import { dayTotal } from "@/lib/study-days";
import { upsertReason } from "@/lib/study-logs";
import { vnToday } from "@/lib/vn-time";

type RouteParams = { params: Promise<{ id: string; date: string }> };
const notFound = () => NextResponse.json({ error: "subject_not_found" }, { status: 404 });

// Ghi lý do chưa đủ mục tiêu cho hôm nay hoặc một ngày đã qua (ghi lại thì thay lý do cũ).
export const PUT = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id, date } = await params;
  const subject = await findOwnedSubject(db, id, userId);
  if (!subject) return notFound();

  const parsedDate = dateString.safeParse(date);
  if (!parsedDate.success) return badRequest("invalid_date");
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = reasonBodySchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  if (parsedDate.data > vnToday()) return badRequest("future_date");
  if (subject.dailyGoalMinutes === null) return badRequest("goal_missing");
  if ((await dayTotal(db, subject.id, parsedDate.data)) >= subject.dailyGoalMinutes) return badRequest("goal_met");

  return guardStudy(async () => {
    await upsertReason(db, userId, subject.id, parsedDate.data, parsed.data.code, parsed.data.text);
    const [row] = await db
      .select({ code: studyDayReasons.code, text: studyDayReasons.text })
      .from(studyDayReasons)
      .where(and(eq(studyDayReasons.subjectId, subject.id), eq(studyDayReasons.reasonDate, parsedDate.data)));
    return NextResponse.json({ date: parsedDate.data, ...row });
  });
});

export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id, date } = await params;
  const subject = await findOwnedSubject(db, id, userId);
  if (!subject) return notFound();
  const parsedDate = dateString.safeParse(date);
  if (!parsedDate.success) return badRequest("invalid_date");

  await db.delete(studyDayReasons).where(and(eq(studyDayReasons.subjectId, subject.id), eq(studyDayReasons.reasonDate, parsedDate.data)));
  return NextResponse.json({ ok: true });
});
