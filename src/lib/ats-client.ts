// Client CHỈ ĐỌC cho endpoint task của ats-app (GET /api/external/tasks). Không bao giờ gọi method khác GET.
// Theo mẫu weather.ts: timeout, cache no-store, parse bằng hàm thuần (có test ở ats-client.test.ts).
// Không đưa token / URL đầy đủ vào thông báo lỗi.

import { z } from "zod";

const TIMEOUT_MS = 15_000;
const PAGE_LIMIT = 1000;
/** Chặn vòng lặp vô hạn nếu nguồn trả con trỏ lặp lại. 200 trang × 1000 = 200k task. */
const MAX_PAGES = 200;

export type AtsErrorCode = "missing_env" | "unauthorized" | "http_error" | "timeout" | "network" | "bad_payload";

export class AtsError extends Error {
  constructor(
    readonly code: AtsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AtsError";
  }
}

export type AtsConfig = { url: string; token: string };

/** Đọc cấu hình từ env. Thiếu biến ⇒ AtsError("missing_env") nêu TÊN biến (không bao giờ nêu giá trị). */
export function readAtsConfig(env: Record<string, string | undefined> = process.env): AtsConfig {
  const missing = (["ATS_TASKS_URL", "ATS_TASKS_TOKEN"] as const).filter((k) => !env[k]?.trim());
  if (missing.length) throw new AtsError("missing_env", `Thiếu biến môi trường: ${missing.join(", ")}`);
  const url = env.ATS_TASKS_URL!.trim();
  try {
    new URL(url);
  } catch {
    throw new AtsError("missing_env", "ATS_TASKS_URL không phải URL hợp lệ");
  }
  return { url, token: env.ATS_TASKS_TOKEN!.trim() };
}

const isoInstant = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();

export const atsTaskSchema = z.object({
  id: z.union([z.string().min(1), z.number().int()]).transform(String),
  title: z.string(),
  status: z.enum(["DOING", "WAITING", "DONE"]).nullable(),
  dueDate: isoDate.nullable(),
  doneAt: isoInstant.nullable(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
  project: z
    .object({
      id: z.union([z.string().min(1), z.number().int()]).transform(String),
      name: z.string(),
      type: z.string().max(16),
      archived: z.boolean(),
    })
    .nullable()
    .optional(),
});
export type AtsTask = z.infer<typeof atsTaskSchema>;

const tasksPageSchema = z.object({
  serverTime: isoInstant,
  tasks: z.array(atsTaskSchema),
  nextCursor: z.string().min(1).nullable().optional(),
});

const idsPageSchema = z.object({
  serverTime: isoInstant,
  ids: z.array(z.union([z.string().min(1), z.number().int()]).transform(String)),
  nextCursor: z.string().min(1).nullable().optional(),
});

/** Parse một trang task. Sai dạng ⇒ AtsError("bad_payload") kèm đường dẫn trường lỗi đầu tiên (không kèm dữ liệu). */
export function parseTasksPage(json: unknown) {
  return parseOrThrow(tasksPageSchema, json);
}

export function parseIdsPage(json: unknown) {
  return parseOrThrow(idsPageSchema, json);
}

function parseOrThrow<S extends z.ZodType>(schema: S, json: unknown): z.infer<S> {
  const r = schema.safeParse(json);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new AtsError("bad_payload", `Dữ liệu ats-app sai dạng tại "${issue?.path.join(".") || "(gốc)"}": ${issue?.message ?? "?"}`);
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

async function getJson(cfg: AtsConfig, params: Record<string, string>, fetchFn: FetchFn): Promise<unknown> {
  const url = new URL(cfg.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new AtsError("timeout", `ats-app không trả lời sau ${TIMEOUT_MS / 1000}s`);
    throw new AtsError("network", `Không gọi được ats-app: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 401 || res.status === 403) throw new AtsError("unauthorized", `ats-app từ chối token (HTTP ${res.status})`);
  if (!res.ok) throw new AtsError("http_error", `ats-app trả HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new AtsError("bad_payload", "ats-app trả về không phải JSON");
  }
}

/** Lặp theo nextCursor tới hết. Trả serverTime của TRANG ĐẦU (mốc sớm nhất ⇒ thay đổi trong lúc phân trang được bắt ở lần sau). */
async function paginate<T>(
  cfg: AtsConfig,
  base: Record<string, string>,
  parse: (json: unknown) => { serverTime: string; nextCursor?: string | null } & T,
  pick: (page: T) => unknown[],
  fetchFn: FetchFn
): Promise<{ serverTime: string; items: unknown[] }> {
  const items: unknown[] = [];
  const seen = new Set<string>();
  let serverTime: string | null = null;
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = parse(await getJson(cfg, cursor ? { ...base, after: cursor } : base, fetchFn));
    serverTime ??= page.serverTime;
    items.push(...pick(page));
    cursor = page.nextCursor ?? null;
    if (!cursor) return { serverTime, items };
    if (seen.has(cursor)) throw new AtsError("bad_payload", "ats-app trả con trỏ lặp lại");
    seen.add(cursor);
  }
  throw new AtsError("bad_payload", `Quá ${MAX_PAGES} trang khi phân trang ats-app`);
}

/** Mọi task đã đổi từ `updatedSince` (điều kiện >= phía ats); null ⇒ lấy toàn bộ. */
export async function fetchAtsTasks(
  cfg: AtsConfig,
  opts: { updatedSince?: Date | null } = {},
  fetchFn: FetchFn = fetch
): Promise<{ serverTime: string; tasks: AtsTask[] }> {
  const base: Record<string, string> = { limit: String(PAGE_LIMIT) };
  if (opts.updatedSince) base.updatedSince = opts.updatedSince.toISOString();
  const r = await paginate(cfg, base, parseTasksPage, (p) => p.tasks, fetchFn);
  return { serverTime: r.serverTime, tasks: r.items as AtsTask[] };
}

/** Toàn bộ id task còn tồn tại (idsOnly=1) — ats xoá cứng nên dùng để phát hiện task đã xoá. */
export async function fetchAtsTaskIds(cfg: AtsConfig, fetchFn: FetchFn = fetch): Promise<{ serverTime: string; ids: string[] }> {
  const r = await paginate(cfg, { idsOnly: "1", limit: String(PAGE_LIMIT) }, parseIdsPage, (p) => p.ids, fetchFn);
  return { serverTime: r.serverTime, ids: r.items as string[] };
}
