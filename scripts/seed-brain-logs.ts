import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { agentLogs, users } from "@/db/schema";
import { signAccessToken } from "@/lib/mobile-auth";

const API_BASE = "http://localhost:3000";
const API_ENDPOINT = `${API_BASE}/api/brain-logs`;
const SEED_SESSION_ID = "seed-brain-logs-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_COUNTS = [
  ["expense_add", 80],
  ["expense_query", 40],
  ["clarify", 40],
  ["tutor", 40],
  ["chitchat", 40],
  ["task_add", 10],
  ["task_list", 10],
  ["task_complete", 10],
  ["news", 10],
] as const;
const OUTCOMES = ["accepted", "rejected", "retried", "unknown-old", "unknown-new"] as const;
const CLOUD_MODEL = "openai/gpt-oss-120b";

type Action =
  | "expense_add"
  | "expense_query"
  | "clarify"
  | "tutor"
  | "chitchat"
  | "task_add"
  | "task_list"
  | "task_complete"
  | "news";
type SeedRow = typeof agentLogs.$inferInsert;
type JsonObject = Record<string, unknown>;

const host = (value?: string) => {
  try {
    return new URL(value ?? "").hostname;
  } catch {
    return "";
  }
};

const userId = process.env.BRAIN_LOG_SEED_USER_ID ?? "";
if (!process.env.DATABASE_URL || host(process.env.DATABASE_URL) === host(process.env.DATABASE_URL_PRODUCTION)) {
  console.error("Refusing to run: DATABASE_URL is missing or matches the configured production host.");
  process.exit(3);
}
if (!UUID_PATTERN.test(userId)) {
  console.error("Refusing to run: set BRAIN_LOG_SEED_USER_ID to the intended DEV user's UUID.");
  process.exit(3);
}

const userMarker = createHash("sha256").update(userId).digest("hex").slice(0, 12);
const seedKey = (key: string) => `${SEED_SESSION_ID}:${userMarker}:${key}`;

function uuidFor(key: string): string {
  const hex = createHash("sha256").update(`amber-brain-log-seed:${userId}:${key}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function correctionFor(target: JsonObject, index: number): JsonObject {
  const corrected = { ...target };
  switch (target.action) {
    case "expense_add":
      corrected.note = `Corrected demo note ${index}`;
      break;
    case "expense_query":
      corrected.range_text = "this month";
      break;
    case "clarify":
      corrected.reply = `Could you clarify one detail for demo ${index}?`;
      break;
    case "tutor":
      corrected.text = `Corrected demo sentence ${index}.`;
      break;
    case "chitchat":
      corrected.reply = `Corrected friendly demo reply ${index}.`;
      break;
    case "task_add":
      corrected.title = `Corrected demo task ${index}`;
      break;
    case "task_list":
      corrected.range_text = "this week";
      break;
    case "task_complete":
      corrected.title = `Corrected completed task ${index}`;
      break;
    case "news":
      corrected.topic = `Demo topic ${index}`;
      break;
  }
  return corrected;
}

function targetFor(action: Action, index: number): JsonObject {
  switch (action) {
    case "expense_add":
      return {
        action,
        type: "expense",
        amount_text: `${10 + (index % 90)} dollars`,
        category: "Food",
        note: `Demo lunch item ${index}`,
        date_text: null,
      };
    case "expense_query":
      return { action, type: "expense", category: "Food", range_text: "last week" };
    case "clarify":
      return {
        action,
        intent: "task_add",
        missing: ["system", "title"],
        reply: "Is this for your work or personal list, and what should I call the task?",
      };
    case "tutor":
      return index < 20
        ? { action, mode: "correct", text: `I went to the demo shop ${index}.` }
        : { action, mode: "explain", text: `Explain this demo phrase ${index}.` };
    case "chitchat":
      return { action, reply: `Hello! Here is a friendly demo reply ${index}.` };
    case "task_add":
      return {
        action,
        system: index % 2 === 0 ? "work" : "personal",
        title: `Demo task ${index}`,
        deadline_text: null,
      };
    case "task_list":
      return { action, system: index % 2 === 0 ? "work" : null, range_text: "today" };
    case "task_complete":
      return { action, title: `Demo completed task ${index}` };
    case "news":
      return { action, topic: `demo science topic ${index}`, range_text: "this week" };
  }
}

function userInputFor(action: Action, index: number): string {
  switch (action) {
    case "expense_add":
      return `I spent ${10 + (index % 90)} dollars on lunch item ${index}.`;
    case "expense_query":
      return `How much did I spend on groceries in demo week ${index}?`;
    case "clarify":
      return index % 2 === 0
        ? `I need to follow up on an unspecified work task ${index}.`
        : `I need to do an unspecified personal task ${index}.`;
    case "tutor":
      return index < 20
        ? `Please correct this demo sentence ${index}: "I goed home."`
        : `Please explain this demo phrase ${index}.`;
    case "chitchat":
      return `Hello Amber, how is your demo day ${index}?`;
    case "task_add":
      return `Add demo ${index} to my ${index % 2 === 0 ? "work" : "personal"} tasks.`;
    case "task_list":
      return `Show my demo tasks for today, set ${index}.`;
    case "task_complete":
      return `Mark demo task ${index} as complete.`;
    case "news":
      return `What is new about demo science topic ${index}?`;
  }
}

function routeFor(action: Action, index: number): "LOCAL" | "CLOUD" | null {
  if (action === "chitchat" || action === "tutor") return "CLOUD";
  if (action === "news" && index < 3) return null;
  if (action === "task_list" && index === 0) return null;
  return "LOCAL";
}

function agentFor(action: Action): string {
  if (action === "expense_add" || action === "expense_query") return "expense";
  if (action === "task_add" || action === "task_list" || action === "task_complete") return "task";
  return "chat";
}

function buildRow(
  key: string,
  action: Action,
  index: number,
  createdAt: Date,
  outcome: SeedRow["outcome"],
  options: {
    corrected?: boolean;
    excluded?: boolean;
    blocked?: boolean;
    userInput?: string;
    parsedOutput?: unknown;
  } = {},
): SeedRow {
  const target = targetFor(action, index);
  const correctedOutput = options.corrected ? correctionFor(target, index) : null;
  const route = routeFor(action, index);
  const userInput = options.userInput ?? userInputFor(action, index);
  const toolOk = outcome === "unknown" ? createdAt.getTime() < Date.now() - 3 * 864e5 : null;
  return {
    id: uuidFor(key),
    userId,
    createdAt,
    sessionId: seedKey(key),
    turnIndex: index,
    agent: agentFor(action),
    source: "agent",
    lang: "en",
    modelName: "amber-gemma4",
    adapterVersion: "seed-test",
    promptVersion: "gemma-v1",
    userInput,
    messages: [
      { role: "system", content: "Synthetic seed data for UI testing only." },
      { role: "user", content: userInput },
    ],
    tools: [],
    rawOutput: JSON.stringify(target),
    parsedOutput: options.parsedOutput === undefined ? target : options.parsedOutput,
    parseOk: options.parsedOutput === undefined,
    toolName: null,
    toolArgs: null,
    toolResult: {
      route,
      cloud_used: route === "CLOUD",
      blocked_credential: options.blocked === true,
    },
    toolOk,
    error: null,
    latencyMs: 20 + (index % 120),
    promptTokens: 100,
    completionTokens: 30,
    route,
    cloudModel: route === "CLOUD" ? CLOUD_MODEL : null,
    outcome,
    outcomeAt: createdAt,
    correctedOutput,
    correctedAt: correctedOutput ? createdAt : null,
    excludeFromTraining: options.excluded === true,
  };
}

function makeSeedRows(now = new Date()): SeedRow[] {
  const rows: SeedRow[] = [];
  let ordinal = 0;
  for (const [action, count] of ACTION_COUNTS) {
    for (let index = 0; index < count; index++) {
      const outcomeKind = OUTCOMES[ordinal % OUTCOMES.length];
      const daysAgo = outcomeKind === "unknown-old"
        ? 4 + (ordinal % 10)
        : outcomeKind === "unknown-new"
          ? ordinal % 3
          : ordinal % 14;
      const createdAt = new Date(now.getTime() - daysAgo * 864e5 - (ordinal % 24) * 3600e3);
      const outcome = outcomeKind.startsWith("unknown") ? "unknown" : outcomeKind;
      rows.push(buildRow(
        `base-${action}-${index}`,
        action,
        index,
        createdAt,
        outcome,
        { corrected: ordinal < 40, excluded: ordinal < 5 },
      ));
      ordinal++;
    }
  }

  for (let index = 0; index < 5; index++) {
    rows.push(buildRow(
      `blocked-${index}`,
      "chitchat",
      index,
      new Date(now.getTime() - (5 + index) * 864e5),
      "accepted",
      {
        blocked: true,
        userInput: `Synthetic blocked credential scenario ${index}; no real account data.`,
      },
    ));
    rows.push(buildRow(
      `fake-credential-${index}`,
      "chitchat",
      index + 10,
      new Date(now.getTime() - (5 + index) * 864e5),
      "accepted",
      { userInput: `Demo-only text: my pin code is 000${index}.` },
    ));
  }

  for (let index = 0; index < 10; index++) {
    const duplicateOf = rows[index];
    const duplicateTarget = duplicateOf.parsedOutput as JsonObject;
    rows.push({
      ...duplicateOf,
      id: uuidFor(`duplicate-${index}`),
      sessionId: seedKey(`duplicate-${index}`),
      createdAt: new Date(now.getTime() - index * 3600e3),
      outcome: "accepted",
      outcomeAt: now,
      correctedOutput: null,
      correctedAt: null,
      excludeFromTraining: false,
      parsedOutput: duplicateTarget,
    });
  }

  const malformedAt = new Date(now.getTime() - 8 * 864e5);
  rows.push(buildRow("malformed-empty-user", "chitchat", 900, malformedAt, "accepted", { userInput: "" }));
  rows.push(buildRow("malformed-target", "chitchat", 901, malformedAt, "accepted", { parsedOutput: "not valid action JSON" }));
  rows.push(buildRow("missing-target", "chitchat", 902, malformedAt, "accepted", { parsedOutput: null }));
  return rows;
}

async function fetchJson(path: string, token: string) {
  const response = await fetch(`${API_ENDPOINT}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function verifyEndpoint(token: string) {
  const statsResponse = await fetchJson("/stats", token);
  if (statsResponse.status !== 200 || !record(statsResponse.body) || typeof statsResponse.body.eligible !== "number") {
    throw new Error(`DEV /stats check failed (HTTP ${statsResponse.status}); confirm the local backend and user.`);
  }
  const exported: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  do {
    const suffix = cursor ? `?eligible=true&cursor=${encodeURIComponent(cursor)}` : "?eligible=true";
    const pageResponse = await fetchJson(`/export${suffix}`, token);
    if (pageResponse.status !== 200 || !record(pageResponse.body) || !Array.isArray(pageResponse.body.items)) {
      throw new Error(`DEV export check failed (HTTP ${pageResponse.status}).`);
    }
    if (!pageResponse.body.items.every(record)) {
      throw new Error("DEV export returned an invalid row.");
    }
    exported.push(...pageResponse.body.items);
    const nextCursor = pageResponse.body.nextCursor;
    if (nextCursor === null) {
      cursor = null;
    } else if (typeof nextCursor === "string" && nextCursor && nextCursor !== cursor) {
      cursor = nextCursor;
    } else {
      throw new Error("DEV export returned an invalid cursor.");
    }
  } while (cursor);

  const actual = exported.length;
  const expected = statsResponse.body.eligible;
  const seedRows = exported.filter((row) =>
    typeof row.sessionId === "string" && row.sessionId.startsWith(`${SEED_SESSION_ID}:${userMarker}:`)
  );
  const localList = await fetchJson("?route=LOCAL", token);
  const cloudList = await fetchJson("?route=CLOUD", token);
  const routeFiltersOk = [localList, cloudList].every((response) =>
    response.status === 200
    && record(response.body)
    && Array.isArray(response.body.items)
    && response.body.items.every((item) => record(item) && item.route === (response === localList ? "LOCAL" : "CLOUD"))
  );
  const correctionVisible = seedRows.some((row) => record(row.correctedOutput));
  const cloudModelVisible = seedRows.some((row) => row.route === "CLOUD" && row.cloudModel === CLOUD_MODEL);
  console.log(`DEV export eligible rows: ${actual}; /stats eligible: ${expected}; seeded eligible rows: ${seedRows.length}`);
  if (actual !== expected) throw new Error("DEV export eligible count does not match /stats.");
  console.log("PASS: export eligible count matches /stats.");
  if (!routeFiltersOk) throw new Error("DEV LOCAL/CLOUD list filters did not return matching routes.");
  if (!correctionVisible || !cloudModelVisible) throw new Error("DEV export did not expose correction and cloud-model seed rows.");
  console.log("PASS: LOCAL/CLOUD filters, correctedOutput and cloudModel are visible.");
}

async function main() {
  const clean = process.argv.includes("--clean");
  if (process.argv.slice(2).some((arg) => arg !== "--clean")) {
    console.error("Usage: npx tsx scripts/seed-brain-logs.ts [--clean]");
    process.exitCode = 2;
    return;
  }
  console.log(`DEV API endpoint: ${API_ENDPOINT}`);

  const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (existingUser.length === 0) {
    throw new Error("BRAIN_LOG_SEED_USER_ID does not identify an existing DEV user.");
  }

  if (clean) {
    const deleted = await db
      .delete(agentLogs)
      .where(and(
        eq(agentLogs.userId, userId),
        like(agentLogs.sessionId, `${SEED_SESSION_ID}:${userMarker}:%`),
      ))
      .returning({ id: agentLogs.id });
    console.log(`Deleted ${deleted.length} seeded rows.`);
    return;
  }

  const rows = makeSeedRows();
  const ids = rows.map((row) => row.id);
  const collisions = await db.select({
    id: agentLogs.id,
    userId: agentLogs.userId,
    sessionId: agentLogs.sessionId,
  }).from(agentLogs).where(inArray(agentLogs.id, ids));
  if (collisions.some((row) => row.userId !== userId || !row.sessionId?.startsWith(`${SEED_SESSION_ID}:${userMarker}:`))) {
    throw new Error("A deterministic seed ID already belongs to a non-seed row; refusing to overwrite it.");
  }

  const token = await signAccessToken(userId);
  const before = await fetchJson("/stats", token);
  if (before.status !== 200) {
    throw new Error(`DEV API preflight failed (HTTP ${before.status}); seed was not written.`);
  }

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const { id, ...updates } = row;
      if (!id) throw new Error("Seed row is missing its deterministic ID.");
      await tx.insert(agentLogs).values(row).onConflictDoUpdate({ target: agentLogs.id, set: updates });
    }
  });

  const actionCounts: Record<string, number> = {};
  const routeCounts: Record<string, number> = {};
  const outcomeCounts: Record<string, number> = {};
  for (const row of rows) {
    const target = row.parsedOutput as JsonObject | null;
    const action = typeof target?.action === "string" ? target.action : "invalid";
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    const route = row.route ?? "null";
    routeCounts[route] = (routeCounts[route] ?? 0) + 1;
    const outcome = row.outcome ?? "unknown";
    outcomeCounts[outcome] = (outcomeCounts[outcome] ?? 0) + 1;
  }
  console.log(`Seeded ${rows.length} rows (idempotent upsert).`);
  console.log("By action:", JSON.stringify(actionCounts));
  console.log("By route:", JSON.stringify(routeCounts));
  console.log("By outcome:", JSON.stringify(outcomeCounts));

  try {
    await verifyEndpoint(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "DEV verification failed.";
    console.error(`${message} Seed rows remain in DEV; run with --clean after fixing the issue.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed script failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
