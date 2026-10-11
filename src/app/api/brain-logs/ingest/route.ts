import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { db } from "@/db";
import { agentLogs } from "@/db/schema";
import { INGEST_MAX_ROWS, ingestLogSchema, shouldApplyOutcome } from "@/lib/brain-logs";

const bodySchema = z.object({ logs: z.array(z.unknown()).min(1).max(INGEST_MAX_ROWS) });

const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);

// amber-brain đẩy nhật ký lên (upsert theo id). userId LUÔN lấy từ token, không tin body.
// Phản hồi {saved, invalid, conflicts} liệt kê mọi id đã được xử lý xong: brain không gửi lại các id này.
//  - invalid:   dòng sai định dạng (không làm hỏng cả lô);
//  - conflicts: id đã thuộc user khác (không bao giờ ghi đè).
// Nội dung log cập nhật theo bản mới nhất; outcome (+ corrected_output/at) chỉ đổi khi outcomeAt mới hơn bản đang có;
// exclude_from_training không bao giờ bị ingest đụng tới (do app đặt).
export const POST = withAuth(async (req, userId) => {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const valid: z.infer<typeof ingestLogSchema>[] = [];
  const invalid: { id: string | null; message: string }[] = [];
  for (const raw of body.data.logs) {
    const r = ingestLogSchema.safeParse(raw);
    if (r.success) valid.push(r.data);
    else invalid.push({ id: typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : null, message: r.error.issues[0]?.message ?? "invalid" });
  }

  const saved: string[] = [];
  const conflicts: string[] = [];
  await db.transaction(async (tx) => {
    const existing = valid.length
      ? await tx
          .select({ id: agentLogs.id, userId: agentLogs.userId, outcomeAt: agentLogs.outcomeAt })
          .from(agentLogs)
          .where(inArray(agentLogs.id, valid.map((v) => v.id)))
      : [];
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const v of valid) {
      const { outcome, outcomeAt, correctedOutput, correctedAt, createdAt, ...content } = v;
      const row = { ...content, createdAt: new Date(createdAt) };
      const outcomeFields = { outcome, outcomeAt: toDate(outcomeAt), correctedOutput, correctedAt: toDate(correctedAt) };
      const prev = byId.get(v.id);
      if (!prev) {
        await tx.insert(agentLogs).values({ ...row, ...outcomeFields, userId });
      } else if (prev.userId !== userId) {
        conflicts.push(v.id);
        continue;
      } else {
        const { id, ...update } = row;
        await tx
          .update(agentLogs)
          .set(shouldApplyOutcome(prev.outcomeAt, toDate(outcomeAt)) ? { ...update, ...outcomeFields } : update)
          .where(eq(agentLogs.id, id));
      }
      saved.push(v.id);
    }
  });

  return NextResponse.json({ saved, invalid, conflicts });
});
