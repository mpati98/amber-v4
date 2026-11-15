import { NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { debuffs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { clampClockSkew, debuffChangedFrom, debuffCreateSchema, debuffJson, debuffTimeError } from "@/lib/health-input";
import { scheduleEconomySync } from "@/lib/economy-db";

// Debuff (bệnh / trạng thái xấu): trừ thẳng Sức khoẻ và miễn phạt trễ hạn khi còn hiệu lực; chỉ nới luật, không phạt thêm.
// GET ?days=30 (1–90): debuff còn hiệu lực + debuff bắt đầu trong N ngày gần nhất, mới trước.
export const GET = withAuth(async (req, userId) => {
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select()
    .from(debuffs)
    .where(and(eq(debuffs.userId, userId), or(isNull(debuffs.endedAt), gte(debuffs.startedAt, since))))
    .orderBy(desc(debuffs.startedAt));
  return NextResponse.json({ debuffs: rows.map((r) => debuffJson(r, now)) });
});

// POST {level: light|medium|heavy, label?, startedAt? (ISO, mặc định bây giờ)} → 201. Hiệu lực tới khi PATCH endedAt.
export const POST = withAuth(async (req, userId) => {
  const body = await req.json().catch(() => undefined);
  const parsed = debuffCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const now = new Date();
  const startedAt = parsed.data.startedAt ? clampClockSkew(new Date(parsed.data.startedAt), now) : now;
  const timeErr = debuffTimeError(startedAt, null, now);
  if (timeErr) return NextResponse.json({ error: timeErr }, { status: 400 });
  const [row] = await db
    .insert(debuffs)
    .values({ userId, level: parsed.data.level, label: parsed.data.label || null, startedAt })
    .returning();
  scheduleEconomySync(userId, { changedFrom: debuffChangedFrom(startedAt) });
  return NextResponse.json({ debuff: debuffJson(row, now) }, { status: 201 });
});
