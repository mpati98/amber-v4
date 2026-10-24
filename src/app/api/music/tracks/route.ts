import { NextResponse } from "next/server";
import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { musicTracks, users } from "@/db/schema";
import { logActivity } from "@/lib/activity-log";
import { signMusicStreamToken } from "@/lib/music-stream-token";
import { withAuth } from "@/lib/withAuth";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const createTrackSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    artist: z.string().trim().max(255).nullable().optional(),
    blobUrl: z.string().url(),
    blobPathname: z.string().min(1),
    durationSeconds: z.number().int().nonnegative().nullable().optional(),
    sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  })
  .strict();

function isOwnedBlob(userId: string, blobUrl: string, blobPathname: string): boolean {
  const prefix = `music/${userId}/`;
  if (!blobPathname.startsWith(prefix)) return false;
  const fileName = blobPathname.slice(prefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("..")) return false;

  try {
    const url = new URL(blobUrl);
    const urlPathname = decodeURIComponent(url.pathname.slice(1));
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com") && urlPathname === blobPathname;
  } catch {
    return false;
  }
}

export const GET = withAuth(async (req, userId) => {
  const tracks = await db
    .select()
    .from(musicTracks)
    .where(eq(musicTracks.userId, userId))
    .orderBy(asc(musicTracks.position), asc(musicTracks.createdAt), asc(musicTracks.id));
  const tracksWithStreamUrls = await Promise.all(
    tracks.map(async (track) => {
      const token = await signMusicStreamToken(userId, track.id);
      const streamUrl = new URL(`/api/music/tracks/${track.id}/stream`, req.url);
      streamUrl.searchParams.set("token", token);
      return { ...track, streamUrl: streamUrl.toString() };
    }),
  );
  return NextResponse.json(tracksWithStreamUrls);
});

export const POST = withAuth(async (req, userId) => {
  const parsed = createTrackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;
  if (!isOwnedBlob(userId, data.blobUrl, data.blobPathname)) {
    return NextResponse.json({ error: "invalid_blob" }, { status: 400 });
  }

  const track = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const [last] = await tx.select({ position: max(musicTracks.position) }).from(musicTracks).where(eq(musicTracks.userId, userId));
    const [created] = await tx
      .insert(musicTracks)
      .values({
        ...data,
        userId,
        artist: data.artist ?? null,
        durationSeconds: data.durationSeconds ?? null,
        position: last?.position == null ? 0 : last.position + 1,
      })
      .returning();
    return created;
  });

  await logActivity({
    userId,
    source: "MUSIC",
    action: "music_track.created",
    title: `Thêm bài nhạc: ${track.title}`,
    metadata: { trackId: track.id },
  });
  return NextResponse.json(track, { status: 201 });
});
