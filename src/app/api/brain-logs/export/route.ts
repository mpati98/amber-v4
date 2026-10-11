import { NextResponse } from "next/server";
import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { EXPORT_PAGE, decodeCursor, encodeCursor } from "@/lib/brain-logs";
import { fullColumns } from "@/lib/brain-logs-db";

// Nguồn dữ liệu cho scripts/export_dataset.py của amber-brain: dòng ĐẦY ĐỦ của chính user, cũ trước, phân trang bằng con trỏ.
// Chỉ trả dòng còn khả năng thành mẫu (chưa bị loại, outcome unknown/accepted/corrected); brain tự áp quy tắc chọn mẫu chi tiết.
export const GET = withAuth(async (req, userId) => {
  const c = req.nextUrl.searchParams.get("cursor");
  const cursor = c ? decodeCursor(c) : null;
  if (c && !cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });

  const rows = await db
    .select(fullColumns)
    .from(agentLogs)
    .where(
      and(
        eq(agentLogs.userId, userId),
        eq(agentLogs.excludeFromTraining, false),
        inArray(agentLogs.outcome, ["unknown", "accepted", "corrected"]),
        cursor
          ? or(
              gt(agentLogs.createdAt, cursor.createdAt),
              and(eq(agentLogs.createdAt, cursor.createdAt), gt(agentLogs.id, cursor.id))
            )
          : undefined
      )
    )
    .orderBy(asc(agentLogs.createdAt), asc(agentLogs.id))
    .limit(EXPORT_PAGE + 1);

  const page = rows.slice(0, EXPORT_PAGE);
  const last = page[page.length - 1];
  return NextResponse.json({
    items: page,
    nextCursor: rows.length > EXPORT_PAGE && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});
