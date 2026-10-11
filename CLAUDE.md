# amber-v4 — backend API cho app Flutter

Next.js 16 (App Router, Turbopack) **chỉ còn API**: giao diện web đã gỡ hết
(Giai đoạn 2). Client duy nhất là app Flutter ở repo riêng `amber_flutter`.
Ứng dụng cá nhân, 1 người dùng. Deploy Vercel (vùng `sin1`), DB Neon Postgres
(vùng `ap-southeast-1`), file trên Vercel Blob, AI qua Groq.

Comment trong code viết tiếng Việt — giữ nguyên thói quen đó.

## Lệnh

```bash
npm run dev          # dev server :3000
npm run build        # next build — phải sạch trước khi commit
npx tsc --noEmit     # type check
npx eslint src       # lint (2 cảnh báo `_answer` ở tra-dinh/placement-test là cố ý)
npm run db:studio    # drizzle-kit studio
npx tsx scripts/create-admin.ts <email> <password>   # tạo user / đặt lại mật khẩu nếu đã có
```

Không có test tự động trong repo này. Kiểm chứng bằng curl với Bearer token
(ký JWT bằng `jose` + `MOBILE_JWT_SECRET` trong script tạm) rồi xoá dữ liệu test.
`tsc` lỗi trong `.next/types/validator.ts` sau khi xoá route → `rm -rf .next/types`.

## Môi trường

Biến code cần (không bao giờ in giá trị ra log/output):

| Biến | Dùng ở |
|---|---|
| `DATABASE_URL` | `src/db/index.ts`, `drizzle.config.ts` |
| `MOBILE_JWT_SECRET` | `lib/mobile-auth.ts` (ký/verify access token) |
| `GROQ_API_KEY` | `lib/groq.ts` |
| `MOBILE_APP_ORIGIN` | CORS trong `next.config.ts` — thiếu thì thành `*`; production phải là domain app Flutter |
| `AUTH_SECRET` | NextAuth tự đọc |
| `BLOB_READ_WRITE_TOKEN` | `@vercel/blob` tự đọc |
| `AUTH_TRUST_HOST=true` | chỉ cần khi tự host (`next start` ngoài Vercel) |

**`.env` local trỏ Neon DEV BRANCH** (host `…-pooler`). URL production giữ ở
`DATABASE_URL_PRODUCTION` (code không đọc). Build/test trên dev trước, áp dụng
production sau. Kiểm tra host trước mọi test ghi dữ liệu. Production trên
Vercel nên dùng host `-pooler` của main.

`.gitignore` chặn `.env*` — nếu cần `.env.example` phải thêm `!.env.example`.

## Kiến trúc

```
src/
  app/api/**/route.ts   52 route handler (không có page/layout nào — build vẫn chạy)
  db/index.ts           postgres.js + drizzle, { max: 5, prepare: false, idle_timeout: 20 }
  db/schema.ts          toàn bộ schema Drizzle (1 file)
  lib/                  helper dùng chung (xem dưới)
  proxy.ts              middleware Next 16 (tên mới của middleware.ts)
  types/next-auth.d.ts
drizzle/                migration Drizzle (nguồn sự thật hiện tại)
prisma/migrations/      lịch sử Prisma cũ — chỉ để tham khảo, Prisma đã gỡ
vercel.json             { "regions": ["sin1"] } — gần Neon Singapore
```

### Xác thực

- **Mọi route cần đăng nhập bọc `withAuth`** (`lib/withAuth.ts`):
  `export const GET = withAuth(async (req, userId, { params }) => {...})`.
  `withAuth` đã gồm `withApiError` (bắt exception → 500 JSON).
- `getUserId` (`lib/mobile-auth.ts`): thử cookie NextAuth trước, rồi
  `Authorization: Bearer <JWT>`. Access token HS256 sống **1h**; refresh token
  ngẫu nhiên, lưu hash SHA-256 trong `refresh_tokens`, sống **30 ngày**, xoay
  vòng (dùng xong xoá). Đổi mật khẩu xoá toàn bộ refresh token của user.
- Route public (không withAuth, cố ý): `/api/mobile/auth/{login,refresh,logout}`,
  `/api/auth/*` (NextAuth + `register` tự đóng 403 khi đã có user), `/api/health`.
- **`proxy.ts`**: mọi prefix trong `SELF_AUTH_API_PREFIXES` được proxy cho qua
  (route tự check bằng withAuth — **route nào quên withAuth sẽ mở công khai**),
  OPTIONS trả 204 cho preflight. Thêm nhóm route mới cho Flutter ⇒ phải thêm
  vào **cả** `SELF_AUTH_API_PREFIXES` (proxy.ts) **và** CORS (`next.config.ts`).
  Path ngoài `/api` để Next tự trả 404.
- NextAuth (cookie) chỉ còn là di sản web; `lib/auth.ts` vẫn có
  `pages.signIn: "/login"` trỏ vào trang không còn tồn tại — vô hại.
- Chưa có rate limit cho đăng nhập.

### Quyền sở hữu dữ liệu

- Mọi truy vấn lọc theo `userId`. Bảng con không có `user_id` kiểm tra qua bảng
  cha: `lib/project-access.ts` (`userOwnsProject`), `lib/learn-access.ts`
  (`findOwnedCourse`, `findOwnedLesson`). Không có quyền → trả 404 (không lộ tồn tại).
- **Ngoại lệ: Tàng Kinh Các** (`documents`, `publications`, `highlights`,
  `topics`, `reading_goals`) không có cột `user_id` — chỉ cần đăng nhập, không
  lọc theo user (thiết kế 1 người dùng).

### Domain ("tòa")

| Tòa | Prefix | Ghi chú |
|---|---|---|
| Nghị Sự Đường | `/api/projects`, `/api/tasks`, `/api/du-an`, `/api/finance`, `/api/learn` | không có prefix chung. `projects.type`: STANDARD / FINANCE (1 project/tháng) / LEARN (khóa học) / PRACTICE (buổi Trà Đình) |
| Tàng Kinh Các | `/api/tang-kinh-cac` | sách, tài liệu, highlight, mục tiêu đọc, upload Blob private (đọc lại qua `/blob/[...path]`) |
| Kiều Lâu | `/api/kieu-lau` | cảnh báo tính lúc gọi (không lưu DB), nhật ký `activity_logs`, RSS |
| Trà Đình | `/api/tra-dinh` | luyện tiếng Anh với AI: chat, ghi âm→chữ, đọc thành tiếng, bài test đầu vào, điểm 6 kỹ năng |
| Hồ sơ | `/api/user` | đổi tên, đổi mật khẩu |

`alert.href` của Kiều Lâu là đường dẫn route phía app Flutter (`/du-an`,
`/finance/<id>`, `/hoc-tap/<id>`) — đổi path phải sửa cả 2 bên.

Ghi thao tác quan trọng bằng `logActivity({ userId, source, action, title, metadata? })`
(`lib/activity-log.ts`); `source` ∈ `DU_AN | FINANCE | LEARN | TRA_DINH | KIEU_LAU`.

## Quy ước bắt buộc

- **Giờ Việt Nam**: "hôm nay", ranh giới tháng, năm dùng `lib/vn-time.ts`
  (`vnToday`, `vnYear`, `vnMonthBounds`) — không dùng `new Date()` thô (server
  chạy UTC). Cột `date` là chuỗi `"YYYY-MM-DD"`.
- **Validate input bằng zod** `.safeParse()` → 400 `{ error: parsed.error.flatten() }`.
- **Ghi nhiều bảng ⇒ `db.transaction`**. Trong 1 transaction `now()`/`defaultNow()`
  trả cùng 1 giá trị — cần thứ tự thì gán `createdAt` tường minh (xem tra-dinh messages).
- `schema.ts`: mọi `pgTable()` phải đứng **trước** mọi `relations()` (xen kẽ gây
  lỗi TDZ lúc runtime mà tsc không bắt).
- Tiền (numeric) trả về dạng chuỗi — client tự parse.
- Route file chỉ được export handler HTTP + config segment (`maxDuration`…);
  hàm phụ đặt trong `src/lib/`.

### Groq / AI (`lib/groq.ts`)

- Model: chat `openai/gpt-oss-120b`, Whisper `whisper-large-v3-turbo`, TTS
  `canopylabs/orpheus-v1-english` (voice `austin`, trả WAV header 0xFFFFFFFF —
  client tự sửa header). Đã gọi thử thật trước khi hardcode — đổi model phải thử lại.
- Mọi lệnh gọi qua `groqFetch` (timeout 45s gồm cả đọc body); lỗi nào cũng ném
  `GroqError`. Route trả 502 bằng `aiUnavailableResponse(err)` →
  `{ error: "ai_unavailable", message }` (mã `ai_unavailable` là hợp đồng với client).
- Route gọi Groq khai báo `export const maxDuration = 60` (feeds/refresh: 30).
- **Không tin dữ liệu AI**: điểm phải là số hữu hạn → `Math.round`; `cefrLevel`
  qua `validCefrLevel` (chỉ A1–C2, cột `varchar(4)`); JSON qua `parseJsonFromModel`.
- AI lỗi thì **không ghi gì**: tin nhắn chỉ insert (user + assistant, 1
  transaction) sau khi Groq trả lời; kết thúc buổi (PATCH `sessions/[id]`) không
  lưu trữ/không ghi điểm nếu AI lỗi hoặc trả JSON thiếu `summary`.
- Groq TTS giới hạn 1200 token/phút ở gói hiện tại — tin dài dễ dính 429 (→ 502).

### Upload

Vercel giới hạn body 4,5 MB → `upload` và `transcribe` chặn > 4 MB, trả 413
`{ error: "file_too_large", message }`. Tên file qua `sanitizeFileName`
(`lib/filename.ts`) trước khi ghép đường dẫn Blob (giữ tiền tố timestamp).

## Việc còn treo (chưa quyết)

- Kết thúc buổi Trà Đình và bài test đầu vào **ghi đè** toàn bộ điểm kỹ năng AI
  trả về (kể cả từ buổi chat ngắn) — đang chờ bàn: chấm theo mode / trung bình
  trọng số / giữ "điểm buổi gần nhất". Đừng tự sửa logic chấm điểm.
- Gỡ hẳn NextAuth (cookie) hay giữ; `SKILL_LABEL` trong `lib/skills.ts` không còn ai dùng.
- Rate limit đăng nhập; upload > 4,5 MB cần client upload thẳng lên Blob.
- `prompt-amber-v4-migration.md` là tài liệu lịch sử của đợt chuyển v3 → v4 —
  không sửa nội dung. `README.md` vẫn là mẫu create-next-app.

## Nhật ký amber-brain (`/api/brain-logs`)

Bảng `agent_logs` (migration 0006) lưu nhật ký lượt gọi mô hình của amber-brain để dựng dataset fine-tune. Route: `GET /`
(danh sách tóm tắt, phân trang con trỏ, lọc agent/outcome/ngày), `GET /[id]`, `GET /stats`, `PATCH /[id]` (CHỈ
`excludeFromTraining`), `POST /[id]/feedback` (accepted|rejected), `POST /ingest` (brain đẩy lên, upsert theo id, tối đa 25
dòng), `GET /export` (brain kéo về, dòng đầy đủ). Mọi route `withAuth` và lọc theo `userId`; dòng của user khác = 404.
Không có cơ chế tự xóa. Quy tắc "mẫu đủ điều kiện" ở `lib/brain-logs-db.ts` PHẢI khớp `scripts/export_dataset.py` của
amber-brain; `npm run test:brain-logs` kiểm bằng chung `amber-brain/tests/fixtures/eligibility.json`.
Ingest không bao giờ đặt `excludeFromTraining` và chỉ đổi outcome khi `outcomeAt` mới hơn bản đang có. Kiểm thử tích hợp trên dev branch (cần `npm run dev`): `npm run test:brain-logs` (từ chối chạy nếu DB là production).

