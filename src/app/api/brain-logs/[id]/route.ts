import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { activityLogs, agentLogs } from "@/db/schema";
import { patchSchema } from "@/lib/brain-logs";
import { fullColumns } from "@/lib/brain-logs-db";
import { logActivity } from "@/lib/activity-log";

type RouteParams = { params: Promise<{ id: string }> };

async function ownedId(params: RouteParams["params"]): Promise<string | null> {
  const { id } = await params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

// Một dòng đầy đủ. Dòng của user khác và id không tồn tại cùng trả 404.
export const GET = withAuth(async (_req, userId, { params }: RouteParams) => {
  const id = await ownedId(params);
  const [row] = id
    ? await db.select(fullColumns).from(agentLogs).where(and(eq(agentLogs.id, id), eq(agentLogs.userId, userId))).limit(1)
    : [];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
});

// Chỉ đổi excludeFromTraining và đáp án huấn luyện đã được kiểm tra; các trường log khác bị từ chối 400.
export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const id = await ownedId(params);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", details: parsed.error.issues }, { status: 400 });
  if (!id) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const changes = {
    ...(parsed.data.excludeFromTraining !== undefined ? { excludeFromTraining: parsed.data.excludeFromTraining } : {}),
    ...(parsed.data.correctedOutput !== undefined
      ? { correctedOutput: parsed.data.correctedOutput, correctedAt: parsed.data.correctedOutput === null ? null : new Date() }
      : {}),
  };
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(agentLogs)
      .set(changes)
      .where(and(eq(agentLogs.id, id), eq(agentLogs.userId, userId)))
      .returning({
        id: agentLogs.id,
        excludeFromTraining: agentLogs.excludeFromTraining,
        correctedOutput: agentLogs.correctedOutput,
        correctedAt: agentLogs.correctedAt,
        outcome: agentLogs.outcome,
      });
    if (updated && parsed.data.correctedOutput !== undefined) {
      await logActivity(
        {
          userId,
          source: "LEARN",
          action: parsed.data.correctedOutput === null ? "brain_log.correction_cleared" : "brain_log.corrected",
          title: parsed.data.correctedOutput === null ? "Đã xóa đáp án huấn luyện" : "Đã sửa đáp án huấn luyện",
          metadata: { logId: updated.id },
        },
        (values) => tx.insert(activityLogs).values(values)
      );
    }
    return updated;
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
});
