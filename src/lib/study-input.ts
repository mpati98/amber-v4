import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Schema đầu vào của API Học tập (Trà Đình).

/** Đọc JSON body; body hỏng → undefined (route trả 400 invalid_json thay vì 500). */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export const badRequest = (error: unknown = "invalid_input") => NextResponse.json({ error }, { status: 400 });
export const invalidBody = (e: z.ZodError) => NextResponse.json({ error: e.flatten() }, { status: 400 });

const minutes = z.number().int().min(1).max(1440);

/** 1 = thứ Hai … 7 = Chủ nhật; không trùng, tối đa 6 ngày (luôn còn ít nhất 1 ngày học). */
export const reviewWeekdaysSchema = z
  .array(z.number().int().min(1).max(7))
  .max(6)
  .refine((a) => new Set(a).size === a.length, { message: "weekdays must be unique" });

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dailyGoalMinutes: minutes.nullable().optional(),
  videoMinutesPerDay: minutes.optional(),
  reviewWeekdays: reviewWeekdaysSchema.optional(),
  position: z.number().int().min(0).optional(),
});
export const patchSubjectSchema = createSubjectSchema.partial();

// Cột title của khóa/phần là varchar(255) → giới hạn 255 (không phải 300).
const title = z.string().trim().min(1).max(255);
const optionalText = (n: number) => z.string().trim().max(n).nullable().optional();

export const sectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  title,
  durationMinutes: z.number().int().min(0).max(100_000),
});
export const MAX_SECTIONS = 1000;

const courseFields = {
  title,
  instructor: optionalText(255),
  platform: optionalText(255),
  url: z.string().trim().url().max(2000).nullable().optional(),
  status: z.enum(["WISHLIST", "QUEUED", "ACTIVE", "DONE"]).optional(),
  targetPrice: optionalText(200),
  note: optionalText(5000),
};

export const createCourseSchema = z.object({
  subjectId: z.string(),
  ...courseFields,
  sections: z.array(sectionInputSchema.omit({ id: true })).max(MAX_SECTIONS).optional(),
  sectionsText: z.string().max(200_000).optional(),
});
export const patchCourseSchema = z.object(courseFields).partial();

export const putSectionsSchema = z.union([
  z.array(sectionInputSchema).max(MAX_SECTIONS),
  z.object({ sections: z.array(sectionInputSchema).max(MAX_SECTIONS) }).transform((o) => o.sections),
]);
