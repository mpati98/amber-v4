import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { keyResults } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { findOwnedStandardProject, listKeyResults, withKrStats } from "@/lib/key-results";
import { createKrSchema, resolveKrNumbers } from "@/lib/key-result-input";

type RouteParams = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "project_not_found" }, { status: 404 });

export const GET = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const project = z.string().uuid().safeParse(id).success ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return notFound();
  return NextResponse.json(await listKeyResults(project.id));
});

export const POST = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const project = z.string().uuid().safeParse(id).success ? await findOwnedStandardProject(id, userId) : null;
  if (!project) return notFound();

  const parsed = createKrSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const nums = resolveKrNumbers(parsed.data.mode, parsed.data);
  if (!nums.ok) return NextResponse.json({ error: nums.error }, { status: 400 });

  const [created] = await db
    .insert(keyResults)
    .values({
      projectId: project.id,
      name: parsed.data.name,
      mode: parsed.data.mode,
      unit: parsed.data.unit ?? null,
      target: nums.target,
      current: nums.current,
    })
    .returning();
  const [view] = await withKrStats([created]);
  return NextResponse.json(view, { status: 201 });
});
