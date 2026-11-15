import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { checkIns } from "@/db/schema";
import { withAuth } from "@/lib/withAuth";
import { dateString } from "@/lib/project-input";
import { checkInSlot } from "@/lib/health-input";
import { scheduleEconomySync } from "@/lib/economy-db";

type RouteParams = { params: Promise<{ date: string; slot: string }> };

// Xoá một check-in. Không có → 404 checkin_not_found.
export const DELETE = withAuth(async (_req, userId, { params }: RouteParams) => {
  const { date, slot } = await params;
  const d = dateString.safeParse(date);
  const s = checkInSlot.safeParse(slot);
  if (!d.success || !s.success) return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  const gone = await db
    .delete(checkIns)
    .where(and(eq(checkIns.userId, userId), eq(checkIns.date, d.data), eq(checkIns.slot, s.data)))
    .returning({ id: checkIns.id });
  if (!gone.length) return NextResponse.json({ error: "checkin_not_found" }, { status: 404 });
  if (s.data === "evening") scheduleEconomySync(userId, { changedFrom: d.data });
  return NextResponse.json({ ok: true });
});
