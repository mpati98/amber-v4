import { z } from "zod";

// Dựng giá trị target/current cuối cùng cho KR; trả lỗi (400) hoặc giá trị đã chuẩn hoá.
export const krBase = {
  name: z.string().min(1).max(255),
  mode: z.enum(["AUTO", "MANUAL"]),
  unit: z.string().max(32),
  target: z.number().int(),
  current: z.number().int(),
};

export const createKrSchema = z.object({
  name: krBase.name,
  mode: krBase.mode,
  unit: krBase.unit.nullable().optional(),
  target: krBase.target.optional(),
  current: krBase.current.optional(),
});

export const patchKrSchema = z.object({
  name: krBase.name.optional(),
  mode: krBase.mode.optional(),
  unit: krBase.unit.nullable().optional(),
  target: krBase.target.optional(),
  current: krBase.current.optional(),
});

export type KrNumbersResult = { ok: true; target: number; current: number } | { ok: false; error: string };

/**
 * Quy tắc số liệu KR.
 *  AUTO:   luôn lưu target = current = 0.
 *  MANUAL: target ≥ 1 (bắt buộc); 0 ≤ current ≤ target.
 *          Hạ target xuống dưới current hiện có mà không gửi current mới → current = target.
 */
export function resolveKrNumbers(
  mode: "AUTO" | "MANUAL",
  input: { target?: number; current?: number },
  existing?: { target: number; current: number }
): KrNumbersResult {
  if (mode === "AUTO") return { ok: true, target: 0, current: 0 };

  const target = input.target ?? existing?.target ?? 0;
  if (target < 1) return { ok: false, error: "target_must_be_at_least_1" };

  let current = input.current ?? existing?.current ?? 0;
  if (input.current === undefined && current > target) current = target;
  if (current < 0 || current > target) return { ok: false, error: "current_out_of_range" };
  return { ok: true, target, current };
}
