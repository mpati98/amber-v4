// Nạp dữ liệu cho GET /api/kieu-lau/world (màn chủ 3D): 5 chỉ số + sự kiện mới từ nhật ký hoạt động.
// Công thức nằm ở lib/world-stats.ts (hàm thuần, có test).
import { and, asc, desc, eq, gt, gte, inArray, lte, max, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, agentLogs, financeBudgets, financeTransactions, projects, publications, readingGoals, routineLogs, routines, skillScores, sleepLogs,
} from "@/db/schema";
import { vnMonthBounds, vnToday, vnYear } from "@/lib/vn-time";
import { activityEvent, heThong, kyNang, nganKho, sinhLuc, triThuc, type WorldEvent, type WorldStat, type WorldStatKey } from "@/lib/world-stats";

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const MAX_EVENTS = 30;

export async function loadWorldStats(userId: string, now: Date = new Date()): Promise<Record<WorldStatKey, WorldStat>> {
  const today = vnToday(now), year = vnYear(now), { start: monthStart } = vnMonthBounds(now);

  const [lastSleep, workout, finance, goal, books, scores, brain] = await Promise.all([
    db.query.sleepLogs.findFirst({ where: eq(sleepLogs.userId, userId), orderBy: desc(sleepLogs.date) }),
    db.select({ minutes: sum(routineLogs.durationMinutes) }).from(routineLogs)
      .innerJoin(routines, eq(routines.id, routineLogs.routineId))
      .where(and(eq(routines.userId, userId), eq(routines.kind, "WORKOUT"), gte(routineLogs.logDate, addDays(today, -6)), lte(routineLogs.logDate, today))),
    loadMonthBudget(userId, monthStart),
    db.query.readingGoals.findFirst({ where: eq(readingGoals.year, year) }),
    // Tàng Kinh Các không có user_id (thiết kế 1 người dùng) — giống mọi route sách
    db.select({ status: publications.status, dateFinished: publications.dateFinished, currentPage: publications.currentPage, totalPages: publications.totalPages })
      .from(publications).where(inArray(publications.status, ["READ", "READING"])),
    db.select({ score: skillScores.score }).from(skillScores).where(eq(skillScores.userId, userId)),
    db.select({ at: max(agentLogs.receivedAt) }).from(agentLogs).where(eq(agentLogs.userId, userId)),
  ]);

  const finished = books.filter((b) => b.status === "READ" && b.dateFinished && b.dateFinished.slice(0, 4) === String(year)).length;
  const partial = books
    .filter((b) => b.status === "READING" && b.currentPage && b.totalPages && b.totalPages > 0)
    .reduce((s, b) => s + Math.min(1, b.currentPage! / b.totalPages!), 0);
  const dayOfYear = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000) + 1;
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const brainAt = brain[0]?.at ?? null;

  return {
    sinhLuc: sinhLuc({
      lastSleep: lastSleep ? { date: lastSleep.date, minutes: lastSleep.sleepMinutes, quality: lastSleep.quality } : null,
      today,
      workoutMinutes7d: Number(workout[0]?.minutes ?? 0),
    }),
    nganKho: nganKho(finance),
    triThuc: triThuc({ targetBooks: goal?.targetBooks ?? null, finished, partial, dayOfYear, daysInYear }),
    kyNang: kyNang(scores.map((s) => s.score)),
    heThong: heThong(brainAt ? new Date(brainAt) : null, now),
  };
}

async function loadMonthBudget(userId: string, monthStart: string) {
  const month = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.type, "FINANCE"), eq(projects.startDate, monthStart)),
  });
  if (!month) return { hasMonth: false, limitTotal: 0, spentInBudgeted: 0 };
  const budgets = await db.select({ categoryId: financeBudgets.categoryId, limit: financeBudgets.limitAmount })
    .from(financeBudgets).where(and(eq(financeBudgets.userId, userId), eq(financeBudgets.projectId, month.id)));
  if (!budgets.length) return { hasMonth: true, limitTotal: 0, spentInBudgeted: 0 };
  const [spent] = await db.select({ total: sum(financeTransactions.amount) }).from(financeTransactions).where(and(
    eq(financeTransactions.userId, userId), eq(financeTransactions.projectId, month.id), eq(financeTransactions.kind, "EXPENSE"),
    inArray(financeTransactions.categoryId, budgets.map((b) => b.categoryId)),
  ));
  return { hasMonth: true, limitTotal: budgets.reduce((s, b) => s + Number(b.limit), 0), spentInBudgeted: Number(spent?.total ?? 0) };
}

/**
 * Sự kiện từ nhật ký hoạt động. `since` (ISO) = mốc client đã xem tới: trả mọi dòng sau mốc (cũ trước, tối đa 30).
 * Không có `since` (lần đầu) thì chỉ trả 3 dòng gần nhất để màn không trống mà cũng không dội cả lịch sử.
 */
export async function loadWorldEvents(userId: string, since: string | null): Promise<{ events: WorldEvent[]; cursor: string | null }> {
  const cols = { id: activityLogs.id, source: activityLogs.source, action: activityLogs.action, title: activityLogs.title, createdAt: activityLogs.createdAt };
  const rows = since
    ? await db.select(cols).from(activityLogs).where(and(eq(activityLogs.userId, userId), gt(activityLogs.createdAt, sql`${since}::timestamptz`)))
      .orderBy(asc(activityLogs.createdAt), asc(activityLogs.id)).limit(MAX_EVENTS)
    : (await db.select(cols).from(activityLogs).where(eq(activityLogs.userId, userId)).orderBy(desc(activityLogs.createdAt)).limit(3)).reverse();
  const last = rows.at(-1);
  // Con trỏ giữ nguyên micro giây của Postgres (Date của JS chỉ có mili giây → dòng cùng mili giây bị đọc lại mãi)
  let cursor: string | null = since;
  if (last) {
    const [r] = await db.select({ t: sql<string>`to_char(${activityLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
      .from(activityLogs).where(eq(activityLogs.id, last.id));
    cursor = r?.t ?? last.createdAt.toISOString();
  }
  return { events: rows.map(activityEvent), cursor };
}
