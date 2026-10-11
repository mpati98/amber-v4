import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { patchSchema } from "@/lib/brain-logs";
import { fullColumns } from "@/lib/brain-logs-db";

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

// Chỉ đổi được excludeFromTraining; mọi trường khác (kể cả nội dung log) bị từ chối 400.
export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const id = await ownedId(params);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const [row] = id
    ? await db
        .update(agentLogs)
        .set({ excludeFromTraining: parsed.data.excludeFromTraining })
        .where(and(eq(agentLogs.id, id), eq(agentLogs.userId, userId)))
        .returning({ id: agentLogs.id, excludeFromTraining: agentLogs.excludeFromTraining })
    : [];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
});
