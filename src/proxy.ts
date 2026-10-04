import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Chỉ còn API — giao diện web đã gỡ (Giai đoạn 2), app Flutter là client duy nhất.
const PUBLIC_PATHS = [
  "/api/auth", // bao gồm cả /api/auth/register và các route của next-auth
  "/api/health",
];

// Prefix có route tự xác thực bằng withAuth — xem comment trong handler bên dưới.
// Không có "/" ở cuối: /api/projects và /api/tasks tự thân là route. Khớp đúng
// prefix hoặc prefix + "/..." (không khớp nhầm kiểu /api/tasksxyz).
const SELF_AUTH_API_PREFIXES = [
  "/api/mobile",
  "/api/kieu-lau",
  "/api/tang-kinh-cac",
  // Nghị Sự Đường (dự án, tài chính, học tập) — API không có prefix chung.
  "/api/projects",
  "/api/tasks",
  "/api/du-an",
  "/api/finance",
  "/api/learn",
  "/api/tra-dinh",
  // Hồ sơ + đổi mật khẩu (trước chỉ trang Cài đặt web gọi qua cookie).
  "/api/user",
  // Route CÔNG KHAI (form liên hệ portfolio): không dùng phiên đăng nhập, tự
  // chống lạm dụng (giới hạn kích thước, bẫy bot, giới hạn tần suất).
  "/api/public",
];

function isSelfAuthApi(pathname: string): boolean {
  return SELF_AUTH_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth((req) => {
  // API gọi được từ app Flutter xác thực bằng Bearer token, proxy chỉ biết
  // cookie NextAuth nên không kiểm tra ở đây. Mỗi route dưới các prefix này
  // tự check qua withAuth (lib/withAuth.ts), hỗ trợ cả cookie web lẫn Bearer
  // mobile — proxy KHÔNG còn là lớp chặn cho các path này, route nào quên bọc
  // withAuth sẽ mở công khai. Ngoại lệ duy nhất: /api/mobile/auth/*.
  // Các prefix ngoài /api/mobile/* dùng chung cho web + Flutter.
  if (isSelfAuthApi(req.nextUrl.pathname)) {
    // Preflight CORS không kèm token. Header CORS do next.config.ts gắn vào.
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((p) => req.nextUrl.pathname.startsWith(p));
  if (isPublic || req.auth) {
    return NextResponse.next();
  }

  // API gọi mà chưa đăng nhập -> 401 JSON.
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Không còn trang web nào (đã gỡ UI) — path ngoài /api để Next tự trả 404,
  // không redirect tới /login vốn cũng không còn tồn tại.
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
