import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { dedupeKey, eligibleCondition } from "@/lib/brain-logs-db";

// Số dòng theo agent × outcome, và số mẫu đủ điều kiện làm dữ liệu huấn luyện theo agent (đã bỏ trùng như export).
export const GET = withAuth(async (_req, userId) => {
  const [counts, eligible] = await Promise.all([
    db
      .select({ agent: agentLogs.agent, outcome: agentLogs.outcome, n: sql<number>`count(*)::int` })
      .from(agentLogs)
      .where(eq(agentLogs.userId, userId))
      .groupBy(agentLogs.agent, agentLogs.outcome),
    db
      .select({ agent: agentLogs.agent, n: sql<number>`count(distinct ${dedupeKey})::int` })
      .from(agentLogs)
      .where(and(eq(agentLogs.userId, userId), eligibleCondition))
      .groupBy(agentLogs.agent),
  ]);

  const byAgent: Record<string, { total: number; outcomes: Record<string, number>; eligible: number }> = {};
  const slot = (a: string) => (byAgent[a] ??= { total: 0, outcomes: {}, eligible: 0 });
  for (const c of counts) {
    const s = slot(c.agent);
    s.outcomes[c.outcome] = c.n;
    s.total += c.n;
  }
  for (const e of eligible) slot(e.agent).eligible = e.n;

  const agents = Object.keys(byAgent).sort();
  return NextResponse.json({
    total: agents.reduce((n, a) => n + byAgent[a].total, 0),
    eligible: agents.reduce((n, a) => n + byAgent[a].eligible, 0),
    byAgent: agents.map((agent) => ({ agent, ...byAgent[agent] })),
  });
});
