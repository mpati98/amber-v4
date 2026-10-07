import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";

/** [id] có phải dự án STANDARD của [userId] không (id sai định dạng → false). */
export async function isOwnedStandardProject(id: string, userId: string): Promise<boolean> {
  if (!z.string().uuid().safeParse(id).success) return false;
  const row = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, userId), eq(projects.type, "STANDARD")),
    columns: { id: true },
  });
  return row !== undefined;
}
