import { z } from "zod";

/** 1 = thứ Hai … 7 = Chủ nhật; không trùng, không rỗng. */
export const weekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .refine((a) => new Set(a).size === a.length, { message: "weekdays must be unique" });

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
