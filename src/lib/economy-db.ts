// Kinh tế — phần đụng DB: đối soát sự kiện từ dữ liệu thật và dựng lại sổ cái.
// Mọi thao tác của một user chạy trong MỘT transaction có khoá advisory theo user ⇒ hai lần đồng bộ song song
// không dựng chồng lên nhau. Logic tính toán nằm ở các file economy-* thuần (có unit test).

import fs from "node:fs";
import path from "node:path";
import { after } from "next/server";
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  checkIns,
  debuffs,
  economyEvents,
  exemptionCards,
  ledgerEntries,
  routineLogs,
  routines,
  ruleSets,
  sleepLogs,
  studyLogs,
  taskOccurrences,
  tasks,
  users,
} from "@/db/schema";
import { addDaysIso } from "@/lib/deadline-alert";
import { vnToday } from "@/lib/vn-time";
import { replay, staminaOn, type EconomyEvent, type LedgerEntry } from "@/lib/economy-engine";
import {
  buildEconomyContext,
  buildHealthSeries,
  type DebuffLevel,
  type DebuffSpan,
  type EconomyContext,
  type HealthDay,
  type HealthDayInput,
} from "@/lib/economy-health";
import { loadRuleSet, type RuleSet } from "@/lib/economy-rules";
import { diffEvents, minDate, routineLogToEvent, studyLogToEvent } from "@/lib/economy-sources";
import { amberOccurrenceToSource, amberTaskToSource, taskToEvent } from "@/lib/economy-tasks";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_RULES_FILE = path.join(process.cwd(), "economy", "rules.v1.yaml");
/** Ngày nhỏ hơn mọi ngày thật — "dựng lại từ đầu". */
const BEGINNING = "0001-01-01";

const compiledCache = new Map<string, RuleSet>();
function compile(yaml: string): RuleSet {
  let rs = compiledCache.get(yaml);
  if (!rs) {
    rs = loadRuleSet(yaml);
    compiledCache.set(yaml, rs);
  }
  return rs;
}

/** Bộ luật đang hiệu lực; user chưa có ⇒ cài bản mặc định (economy/rules.v1.yaml) làm `active`. */
async function activeRuleSet(tx: Tx, userId: string): Promise<RuleSet> {
  const [row] = await tx
    .select({ yaml: ruleSets.yaml })
    .from(ruleSets)
    .where(and(eq(ruleSets.userId, userId), eq(ruleSets.status, "active")))
    .limit(1);
  if (row) return compile(row.yaml);
  const yaml = fs.readFileSync(DEFAULT_RULES_FILE, "utf8");
  const rs = compile(yaml);
  await tx
    .insert(ruleSets)
    .values({ userId, version: rs.version, yaml, status: "active", proposedBy: "user", note: "Bộ luật mặc định", approvedAt: new Date() })
    .onConflictDoNothing();
  return rs;
}

/** Sự kiện mong muốn tính từ dữ liệu thật của các nguồn được quản lý. */
async function desiredEvents(tx: Tx, userId: string): Promise<EconomyEvent[]> {
  const [taskRows, occRows, cardRows, studyRows, workoutRows] = await Promise.all([
    tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        durationMinutes: tasks.durationMinutes,
        actualMinutes: tasks.actualMinutes,
        statusChangedAt: tasks.statusChangedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "DONE"))),
    tx
      .select({
        taskId: tasks.id,
        title: tasks.title,
        durationMinutes: tasks.durationMinutes,
        occurrenceDate: taskOccurrences.occurrenceDate,
        completedAt: taskOccurrences.completedAt,
      })
      .from(taskOccurrences)
      .innerJoin(tasks, eq(taskOccurrences.taskId, tasks.id))
      .where(and(eq(tasks.userId, userId), isNotNull(taskOccurrences.completedAt))),
    tx
      .select({ taskRef: exemptionCards.taskRef })
      .from(exemptionCards)
      .where(and(eq(exemptionCards.userId, userId), isNotNull(exemptionCards.taskRef))),
    tx
      .select({ id: studyLogs.id, minutes: studyLogs.minutes, createdAt: studyLogs.createdAt })
      .from(studyLogs)
      .where(eq(studyLogs.userId, userId)),
    tx
      .select({ id: routineLogs.id, logDate: routineLogs.logDate, durationMinutes: routineLogs.durationMinutes, createdAt: routineLogs.createdAt })
      .from(routineLogs)
      .innerJoin(routines, eq(routineLogs.routineId, routines.id))
      .where(and(eq(routines.userId, userId), eq(routines.kind, "WORKOUT"), isNotNull(routineLogs.durationMinutes))),
  ]);
  const cards = new Set(cardRows.map((c) => c.taskRef!));
  const out: EconomyEvent[] = [];
  for (const t of taskRows) {
    const ev = taskToEvent(amberTaskToSource(t), cards);
    if (ev) out.push(ev);
  }
  for (const o of occRows) {
    const ev = taskToEvent(amberOccurrenceToSource({ id: o.taskId, title: o.title, durationMinutes: o.durationMinutes }, o), cards);
    if (ev) out.push(ev);
  }
  for (const s of studyRows) out.push(studyLogToEvent(s));
  for (const w of workoutRows) {
    const ev = routineLogToEvent(w);
    if (ev) out.push(ev);
  }
  return out;
}

function rowToEvent(r: typeof economyEvents.$inferSelect): EconomyEvent {
  return { eventId: r.eventId, type: r.type, source: r.source as EconomyEvent["source"], occurredAt: r.occurredAt, data: r.data as Record<string, unknown> };
}

type HealthInputs = { inputs: Map<string, HealthDayInput>; debuffs: DebuffSpan[]; firstDate: string | null };

/** Đầu vào Sức khoẻ theo ngày: giấc ngủ, phút tập (check-in tối thắng; không có thì cộng buổi WORKOUT), ngày nghỉ, debuff. */
async function loadHealthInputs(tx: Tx, userId: string): Promise<HealthInputs> {
  const [sleep, workouts, evening, debuffRows] = await Promise.all([
    tx.select({ date: sleepLogs.date, minutes: sleepLogs.sleepMinutes, quality: sleepLogs.quality }).from(sleepLogs).where(eq(sleepLogs.userId, userId)),
    tx
      .select({ date: routineLogs.logDate, minutes: sql<number>`sum(${routineLogs.durationMinutes})::int` })
      .from(routineLogs)
      .innerJoin(routines, eq(routineLogs.routineId, routines.id))
      .where(and(eq(routines.userId, userId), eq(routines.kind, "WORKOUT"), isNotNull(routineLogs.durationMinutes)))
      .groupBy(routineLogs.logDate),
    tx
      .select({ date: checkIns.date, exercise: checkIns.exerciseMinutes, sport: checkIns.sportMinutes, rest: checkIns.restDay })
      .from(checkIns)
      .where(and(eq(checkIns.userId, userId), eq(checkIns.slot, "evening"))),
    tx.select({ level: debuffs.level, startedAt: debuffs.startedAt, endedAt: debuffs.endedAt }).from(debuffs).where(eq(debuffs.userId, userId)),
  ]);
  const inputs = new Map<string, HealthDayInput>();
  const get = (d: string) => {
    let v = inputs.get(d);
    if (!v) inputs.set(d, (v = { sleepMinutes: null, sleepQuality: null, exerciseMinutes: null, sportMinutes: null, restDay: false }));
    return v;
  };
  for (const s of sleep) Object.assign(get(s.date), { sleepMinutes: s.minutes, sleepQuality: s.quality });
  for (const w of workouts) get(w.date).exerciseMinutes = w.minutes;
  for (const c of evening) {
    const v = get(c.date);
    if (c.exercise != null) v.exerciseMinutes = c.exercise;
    if (c.sport != null) v.sportMinutes = c.sport;
    v.restDay = c.rest;
  }
  const spans = debuffRows.map((d) => ({ level: d.level as DebuffLevel, startedAt: d.startedAt, endedAt: d.endedAt }));
  const firstDate = minDate(...inputs.keys(), ...spans.map((d) => vnToday(d.startedAt)));
  return { inputs, debuffs: spans, firstDate };
}

type Context = { ctx: EconomyContext; series: HealthDay[] };

/** Chuỗi Sức khoẻ phủ từ dữ liệu sớm nhất (hoặc `from`) tới hôm nay / sự kiện muộn nhất. */
function buildContext(h: HealthInputs, rules: RuleSet, from: string | null, to: string): Context {
  const start = minDate(h.firstDate, from) ?? to;
  const series = buildHealthSeries(addDaysIso(start, -1), to, h.inputs, h.debuffs, rules.health);
  return { ctx: buildEconomyContext(series, h.debuffs, rules), series };
}

export type SyncResult = { upserted: number; removed: number; rebuiltFrom: string | null; entries: number; rulesVersion: number };

async function lockUser(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`economy:${userId}`}, 0))`);
}

/**
 * Đối soát sự kiện rồi dựng lại sổ cái từ ngày sớm nhất bị ảnh hưởng.
 * `changedFrom`: ngày VN mà đầu vào Sức khoẻ (giấc ngủ, check-in, debuff) vừa đổi — các entry từ đó phụ thuộc trạng thái nên phải dựng lại.
 * `full`: dựng lại toàn bộ lịch sử (vd sau khi đổi luật).
 */
export async function syncEconomy(userId: string, opts: { changedFrom?: string | null; full?: boolean } = {}): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    // User đã bị xoá (vd hook chạy sau khi xoá tài khoản) ⇒ không có gì để đồng bộ.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!owner) return { upserted: 0, removed: 0, rebuiltFrom: null, entries: 0, rulesVersion: 0 };
    const rules = await activeRuleSet(tx, userId);

    const existing = (await tx.select().from(economyEvents).where(eq(economyEvents.userId, userId))).map(rowToEvent);
    const diff = diffEvents(await desiredEvents(tx, userId), existing, vnToday);
    if (diff.remove.length) {
      await tx.delete(economyEvents).where(and(eq(economyEvents.userId, userId), inArray(economyEvents.eventId, diff.remove)));
    }
    for (const e of diff.upsert) {
      const values = { type: e.type, source: e.source, occurredAt: e.occurredAt, vnDate: vnToday(e.occurredAt), data: e.data, updatedAt: new Date() };
      await tx
        .insert(economyEvents)
        .values({ userId, eventId: e.eventId, ...values })
        .onConflictDoUpdate({ target: [economyEvents.userId, economyEvents.eventId], set: values });
    }

    // Bộ luật đổi (version khác với entry đang lưu) ⇒ dựng lại từ đầu.
    const versions = await tx.selectDistinct({ v: ledgerEntries.rulesVersion }).from(ledgerEntries).where(eq(ledgerEntries.userId, userId));
    const rulesChanged = versions.some((r) => r.v !== rules.version);
    const from = opts.full || rulesChanged ? BEGINNING : minDate(diff.earliest, opts.changedFrom);
    if (from === null) return { upserted: 0, removed: 0, rebuiltFrom: null, entries: 0, rulesVersion: rules.version };

    const entries = await rebuildFrom(tx, userId, rules, from);
    return { upserted: diff.upsert.length, removed: diff.remove.length, rebuiltFrom: from, entries, rulesVersion: rules.version };
  });
}

/** Xoá entry từ `from` trở đi, dựng lại với số dư mở đầu = tổng Nguyên Tệ trước `from`. Trả số entry đã ghi. */
async function rebuildFrom(tx: Tx, userId: string, rules: RuleSet, from: string): Promise<number> {
  await tx.delete(ledgerEntries).where(and(eq(ledgerEntries.userId, userId), gte(ledgerEntries.vnDate, from)));
  const [{ opening }] = await tx
    .select({ opening: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.key, "nguyen_te"), lt(ledgerEntries.vnDate, from)));
  const events = (
    await tx
      .select()
      .from(economyEvents)
      .where(and(eq(economyEvents.userId, userId), gte(economyEvents.vnDate, from)))
      .orderBy(asc(economyEvents.occurredAt), asc(economyEvents.eventId))
  ).map(rowToEvent);
  if (events.length === 0) return 0;

  const health = await loadHealthInputs(tx, userId);
  const lastDay = vnToday(events[events.length - 1].occurredAt);
  const { ctx } = buildContext(health, rules, vnToday(events[0].occurredAt), maxDate(lastDay, vnToday()));
  const result = replay(events, rules, ctx, Number(opening));
  const CHUNK = 500;
  for (let i = 0; i < result.entries.length; i += CHUNK) {
    await tx.insert(ledgerEntries).values(result.entries.slice(i, i + CHUNK).map((x) => toRow(userId, x)));
  }
  return result.entries.length;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

function toRow(userId: string, x: LedgerEntry): typeof ledgerEntries.$inferInsert {
  return {
    userId,
    eventId: x.eventId,
    ruleId: x.ruleId,
    rulesVersion: x.rulesVersion,
    key: x.key,
    rawAmount: x.rawAmount,
    amount: x.amount,
    shadow: x.shadow,
    source: x.source,
    occurredAt: x.occurredAt,
    vnDate: x.vnDate,
  };
}

/**
 * Lên lịch đồng bộ SAU khi trả response (không làm chậm thao tác ghi; lỗi không làm hỏng thao tác ghi).
 * Gọi ở route ghi nguồn dữ liệu. Không gọi được (ngoài request) thì chạy luôn, nuốt lỗi.
 */
export function scheduleEconomySync(userId: string, opts: { changedFrom?: string | null; full?: boolean } = {}) {
  const run = () =>
    syncEconomy(userId, opts).catch((err) => {
      // 23503: user bị xoá giữa chừng (FK) — bỏ qua. Chỉ log mã + thông báo của Postgres, không log tham số truy vấn.
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      if (cause?.code === "23503") return;
      console.error("Đồng bộ kinh tế lỗi:", cause?.code ?? "", cause?.message ?? (err instanceof Error ? err.message : String(err)));
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

export type EconomySummary = {
  today: string;
  rulesVersion: number;
  balance: number;
  stamina: { value: number; max: number };
  health: { value: number; base: number; prevDay: number };
  shadow: {
    /** true khi phạt hôm nay chưa trừ thật. */
    active: boolean;
    penaltiesLiveFrom: string | null;
    /** Số dư nếu mọi phạt (kể cả phạt bóng trước đây) đều đã trừ — để chỉnh hệ số. */
    balanceIfLive: number;
    hiddenPenalties: { count: number; total: number };
  };
  entries: Array<{
    eventId: string;
    eventType: string;
    ruleId: string;
    key: string;
    rawAmount: number;
    amount: number;
    shadow: boolean;
    source: string;
    occurredAt: string;
    vnDate: string;
  }>;
};

/**
 * Số dư, thể lực, sức khoẻ và nhật ký gần đây. Mặc định ẩn entry phạt bóng (UI chưa hiện phạt);
 * `includeShadow` để xem khi chỉnh hệ số.
 */
export async function economySummary(userId: string, opts: { limit?: number; includeShadow?: boolean } = {}): Promise<EconomySummary> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const rules = await activeRuleSet(tx, userId);
    const today = vnToday();
    const [eventRows, entryRows, health] = await Promise.all([
      tx.select().from(economyEvents).where(eq(economyEvents.userId, userId)).orderBy(asc(economyEvents.occurredAt), asc(economyEvents.eventId)),
      tx.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId)).orderBy(asc(ledgerEntries.occurredAt), asc(ledgerEntries.eventId), asc(ledgerEntries.ruleId)),
      loadHealthInputs(tx, userId),
    ]);
    const events = eventRows.map(rowToEvent);
    const first = events.length ? vnToday(events[0].occurredAt) : null;
    const last = events.length ? vnToday(events[events.length - 1].occurredAt) : today;
    const { ctx, series } = buildContext(health, rules, first, maxDate(last, today));
    const live = replay(events, rules, ctx, 0, { allPenaltiesLive: true });

    const typeOf = new Map(eventRows.map((e) => [e.eventId, e.type]));
    const shadowRows = entryRows.filter((x) => x.shadow);
    const todayHealth = series.find((h) => h.date === today);
    const dc = ctx.day(today);
    const visible = entryRows.filter((x) => opts.includeShadow || !x.shadow);
    const limit = opts.limit ?? 50;
    return {
      today,
      rulesVersion: rules.version,
      balance: round2(entryRows.reduce((s, x) => (x.key === "nguyen_te" ? s + x.amount : s), 0)),
      stamina: { value: staminaOn(today, entryRows, ctx), max: dc.staminaMax },
      health: { value: todayHealth?.health ?? dc.healthPrev, base: todayHealth?.base ?? dc.healthPrev, prevDay: dc.healthPrev },
      shadow: {
        active: rules.penalties_live_from == null || today < rules.penalties_live_from,
        penaltiesLiveFrom: rules.penalties_live_from,
        balanceIfLive: live.balance,
        hiddenPenalties: { count: shadowRows.length, total: round2(shadowRows.reduce((s, x) => s + x.rawAmount, 0)) },
      },
      entries: visible
        .slice(-limit)
        .reverse()
        .map((x) => ({
          eventId: x.eventId,
          eventType: typeOf.get(x.eventId) ?? "",
          ruleId: x.ruleId,
          key: x.key,
          rawAmount: x.rawAmount,
          amount: x.amount,
          shadow: x.shadow,
          source: x.source,
          occurredAt: x.occurredAt.toISOString(),
          vnDate: x.vnDate,
        })),
    };
  });
}

const round2 = (x: number) => Math.round(x * 100) / 100;
