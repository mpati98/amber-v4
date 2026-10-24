import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sanitizeFileName } from "@/lib/filename";
import { withAuth } from "@/lib/withAuth";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const generateTokenSchema = z.object({
  type: z.literal("blob.generate-client-token"),
  payload: z.object({
    pathname: z.string().min(1),
    multipart: z.boolean(),
    clientPayload: z.string().nullable(),
  }),
});

export const POST = withAuth(async (req, userId) => {
  const parsed = generateTokenSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { pathname } = parsed.data.payload;
  const prefix = `music/${userId}/`;
  const fileName = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  if (!fileName || fileName.includes("/") || sanitizeFileName(fileName) !== fileName || !fileName.toLowerCase().endsWith(".mp3")) {
    return NextResponse.json({ error: "invalid_pathname" }, { status: 400 });
  }

  const result = await handleUpload({
    request: req,
    body: parsed.data satisfies HandleUploadBody,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ["audio/mpeg"],
      maximumSizeInBytes: MAX_FILE_BYTES,
      addRandomSuffix: true,
      allowOverwrite: false,
    }),
  });
  return NextResponse.json(result);
});
