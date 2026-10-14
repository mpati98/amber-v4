import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { parseSections } from "@/lib/study-sections-parse";
import { badRequest, invalidBody, readJson } from "@/lib/study-input";

// Xem trước kết quả tách phần từ văn bản dán — không ghi DB.
export const POST = withAuth(async (req) => {
  const body = await readJson(req);
  if (body === undefined) return badRequest("invalid_json");
  const parsed = z.object({ text: z.string().max(200_000) }).safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(parseSections(parsed.data.text));
});
