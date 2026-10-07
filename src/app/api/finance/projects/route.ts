import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { logActivity } from "@/lib/activity-log";
import { ensureCurrentFinanceMonth } from "@/lib/finance-ops";

export const GET = withAuth(async (_req, userId) => {
  const rows = await db.query.projects.findMany({
    where: (p, { eq: eqOp, and: andOp }) => andOp(eqOp(p.userId, userId), eqOp(p.type, "FINANCE")),
    orderBy: (p, { desc }) => desc(p.startDate),
  });
  return NextResponse.json(rows);
});

// Idempotent: gọi bao nhiêu lần trong cùng 1 tháng cũng chỉ trả về đúng 1 project.
// Đồng thời tự archive project tháng cũ đã qua endDate — "kết thúc mỗi tháng" đúng nghĩa đen.
export const POST = withAuth(async (_req, userId) => {
  const result = await ensureCurrentFinanceMonth(userId);

  if (result.isNew) {
    await logActivity({
      userId,
      source: "FINANCE",
      action: "finance.month_started",
      title: result.project.name,
    });
  }

  return NextResponse.json(result.project, { status: 201 });
});
