// Bộ luật kinh tế (Âm Dương Giới): YAML có `version` → kiểm bằng zod → biên dịch mọi biểu thức một lần.
// Luật là dữ liệu: đổi YAML rồi dựng lại sổ cái là ra lịch sử theo luật mới. Không có LLM trong đường thi hành.

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { compileExpr, ExprError, type CompiledExpr, type ExprScope, type ExprType } from "@/lib/economy-expr";

export const LEDGER_KEYS = ["nguyen_te", "stamina"] as const;
export type LedgerKey = (typeof LEDGER_KEYS)[number];

/** Biến trạng thái dùng được trong biểu thức (giá trị TRƯỚC khi áp sự kiện). */
export const STATE_VARS: Record<string, ExprType> = {
  nguyen_te: "number",
  stamina: "number",
  health: "number",
  debuff_active: "boolean",
};

/** Các loại sự kiện và kiểu từng trường `e.*`. Thêm loại mới = thêm ở đây + nơi sinh sự kiện. */
export const EVENT_FIELDS: Record<string, Record<string, ExprType>> = {
  "task.completed": { on_time: "boolean", est_hours: "number", hours: "number", card_used: "boolean" },
  "study.logged": { minutes: "number" },
  "exercise.logged": { minutes: "number" },
  redeem: { price: "number" },
  buy_card: { price: "number" },
};

/** Sự kiện chi tiêu: entry âm của chúng là tiền đã tiêu, KHÔNG phải phạt (không bị chế độ bóng giữ lại). */
export const SPEND_EVENT_TYPES: ReadonlySet<string> = new Set(["redeem", "buy_card"]);

const ruleYaml = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "id chỉ gồm chữ thường, số, gạch dưới"),
  event: z.string(),
  when: z.union([z.string(), z.boolean()]).optional(),
  do: z.array(z.object({ key: z.enum(LEDGER_KEYS), amount: z.union([z.string(), z.number()]) })).min(1),
});

const num = (d: number) => z.number().finite().default(d);

const ruleSetYaml = z.object({
  version: z.number().int().positive(),
  // Chế độ bóng: null ⇒ mọi phạt Nguyên Tệ chỉ được ghi lại, không trừ. Đặt ngày "YYYY-MM-DD" ⇒ phạt của sự kiện
  // từ ngày đó trở đi mới trừ thật; phạt trước đó giữ nguyên là bóng (bật phạt không đổ dồn phạt cũ).
  penalties_live_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  // Ngày bắt đầu tính Nguyên Tệ (số dư 0 từ đây). Sự kiện trước ngày này không bao giờ sinh entry Nguyên Tệ — chỉ hao thể lực.
  // null = tính từ mọi sự kiện. Cùng `warmup_days`: chỉ lấy sự kiện + dữ liệu sức khoẻ từ (ngày này − warmup_days) để làm nóng Sức khoẻ / Thể lực.
  nguyen_te_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  warmup_days: z.number().int().min(0).max(60).default(14),
  caps: z
    .object({
      nguyen_te_per_day: num(100).pipe(z.number().nonnegative()),
      manual_weight: num(0.5).pipe(z.number().min(0).max(1)),
      debt_floor: num(-200).pipe(z.number().nonpositive()),
    })
    .prefault({}),
  // Hệ số Sức khoẻ / Thể lực (mục 4 của đặc tả). Để trong luật để chỉnh được mà không sửa code.
  health: z
    .object({
      initial_base: num(70),
      smoothing: num(0.7).pipe(z.number().min(0).max(1)),
      sleep_weight: num(0.5),
      sleep_ok_min_hours: num(6.5),
      sleep_ok_max_hours: num(8),
      sleep_penalty_per_hour: num(25),
      sleep_hours_weight: num(0.6),
      exercise_target_minutes: num(30).pipe(z.number().positive()),
      sport_factor: num(1.5),
      rest_day_score: num(70),
      debuff: z.object({ light: num(10), medium: num(25), heavy: num(40) }).prefault({}),
    })
    .prefault({}),
  stamina: z
    .object({
      base: num(60),
      per_health: num(0.4),
      morning_min_ratio: num(0.5).pipe(z.number().min(0).max(1)),
    })
    .prefault({}),
  rules: z.array(ruleYaml).min(1),
});

export type RuleSetParams = Omit<z.infer<typeof ruleSetYaml>, "rules">;

export type CompiledRule = {
  id: string;
  event: string;
  when: CompiledExpr | null;
  do: Array<{ key: LedgerKey; amount: CompiledExpr }>;
};

export type RuleSet = RuleSetParams & { rules: CompiledRule[] };

export class RuleSetError extends Error {}

/** Nạp + kiểm + biên dịch. Lỗi nào (YAML, schema, biểu thức, id trùng, sự kiện lạ) cũng ném RuleSetError có ngữ cảnh. */
export function loadRuleSet(yamlText: string): RuleSet {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new RuleSetError(`YAML lỗi: ${(err as Error).message}`);
  }
  const parsed = ruleSetYaml.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RuleSetError(`Luật sai cấu trúc ở ${first.path.join(".") || "(gốc)"}: ${first.message}`);
  }
  const { rules, ...params } = parsed.data;
  const seen = new Set<string>();
  const compiled = rules.map((r): CompiledRule => {
    if (seen.has(r.id)) throw new RuleSetError(`Trùng id luật: ${r.id}`);
    seen.add(r.id);
    const fields = EVENT_FIELDS[r.event];
    if (!fields) throw new RuleSetError(`Luật ${r.id}: loại sự kiện lạ "${r.event}"`);
    const scope: ExprScope = { vars: STATE_VARS, eventFields: fields };
    try {
      const when = r.when === undefined || r.when === true ? null : compileExpr(String(r.when === false ? "False" : r.when), scope, "boolean");
      return {
        id: r.id,
        event: r.event,
        when,
        do: r.do.map((d) => ({ key: d.key, amount: compileExpr(String(d.amount), scope, "number") })),
      };
    } catch (err) {
      if (err instanceof ExprError) throw new RuleSetError(`Luật ${r.id}: ${err.message}`);
      throw err;
    }
  });
  return { ...params, rules: compiled };
}
