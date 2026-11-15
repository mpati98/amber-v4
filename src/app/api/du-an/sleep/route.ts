import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { sleepLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { vnToday } from "@/lib/vn-time";
import { addDays } from "@/lib/world-summary";
import { sleepDateError, sleepJson, sleepLogSchema } from "@/lib/sleep-input";

// Giấc ngủ tự ghi mỗi sáng (chỉ số Sinh lực). `date` = ngày thức dậy theo lịch VN.
// GET ?days=14 (1–90): các đêm gần nhất, mới trước, kèm `today`.
export const GET = withAuth(async (req, userId) => {
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 14));
  const today = vnToday();
  const rows = await db.query.sleepLogs.findMany({
    where: and(eq(sleepLogs.userId, userId), gte(sleepLogs.date, addDays(today, -(days - 1)))),
    orderBy: desc(sleepLogs.date),
  });
  return NextResponse.json({ today, logs: rows.map(sleepJson) });
});

// PUT {date, sleepMinutes 0–1440, quality? 1–5, note?}: ghi hoặc sửa đêm đó (upsert theo user + ngày).
export const PUT = withAuth(async (req, userId) => {
  const body = await req.json().catch(() => undefined);
  const parsed = sleepLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { date, sleepMinutes, quality = null, note = null } = parsed.data;
  const dateErr = sleepDateError(date, vnToday());
  if (dateErr) return NextResponse.json({ error: dateErr }, { status: 400 });
  const values = { sleepMinutes, quality, note: note || null, updatedAt: new Date() };
  const [row] = await db.insert(sleepLogs).values({ userId, date, ...values })
    .onConflictDoUpdate({ target: [sleepLogs.userId, sleepLogs.date], set: values })
    .returning();
  return NextResponse.json({ log: sleepJson(row) });
});
