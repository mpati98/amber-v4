import { NextResponse } from "next/server";
import { withAuth } from "@/lib/withAuth";
import { syncEconomy } from "@/lib/economy-db";

// Dựng lại toàn bộ sổ cái từ sự kiện (vd sau khi chỉnh hệ số trong bộ luật). Xác định: gọi lại cho cùng kết quả.
export const POST = withAuth(async (_req, userId) => {
  const sync = await syncEconomy(userId, { full: true });
  return NextResponse.json({ sync });
});
