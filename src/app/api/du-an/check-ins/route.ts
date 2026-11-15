import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { checkIns } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { vnToday } from "@/lib/vn-time";
import { addDays } from "@/lib/world-summary";
import { checkInDateError, checkInJson, checkInSchema, checkInValues } from "@/lib/health-input";
import { scheduleEconomySync } from "@/lib/economy-db";

// Check-in trưa / tối (đầu vào Sức khoẻ của kinh tế). Sáng: giấc ngủ ở /api/du-an/sleep, debuff ở /api/du-an/debuffs.
// GET ?days=14 (1–90): check-in gần nhất, mới trước, kèm `today`.
export const GET = withAuth(async (req, userId) => {
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 14));
  const today = vnToday();
  const rows = await db
    .select()
    .from(checkIns)
    .where(and(eq(checkIns.userId, userId), gte(checkIns.date, addDays(today, -(days - 1)))))
    .orderBy(desc(checkIns.date), desc(checkIns.slot));
  return NextResponse.json({ today, checkIns: rows.map(checkInJson) });
});

// PUT {date, slot: "noon", staminaSelf 1–5} | {date, slot: "evening", exerciseMinutes?, sportMinutes?, restDay?}: upsert theo (ngày, mốc).
export const PUT = withAuth(async (req, userId) => {
  const body = await req.json().catch(() => undefined);
  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const dateErr = checkInDateError(parsed.data.date, vnToday());
  if (dateErr) return NextResponse.json({ error: dateErr }, { status: 400 });
  const values = { ...checkInValues(parsed.data), updatedAt: new Date() };
  const [row] = await db
    .insert(checkIns)
    .values({ userId, date: parsed.data.date, slot: parsed.data.slot, ...values })
    .onConflictDoUpdate({ target: [checkIns.userId, checkIns.date, checkIns.slot], set: values })
    .returning();
  // Chỉ check-in tối là đầu vào Sức khoẻ (điểm tự chấm buổi trưa chưa dùng).
  if (parsed.data.slot === "evening") scheduleEconomySync(userId, { changedFrom: parsed.data.date });
  return NextResponse.json({ checkIn: checkInJson(row) });
});
