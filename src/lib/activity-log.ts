import { db } from "@/db";
import { activityLogs } from "@/db/schema";

type ActivityValues = typeof activityLogs.$inferInsert;
type ActivityWriter = (values: ActivityValues) => PromiseLike<unknown>;

export async function logActivity(params: {
  userId: string;
  source: "DU_AN" | "FINANCE" | "LEARN" | "TRA_DINH" | "KIEU_LAU" | "MUSIC";
  action: string;
  title: string;
  metadata?: Record<string, unknown>;
}, write: ActivityWriter = (values) => db.insert(activityLogs).values(values)): Promise<void> {
  try {
    await write({
      userId: params.userId,
      source: params.source,
      action: params.action,
      title: params.title,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Ghi log không bao giờ được làm hỏng luồng chính — nuốt lỗi ở đây.
  }
}
