# amber-v4

Backend API của **Amber** — ứng dụng quản lý cá nhân (dự án, tài chính, học tập,
sách & tài liệu, tin tức, luyện tiếng Anh với AI). Repo này **chỉ có API**; giao
diện là app Flutter ở repo [amber-flutter](https://github.com/mpati98/amber-flutter).

## Công nghệ

- Next.js 16 (App Router, route handler — không có trang web)
- Postgres trên Neon, truy cập bằng Drizzle ORM (`postgres.js`)
- Vercel Blob (lưu file), Groq (chat, chuyển giọng nói ↔ chữ)
- Xác thực JWT cho app (access token 1 giờ + refresh token 30 ngày, xoay vòng)

## Chạy local

Cần Node 22.

```bash
npm install
cp <nguồn .env của bạn> .env   # xem bảng biến bên dưới
npm run dev                    # http://localhost:3000/api/health
```

Tạo tài khoản (hoặc đặt lại mật khẩu nếu email đã tồn tại):

```bash
npx tsx scripts/create-admin.ts <email> <password>
```

Kiểm tra trước khi commit:

```bash
npx tsc --noEmit && npx eslint src && npm run build
```

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `DATABASE_URL` | ✅ | Chuỗi kết nối Postgres (Neon). Nên dùng host `-pooler` |
| `MOBILE_JWT_SECRET` | ✅ | Khoá ký access token cho app |
| `AUTH_SECRET` | ✅ | Khoá của NextAuth |
| `GROQ_API_KEY` | ✅ | Gọi Groq (chat, Whisper, TTS) |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Upload/đọc file trên Vercel Blob |
| `MOBILE_APP_ORIGIN` | ✅ production | Origin của app Flutter web cho CORS (thiếu thì mở `*`) |
| `AUTH_TRUST_HOST` | chỉ khi tự host | `true` khi chạy `next start` ngoài Vercel |

## API

Mọi route nằm dưới `/api`, trả JSON. Trừ đăng nhập và health check, request cần
header `Authorization: Bearer <accessToken>`.

| Nhóm | Prefix |
|---|---|
| Đăng nhập app | `/api/mobile/auth/login`, `/refresh`, `/logout` |
| Dự án & công việc | `/api/projects`, `/api/tasks`, `/api/du-an` |
| Tài chính | `/api/finance` |
| Học tập | `/api/learn` |
| Sách & tài liệu (Tàng Kinh Các) | `/api/tang-kinh-cac` |
| Thông báo & tin tức (Kiều Lâu) | `/api/kieu-lau` |
| Luyện tiếng Anh (Trà Đình) | `/api/tra-dinh` |
| Hồ sơ | `/api/user` |
| Health check | `/api/health` |

Lỗi trả dạng `{ "error": "<mã>" }`; một số kèm `message` tiếng Việt (vd
`ai_unavailable` khi AI lỗi — 502, `file_too_large` khi file > 4 MB — 413).

## Database

Schema nằm trong `src/db/schema.ts`, migration trong `drizzle/`.
(`prisma/migrations/` chỉ là lịch sử trước khi chuyển hẳn sang Drizzle.)

## Deploy

Vercel, vùng function `sin1` (cấu hình trong `vercel.json`, gần Neon
`ap-southeast-1`). Đặt các biến môi trường ở trên trong Vercel project; với
`DATABASE_URL` production dùng host `-pooler` của nhánh main.

Ghi chú cho người phát triển (kiến trúc, quy ước, việc còn treo): xem
[`CLAUDE.md`](CLAUDE.md).
