import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/withAuth";
import { loadWorldEconomy, loadWorldEvents, loadWorldStats } from "@/lib/world-summary";

// ISO có micro giây (con trỏ do chính route này trả) hoặc mili giây
const since = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/);

// Màn chủ 3D (Âm Dương Giới): 5 chỉ số 0–100 (ô sinhLuc = Sức khoẻ của kinh tế) (null = chưa đủ dữ liệu) + sự kiện mới từ nhật ký hoạt động.
// Client gọi khi có "trigger" (mở màn chủ, quay lại màn chủ) — không polling. Lưu `cursor` rồi gửi lại ở `?since=`.
export const GET = withAuth(async (req, userId) => {
  const raw = req.nextUrl.searchParams.get("since");
  const parsed = raw == null ? null : since.safeParse(raw);
  if (parsed && !parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const now = new Date();
  const [econ, events] = await Promise.all([loadWorldEconomy(userId), loadWorldEvents(userId, parsed?.data ?? null)]);
  const stats = await loadWorldStats(userId, econ.health, now);
  // `economy` (thêm 15/11/2026): Thể lực, Nguyên Tệ, nhật ký luật — client cũ bỏ qua được.
  return NextResponse.json({ stats, economy: econ.economy, events: events.events, cursor: events.cursor, generatedAt: now.toISOString() });
});
