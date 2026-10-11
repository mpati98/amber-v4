import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt, or } from "drizzle-orm";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { encodeCursor, parseListQuery } from "@/lib/brain-logs";
import { summaryColumns } from "@/lib/brain-logs-db";

// Danh sách nhật ký của chính user, mới nhất trước, phân trang bằng con trỏ (createdAt, id).
// Chỉ trả các trường tóm tắt; chi tiết đầy đủ ở GET /api/brain-logs/[id].
export const GET = withAuth(async (req, userId) => {
  const q = parseListQuery(req.nextUrl.searchParams);
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: 400 });
  const { agent, outcome, from, toExclusive, limit, cursor } = q.value;

  const rows = await db
    .select(summaryColumns)
    .from(agentLogs)
    .where(
      and(
        eq(agentLogs.userId, userId),
        agent ? eq(agentLogs.agent, agent) : undefined,
        outcome ? eq(agentLogs.outcome, outcome) : undefined,
        from ? gte(agentLogs.createdAt, from) : undefined,
        toExclusive ? lt(agentLogs.createdAt, toExclusive) : undefined,
        cursor
          ? or(
              lt(agentLogs.createdAt, cursor.createdAt),
              and(eq(agentLogs.createdAt, cursor.createdAt), lt(agentLogs.id, cursor.id))
            )
          : undefined
      )
    )
    .orderBy(desc(agentLogs.createdAt), desc(agentLogs.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return NextResponse.json({
    items: page,
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});
