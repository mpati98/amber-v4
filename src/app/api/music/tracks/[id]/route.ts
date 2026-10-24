import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { musicTracks, users } from "@/db/schema";
import { logActivity } from "@/lib/activity-log";
import { withAuth } from "@/lib/withAuth";

const idSchema = z.string().uuid();

const patchTrackSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    artist: z.string().trim().max(255).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "Cần ít nhất một trường để cập nhật." });

export const PATCH = withAuth(async (req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = patchTrackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const updated = await db.transaction(async (tx) => {
    const [owned] = await tx
      .select()
      .from(musicTracks)
      .where(and(eq(musicTracks.id, id), eq(musicTracks.userId, userId)))
      .limit(1);
    if (!owned) return null;

    if (data.position === undefined) {
      const [row] = await tx
        .update(musicTracks)
        .set({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.artist !== undefined ? { artist: data.artist } : {}),
        })
        .where(and(eq(musicTracks.id, id), eq(musicTracks.userId, userId)))
        .returning();
      return row;
    }

    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const tracks = await tx
      .select()
      .from(musicTracks)
      .where(eq(musicTracks.userId, userId))
      .orderBy(asc(musicTracks.position), asc(musicTracks.createdAt), asc(musicTracks.id));
    const oldIndex = tracks.findIndex((track) => track.id === id);
    const [moving] = tracks.splice(oldIndex, 1);
    tracks.splice(Math.min(data.position, tracks.length), 0, moving);

    let result = moving;
    for (const [position, track] of tracks.entries()) {
      const [row] = await tx
        .update(musicTracks)
        .set({
          position,
          ...(track.id === id && data.title !== undefined ? { title: data.title } : {}),
          ...(track.id === id && data.artist !== undefined ? { artist: data.artist } : {}),
        })
        .where(and(eq(musicTracks.id, track.id), eq(musicTracks.userId, userId)))
        .returning();
      if (track.id === id) result = row;
    }
    return result;
  });

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await logActivity({
    userId,
    source: "MUSIC",
    action: "music_track.updated",
    title: `Cập nhật bài nhạc: ${updated.title}`,
    metadata: { trackId: updated.id, fields: Object.keys(data) },
  });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (_req, userId, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [track] = await db
    .select()
    .from(musicTracks)
    .where(and(eq(musicTracks.id, id), eq(musicTracks.userId, userId)))
    .limit(1);
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await del(track.blobUrl);
  await db.delete(musicTracks).where(and(eq(musicTracks.id, id), eq(musicTracks.userId, userId)));
  await logActivity({
    userId,
    source: "MUSIC",
    action: "music_track.deleted",
    title: `Xoá bài nhạc: ${track.title}`,
    metadata: { trackId: track.id },
  });
  return NextResponse.json({ ok: true });
});
