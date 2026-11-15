import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { debuffs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { clampClockSkew, debuffChangedFrom, debuffJson, debuffPatchSchema, debuffTimeError } from "@/lib/health-input";
import { scheduleEconomySync } from "@/lib/economy-db";

type RouteParams = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "debuff_not_found" }, { status: 404 });

async function findOwned(id: string, userId: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(debuffs).where(and(eq(debuffs.id, id), eq(debuffs.userId, userId))).limit(1);
  return row ?? null;
}

// PATCH {level?, label?, endedAt? (ISO = hết từ lúc đó, null = mở lại)}.
export const PATCH = withAuth(async (req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const existing = await findOwned(id, userId);
  if (!existing) return notFound();
  const body = await req.json().catch(() => undefined);
  const parsed = debuffPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const now = new Date();
  const endedAt = parsed.data.endedAt === undefined ? existing.endedAt : parsed.data.endedAt === null ? null : clampClockSkew(new Date(parsed.data.endedAt), now);
  // Debuff cũ (> 60 ngày) vẫn được đánh dấu hết: chỉ kiểm thứ tự / tương lai của endedAt.
  const timeErr = debuffTimeError(existing.startedAt, endedAt, now);
  if (timeErr && timeErr !== "too_old") return NextResponse.json({ error: timeErr }, { status: 400 });
  const [row] = await db
    .update(debuffs)
    .set({
      ...(parsed.data.level !== undefined ? { level: parsed.data.level } : {}),
      ...(parsed.data.label !== undefined ? { label: parsed.data.label || null } : {}),
      endedAt,
    })
    .where(eq(debuffs.id, existing.id))
    .returning();
  // Đổi mức ⇒ ảnh hưởng từ lúc bắt đầu; chỉ đổi lúc hết ⇒ từ mốc sớm hơn giữa lúc hết cũ / mới.
  const levelChanged = parsed.data.level !== undefined && parsed.data.level !== existing.level;
  const endChanged = (existing.endedAt?.getTime() ?? null) !== (endedAt?.getTime() ?? null);
  if (levelChanged) scheduleEconomySync(userId, { changedFrom: debuffChangedFrom(existing.startedAt) });
  else if (endChanged) scheduleEconomySync(userId, { changedFrom: debuffChangedFrom(existing.endedAt ?? now, endedAt ?? now) });
  return NextResponse.json({ debuff: debuffJson(row, now) });
});

// Xoá hẳn (nhập nhầm). Đánh dấu hết dùng PATCH endedAt.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { id } = await params;
  const existing = await findOwned(id, userId);
  if (!existing) return notFound();
  await db.delete(debuffs).where(eq(debuffs.id, existing.id));
  scheduleEconomySync(userId, { changedFrom: debuffChangedFrom(existing.startedAt) });
  return NextResponse.json({ ok: true });
});
