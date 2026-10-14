import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { studyCourseSections, studyCourses } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { logActivity } from "@/lib/activity-log";
import { badRequest, createCourseSchema, invalidBody, MAX_SECTIONS, readJson } from "@/lib/study-input";
import { parseSections } from "@/lib/study-sections-parse";
import {
  afterStatusChange,
  courseSections,
  courseView,
  courseViews,
  findOwnedSubject,
  guardStudy,
  isUuid,
  snapshotBaselinesIfStarted,
  statusColumns,
  type CourseRow,
} from "@/lib/study-courses";

const STATUS_RANK = { ACTIVE: 0, QUEUED: 1, WISHLIST: 2, DONE: 3 } as const;
const statusSchema = z.enum(["WISHLIST", "QUEUED", "ACTIVE", "DONE"]);
const time = (d: Date | null) => d?.getTime() ?? 0;

// Thứ tự: ACTIVE, QUEUED theo hàng chờ, WISHLIST mới nhất trước, DONE xong gần nhất trước.
function sortCourses(rows: CourseRow[]): CourseRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (a.status === "QUEUED") return (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity) || time(a.createdAt) - time(b.createdAt);
    if (a.status === "DONE") return time(b.finishedAt) - time(a.finishedAt);
    return time(b.createdAt) - time(a.createdAt);
  });
}

export const GET = withAuth(async (req, userId) => {
  const sp = req.nextUrl.searchParams;
  const subjectId = sp.get("subjectId");
  if (subjectId !== null && !isUuid(subjectId)) return badRequest("invalid_subject_id");
  const statuses = z.array(statusSchema).safeParse(sp.getAll("status"));
  if (!statuses.success) return badRequest("invalid_status");

  const rows = await db
    .select()
    .from(studyCourses)
    .where(
      and(
        eq(studyCourses.userId, userId),
        subjectId ? eq(studyCourses.subjectId, subjectId) : undefined,
        statuses.data.length ? inArray(studyCourses.status, statuses.data) : undefined
      )
    )
    .orderBy(desc(studyCourses.createdAt));
  return NextResponse.json(await courseViews(db, userId, sortCourses(rows)));
});

export const POST = withAuth(async (req, userId) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = createCourseSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const d = parsed.data;

  const subject = await findOwnedSubject(db, d.subjectId, userId);
  if (!subject) return NextResponse.json({ error: "subject_not_found" }, { status: 404 });

  if (d.sections !== undefined && d.sectionsText !== undefined) return badRequest("sections_conflict");
  let sections = d.sections ?? [];
  if (d.sectionsText !== undefined) {
    const result = parseSections(d.sectionsText);
    if (result.skipped.length > 0) return NextResponse.json({ error: "sections_unparsed", skipped: result.skipped }, { status: 400 });
    if (result.sections.length > MAX_SECTIONS) return badRequest("too_many_sections");
    sections = result.sections;
  }

  return guardStudy(async () => {
    const status = d.status ?? "QUEUED";
    const created = await db.transaction(async (tx) => {
      const now = new Date();
      const [course] = await tx
        .insert(studyCourses)
        .values({
          userId,
          subjectId: subject.id,
          title: d.title,
          instructor: d.instructor ?? null,
          platform: d.platform ?? null,
          url: d.url ?? null,
          targetPrice: d.targetPrice ?? null,
          note: d.note ?? null,
          ...(await statusColumns(tx, subject.id, status, null, now)),
        })
        .returning();
      if (sections.length > 0) {
        await tx.insert(studyCourseSections).values(sections.map((s, i) => ({ courseId: course.id, position: i, title: s.title, durationMinutes: s.durationMinutes })));
      }
      await afterStatusChange(tx, subject.id, status);
      await snapshotBaselinesIfStarted(tx, subject.id);
      const [fresh] = await tx.select().from(studyCourses).where(eq(studyCourses.id, course.id));
      return { view: await courseView(tx, userId, fresh), sections: await courseSections(tx, course.id) };
    });

    logActivity({ userId, source: "TRA_DINH", action: "study_course.created", title: `Thêm khóa học: ${d.title}`, metadata: { courseId: created.view.id, subjectId: subject.id } });
    return NextResponse.json({ ...created.view, sections: created.sections }, { status: 201 });
  });
});
