import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { feedbackSchema } from "@/lib/brain-logs";

type RouteParams = { params: Promise<{ id: string }> };

// Đánh giá đúng/sai của người dùng: accepted | rejected. Ghi mốc outcomeAt để bản mới hơn thắng khi brain cũng đặt outcome.
export const POST = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const parsed = feedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const [row] = z.string().uuid().safeParse(id).success
    ? await db
        .update(agentLogs)
        .set({ outcome: parsed.data.outcome, outcomeAt: new Date() })
        .where(and(eq(agentLogs.id, id), eq(agentLogs.userId, userId)))
        .returning({ id: agentLogs.id, outcome: agentLogs.outcome })
    : [];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
});
