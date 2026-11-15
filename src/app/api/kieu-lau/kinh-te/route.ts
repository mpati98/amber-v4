import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { economySummary, syncEconomy } from "@/lib/economy-db";

const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Xem cả phạt ở chế độ bóng (để chỉnh hệ số). UI thường không gửi.
  shadow: z.enum(["0", "1"]).default("0"),
});

// Kinh tế Âm Dương Giới: đối soát sự kiện (bắt cả thay đổi mà route ghi không báo, vd xoá dự án/môn kéo theo dữ liệu)
// rồi trả số dư Nguyên Tệ, Thể lực, Sức khoẻ và nhật ký "luật nào áp vào sự kiện nào".
export const GET = withAuth(async (req, userId) => {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sync = await syncEconomy(userId);
  const summary = await economySummary(userId, { limit: parsed.data.limit, includeShadow: parsed.data.shadow === "1" });
  return NextResponse.json({ ...summary, sync });
});
