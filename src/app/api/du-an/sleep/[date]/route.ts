import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sleepLogs } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { dateString } from "@/lib/project-input";
import { scheduleEconomySync } from "@/lib/economy-db";

type RouteParams = { params: Promise<{ date: string }> };

// Xoá giấc ngủ của một đêm. Không có → 404 sleep_not_found.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { date } = await params;
  const parsed = dateString.safeParse(date);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const gone = await db.delete(sleepLogs).where(and(eq(sleepLogs.userId, userId), eq(sleepLogs.date, parsed.data))).returning({ id: sleepLogs.id });
  if (!gone.length) return NextResponse.json({ error: "sleep_not_found" }, { status: 404 });
  scheduleEconomySync(userId, { changedFrom: parsed.data });
  return NextResponse.json({ ok: true });
});
