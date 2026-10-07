import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { z } from "zod";
import { dateString, endBeforeStart, PROJECT_STATUSES } from "@/lib/project-input";

const createProjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  // Không giới hạn cứng vào 1 danh sách — cho phép thêm loại project đặc biệt mới (FINANCE, LEARN,...)
  // sau này mà không cần sửa lại API.
  type: z.string().min(1).optional(),
  goal: z.string().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

export const GET = withAuth(async (req, userId) => {
  const type = req.nextUrl.searchParams.get("type");
  const statusParam = req.nextUrl.searchParams.get("status");

  // STANDARD: cột status quyết định trạng thái, không lọc archivedAt.
  if (type === "STANDARD") {
    const status = statusParam ? z.enum(PROJECT_STATUSES).safeParse(statusParam) : null;
    if (status && !status.success) {
      return NextResponse.json({ error: status.error.flatten() }, { status: 400 });
    }
    const rows = await db.query.projects.findMany({
      where: (p, { eq, and }) =>
        status?.success
          ? and(eq(p.userId, userId), eq(p.type, "STANDARD"), eq(p.status, status.data))
          : and(eq(p.userId, userId), eq(p.type, "STANDARD")),
      orderBy: (p, { desc }) => desc(p.createdAt),
    });
    return NextResponse.json(rows);
  }

  const rows = await db.query.projects.findMany({
    where: (p, { eq, isNull, and }) =>
      type
        ? and(eq(p.userId, userId), isNull(p.archivedAt), eq(p.type, type))
        : and(eq(p.userId, userId), isNull(p.archivedAt)),
  });
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req, userId) => {
  const body = await req.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (endBeforeStart(parsed.data.startDate, parsed.data.endDate)) {
    return NextResponse.json({ error: "end_before_start" }, { status: 400 });
  }
  const [created] = await db
    .insert(projects)
    .values({ ...parsed.data, userId })
    .returning();
  return NextResponse.json(created, { status: 201 });
});
