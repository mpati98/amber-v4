import { after, NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { ATS_AUTO_SYNC_INTERVAL_SEC, getAtsSyncState, listAtsTasks, runAtsSync } from "@/lib/ats-sync";

// Đồng bộ nền (after) có thể kéo nhiều trang từ ats-app.
export const maxDuration = 60;

// Task ats-app (bản sao chỉ đọc). Trả ngay dữ liệu đang lưu; lần thử trước quá 5 phút thì đồng bộ nền sau response.
// Mặc định ẩn project đã lưu trữ và task DONE xong quá 7 ngày; ?all=1 trả tất cả.
export const GET = withAuth(async (req, userId) => {
  const all = req.nextUrl.searchParams.get("all") === "1";
  const [tasks, state] = await Promise.all([listAtsTasks(userId, { all }), getAtsSyncState(userId)]);

  const stale = !state.lastAttemptDate || Date.now() - state.lastAttemptDate.getTime() >= ATS_AUTO_SYNC_INTERVAL_SEC * 1000;
  // runAtsSync tự giành lượt nguyên tử (hai GET cùng lúc chỉ một lần chạy) và không bao giờ ném lỗi.
  if (stale) after(() => runAtsSync(userId, { minIntervalSec: ATS_AUTO_SYNC_INTERVAL_SEC }));

  return NextResponse.json({
    tasks,
    sync: { lastSuccessAt: state.lastSuccessAt, lastAttemptAt: state.lastAttemptAt, lastError: state.lastError },
  });
});
