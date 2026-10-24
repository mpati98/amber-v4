import { BlobNotFoundError, get, head } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { musicTracks } from "@/db/schema";
import { withApiError } from "@/lib/apiError";
import { verifyMusicStreamToken } from "@/lib/music-stream-token";

export const runtime = "nodejs";
export const maxDuration = 300;

const idSchema = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rangeNotSatisfiable(size: number): NextResponse {
  return new NextResponse(null, {
    status: 416,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${size}`,
      "Content-Length": "0",
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = withApiError(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token");
  if (!idSchema.test(id) || !token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const claims = await verifyMusicStreamToken(token);
  if (!claims || claims.trackId !== id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [track] = await db
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.id, id), eq(musicTracks.userId, claims.userId)))
    .limit(1);
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let blobMetadata;
  try {
    blobMetadata = await head(track.blobPathname);
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  }

  const size = blobMetadata.size;
  const requestedRange = req.headers.get("range");
  let byteRange: { start: number; end: number } | undefined;
  if (requestedRange !== null) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(requestedRange.trim());
    if (!match || (!match[1] && !match[2]) || size <= 0) return rangeNotSatisfiable(size);

    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return rangeNotSatisfiable(size);
      byteRange = { start: Math.max(size - suffixLength, 0), end: size - 1 };
    } else {
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || start > requestedEnd) {
        return rangeNotSatisfiable(size);
      }
      byteRange = { start, end: Math.min(requestedEnd, size - 1) };
    }
  }

  const blob = await get(track.blobPathname, {
    access: "private",
    ...(byteRange
      ? { headers: { Range: `bytes=${byteRange.start}-${byteRange.end}` } }
      : {}),
  });
  if (!blob || blob.statusCode === 304 || !blob.stream) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": blob.blob.contentType || "audio/mpeg",
    "Referrer-Policy": "no-referrer",
  });
  if (!byteRange) {
    headers.set("Content-Length", String(size));
    return new NextResponse(blob.stream, { status: 200, headers });
  }

  const contentRange = blob.headers.get("content-range");
  const expectedRange = `bytes ${byteRange.start}-${byteRange.end}/${size}`;
  if (contentRange !== expectedRange) {
    await blob.stream.cancel();
    return NextResponse.json({ error: "range_not_supported" }, { status: 502 });
  }
  headers.set("Content-Range", contentRange);
  headers.set("Content-Length", String(byteRange.end - byteRange.start + 1));
  return new NextResponse(blob.stream, { status: 206, headers });
});
