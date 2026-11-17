import { withAuth } from "@/lib/withAuth";
import { ATS_MANUAL_SYNC_INTERVAL_SEC, runAtsSync } from "@/lib/ats-sync";
import { atsSyncResponse } from "@/lib/ats-sync-response";

export const maxDuration = 60;

// "Đồng bộ ngay": chờ xong rồi trả số thêm / sửa / xoá. Tối thiểu 30 giây giữa hai lần (429 kèm retryAfterSeconds).
export const POST = withAuth(async (_req, userId) => {
  return atsSyncResponse(await runAtsSync(userId, { minIntervalSec: ATS_MANUAL_SYNC_INTERVAL_SEC }));
});
