import type { NextConfig } from "next";

const mobileCorsHeaders = [
  { key: "Access-Control-Allow-Origin", value: process.env.MOBILE_APP_ORIGIN || "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
];

// Form liên hệ công khai của portfolio (domain khác) — TÁCH RIÊNG khỏi CORS
// mobile. Chỉ cho đúng origin của portfolio; thiếu PORTFOLIO_ORIGIN thì KHÔNG
// đặt Allow-Origin (trình duyệt chặn) — không bao giờ dùng "*".
const portfolioOrigin = process.env.PORTFOLIO_ORIGIN;
const publicCorsHeaders = [
  ...(portfolioOrigin ? [{ key: "Access-Control-Allow-Origin", value: portfolioOrigin }] : []),
  { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type" },
  { key: "Access-Control-Max-Age", value: "86400" },
  { key: "Vary", value: "Origin" },
];

const nextConfig: NextConfig = {
  // CORS chỉ cho API mà app Flutter gọi (cross-origin bằng Bearer token):
  // /api/mobile/* và các API dùng chung web + Flutter: Kiều Lâu, Tàng Kinh Các,
  // Nghị Sự Đường (projects, tasks, du-an, finance, learn), Trà Đình, hồ sơ user.
  // Các route khác chỉ web gọi same-origin qua cookie, không cần CORS.
  async headers() {
    return [
      { source: "/api/mobile/:path*", headers: mobileCorsHeaders },
      { source: "/api/kieu-lau/:path*", headers: mobileCorsHeaders },
      { source: "/api/tang-kinh-cac/:path*", headers: mobileCorsHeaders },
      { source: "/api/tra-dinh/:path*", headers: mobileCorsHeaders },
      { source: "/api/user/:path*", headers: mobileCorsHeaders },
      { source: "/api/public/:path*", headers: publicCorsHeaders },
      // `:path*` khớp cả 0 đoạn → gồm luôn /api/projects, /api/tasks.
      ...["projects", "tasks", "du-an", "finance", "learn"].map((p) => ({
        source: `/api/${p}/:path*`,
        headers: mobileCorsHeaders,
      })),
    ];
  },
};

export default nextConfig;
