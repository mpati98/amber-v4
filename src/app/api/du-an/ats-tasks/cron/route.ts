import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiError } from "@/lib/apiError";
import { checkCronAuth } from "@/lib/cron-auth";
import { ATS_MANUAL_SYNC_INTERVAL_SEC, runAtsSync, userExists } from "@/lib/ats-sync";
import { atsSyncResponse } from "@/lib/ats-sync-response";

export const maxDuration = 60;

// Vercel Cron (vercel.json, 23:00 UTC = 06:00 VN). CỐ Ý không dùng withAuth: không có phiên đăng nhập, thay bằng
// `Authorization: Bearer $CRON_SECRET` (so timing-safe). Đồng bộ cho ATS_SYNC_USER_ID, kéo TOÀN BỘ (không updatedSince)
// để bắt cả thay đổi project (đổi tên, lưu trữ) không làm đổi updatedAt của task.
// Đi qua proxy.ts nhờ prefix "/api/du-an" đã có trong SELF_AUTH_API_PREFIXES — không cần ngoại lệ mới.
export const GET = withApiError(async (req: NextRequest) => {
  const auth = checkCronAuth(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "not_configured") return NextResponse.json({ error: "cron_not_configured", message: "Thiếu biến môi trường: CRON_SECRET" }, { status: 503 });
  if (auth === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = process.env.ATS_SYNC_USER_ID?.trim();
  if (!userId) return NextResponse.json({ error: "ats_not_configured", message: "Thiếu biến môi trường: ATS_SYNC_USER_ID" }, { status: 503 });
  if (!z.uuid().safeParse(userId).success || !(await userExists(userId))) {
    return NextResponse.json({ error: "ats_not_configured", message: "ATS_SYNC_USER_ID không khớp user nào" }, { status: 503 });
  }

  return atsSyncResponse(await runAtsSync(userId, { minIntervalSec: ATS_MANUAL_SYNC_INTERVAL_SEC, full: true }));
});
