import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { keyResults } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { findOwnedStandardProject, withKrStats } from "@/lib/key-results";
import { patchKrSchema, resolveKrNumbers } from "@/lib/key-result-input";

type RouteParams = { params: Promise<{ id: string; krId: string }> };

const notFound = (error: "project_not_found" | "key_result_not_found") => NextResponse.json({ error }, { status: 404 });
const isUuid = (s: string) => z.string().uuid().safeParse(s).success;

/** Dự án STANDARD của user + KR thuộc đúng dự án đó; không thì trả sẵn response 404. */
async function loadOwned(userId: string, id: string, krId: string) {
  const project = isUuid(id) ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return { error: notFound("project_not_found") };
  const kr = isUuid(krId)
    ? await db.query.keyResults.findFirst({ where: and(eq(keyResults.id, krId), eq(keyResults.projectId, project.id)) })
    : undefined;
  if (!kr) return { error: notFound("key_result_not_found") };
  return { project, kr };
}

export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id, krId } = await params;
  const owned = await loadOwned(userId, id, krId);
  if (owned.error) return owned.error;
  const { kr } = owned;

  const parsed = patchKrSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "empty patch" }, { status: 400 });
  }

  const mode = (parsed.data.mode ?? kr.mode) as "AUTO" | "MANUAL";
  const nums = resolveKrNumbers(mode, parsed.data, { target: kr.target, current: kr.current });
  if (!nums.ok) return NextResponse.json({ error: nums.error }, { status: 400 });

  const [updated] = await db
    .update(keyResults)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
      mode,
      target: nums.target,
      current: nums.current,
    })
    .where(eq(keyResults.id, kr.id))
    .returning();
  const [view] = await withKrStats([updated]);
  return NextResponse.json(view);
});

export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id, krId } = await params;
  const owned = await loadOwned(userId, id, krId);
  if (owned.error) return owned.error;

  // Việc đang gắn vào KR tự thành không gắn (tasks.kr_id ON DELETE SET NULL).
  await db.delete(keyResults).where(eq(keyResults.id, owned.kr.id));
  return NextResponse.json({ ok: true });
});
