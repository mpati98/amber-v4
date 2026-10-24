import { NextResponse } from "next/server";
import { and, asc, eq, gt, inArray, isNotNull, not, or, sql, type SQLWrapper } from "drizzle-orm";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { EXPORT_PAGE, decodeCursor, encodeCursor, parseExportQuery } from "@/lib/brain-logs";
import { dedupeKey, eligibleCondition, eligibleReason, fullColumns } from "@/lib/brain-logs-db";

// Nguồn dữ liệu cho scripts/export_dataset.py của amber-brain: dòng ĐẦY ĐỦ của chính user, cũ trước, phân trang bằng con trỏ.
// eligible mặc định "all" giữ nguyên tập log export thô trước đây; true/false lọc theo eligibleCondition dùng chung với /stats.
export const GET = withAuth(async (req, userId) => {
  const query = parseExportQuery(req.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ error: query.error }, { status: 400 });
  const c = req.nextUrl.searchParams.get("cursor");
  const cursor = c ? decodeCursor(c) : null;
  if (c && !cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });

  const cursorCondition = (createdAt: SQLWrapper, id: SQLWrapper, after: { createdAt: Date; id: string }) =>
    or(
      gt(createdAt, after.createdAt),
      and(eq(createdAt, after.createdAt), gt(id, after.id))
    );
  const baseCondition = and(
    eq(agentLogs.userId, userId),
    eq(agentLogs.excludeFromTraining, false),
    query.value.route ? eq(agentLogs.route, query.value.route) : undefined,
    or(inArray(agentLogs.outcome, ["unknown", "accepted", "corrected"]), isNotNull(agentLogs.correctedOutput)),
  );
  const rows = query.value.eligible === "true"
    ? await (async () => {
        const eligibleRows = db.$with("eligible_export").as(
          db
            .select({
              ...fullColumns,
              eligibleReason: eligibleReason.as("eligibleReason"),
              rowNumber: sql<number>`row_number() over (
                partition by ${agentLogs.agent}, ${dedupeKey}
                order by ${agentLogs.createdAt}, ${agentLogs.id}
              )`.as("rowNumber"),
            })
            .from(agentLogs)
            .where(and(baseCondition, eligibleCondition))
        );
        return db
          .with(eligibleRows)
          .select()
          .from(eligibleRows)
          .where(and(
            eq(eligibleRows.rowNumber, 1),
            cursor ? cursorCondition(eligibleRows.createdAt, eligibleRows.id, cursor) : undefined
          ))
          .orderBy(asc(eligibleRows.createdAt), asc(eligibleRows.id))
          .limit(EXPORT_PAGE + 1);
      })()
    : await db
        .select({ ...fullColumns, eligibleReason, rowNumber: sql<number>`1` })
        .from(agentLogs)
        .where(
          and(
            baseCondition,
            query.value.eligible === "false" ? not(eligibleCondition) : undefined,
            cursor ? cursorCondition(agentLogs.createdAt, agentLogs.id, cursor) : undefined
          )
        )
        .orderBy(asc(agentLogs.createdAt), asc(agentLogs.id))
        .limit(EXPORT_PAGE + 1);

  const page = rows.slice(0, EXPORT_PAGE);
  const last = page[page.length - 1];
  return NextResponse.json({
    items: page.map((item) => {
      const { eligibleReason: reason, rowNumber, ...row } = item;
      void rowNumber;
      return {
        ...row,
        trainingTarget: row.correctedOutput ?? row.parsedOutput,
        eligible: reason !== null,
        eligibleReason: reason,
      };
    }),
    nextCursor: rows.length > EXPORT_PAGE && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});
