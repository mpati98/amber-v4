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

```bash
npm test                  # unit test (tsx --test src/lib/*.test.ts) — không cần DB
npm run test:brain-logs   # tích hợp /api/brain-logs trên Neon DEV (cần npm run dev)
npm run test:routines     # tích hợp việc hằng ngày + buổi tập trên Neon DEV (cần npm run dev)
npm run test:music      # tích hợp nhạc + Vercel Blob trên Neon DEV (cần npm run dev)
```

Hai bộ test tích hợp tạo user tạm, dọn sạch sau khi chạy và **từ chối chạy nếu `DATABASE_URL` là production**. Với route
chưa có test: kiểm chứng bằng curl với Bearer token (ký JWT bằng `jose` + `MOBILE_JWT_SECRET` trong script tạm) rồi xoá
dữ liệu test. `tsc` lỗi trong `.next/types/validator.ts` sau khi xoá route → `rm -rf .next/types`.

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
| `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN` | Vercel tự cấp cho project đã nối private Blob store; SDK dùng để đọc stream private |
| `PORTFOLIO_ORIGIN` | CORS cho form liên hệ của site portfolio (`next.config.ts`); thiếu thì KHÔNG mở origin nào |
| `RESEND_API_KEY`, `CONTACT_NOTIFY_EMAIL` | `lib/contact.ts` — gửi email báo có tin nhắn liên hệ |
| `AUTH_TRUST_HOST=true` | chỉ cần khi tự host (`next start` ngoài Vercel) |

**`.env` local trỏ Neon DEV BRANCH** (host `…-pooler`). URL production giữ ở
`DATABASE_URL_PRODUCTION` (code không đọc; chỉ dùng khi migrate production, xem "Triển khai production"). Build/test
trên dev trước, áp dụng production sau. `DATABASE_URL_TEST_MIGRATE` (nếu còn trong `.env`) là nhánh thử migration
`test-migrate-0007`, không còn cần — xoá nhánh trên Neon rồi bỏ biến. Kiểm tra host trước mọi test ghi dữ liệu. Production trên
Vercel nên dùng host `-pooler` của main.

`.gitignore` chặn `.env*` — nếu cần `.env.example` phải thêm `!.env.example`.

## Kiến trúc

```
src/
  app/api/**/route.ts   96 route handler (06/11/2026; không có page/layout nào — build vẫn chạy)
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

- **Mọi route cần đăng nhập bọc `withAuth`** (`lib/withAuth.ts`), ngoại trừ
  `/api/music/tracks/:id/stream`, xác thực signed token chỉ đọc theo track vì
  trình phát audio không gửi được Authorization header:
  `export const GET = withAuth(async (req, userId, { params }) => {...})`.
  `withAuth` đã gồm `withApiError` (bắt exception → 500 JSON).
- `getUserId` (`lib/mobile-auth.ts`): thử cookie NextAuth trước, rồi
  `Authorization: Bearer <JWT>`. Access token HS256 sống **1h**; refresh token
  ngẫu nhiên, lưu hash SHA-256 trong `refresh_tokens`, sống **30 ngày**, xoay
  vòng (dùng xong xoá). Đổi mật khẩu xoá toàn bộ refresh token của user.
- Route public (không withAuth, cố ý): `/api/mobile/auth/{login,refresh,logout}`,
  `/api/auth/*` (NextAuth + `register` tự đóng 403 khi đã có user), `/api/public/*`, `/api/health`.
- **`proxy.ts`**: mọi prefix trong `SELF_AUTH_API_PREFIXES` được proxy cho qua
  (route tự check bằng withAuth — **route nào quên withAuth sẽ mở công khai**),
  OPTIONS trả 204 cho preflight. Public routes (không auth) trong
  `PUBLIC_API_PREFIXES`. Thêm nhóm route mới cho Flutter ⇒ phải thêm
  vào **cả** `SELF_AUTH_API_PREFIXES` (proxy.ts) **và** CORS (`next.config.ts`).
  Path ngoài `/api` để Next tự trả 404.
- NextAuth (cookie) chỉ còn là di sản web; `lib/auth.ts` vẫn có
  `pages.signIn: "/login"` trỏ vào trang không còn tồn tại — vô hại.
- Chưa có rate limit cho đăng nhập.

### Quyền sở hữu dữ liệu

- Mọi truy vấn lọc theo `userId`. Bảng con không có `user_id` kiểm tra qua bảng
  cha: `lib/project-access.ts` (`userOwnsProject`). Không có quyền → trả 404 (không lộ tồn tại).
- **Ngoại lệ: Tàng Kinh Các** (`documents`, `publications`, `highlights`,
  `topics`, `reading_goals`) không có cột `user_id` — chỉ cần đăng nhập, không
  lọc theo user (thiết kế 1 người dùng).

### Domain ("tòa")

| Tòa | Prefix | Ghi chú |
|---|---|---|
| Nghị Sự Đường | `/api/projects`, `/api/tasks`, `/api/du-an`, `/api/finance` | không có prefix chung; việc hằng ngày + buổi tập: `/api/du-an/routines` (mục riêng bên dưới). `projects.type`: STANDARD (dự án với KR, việc hằng ngày, bảng Kanban) / FINANCE (1 project/tháng) / PRACTICE (buổi Trà Đình). Học tập cũ (`/api/learn`, bảng `learn_*`, `projects.type = 'LEARN'`) đã gỡ: migration `0014_go_hoc_tap_cu` (có câu kiểm dừng nếu còn dữ liệu) **chưa áp lên production**; áp SAU khi đã deploy bản code không còn đọc `learn_*` (route notifications cũ truy vấn bảng này) |
| Tàng Kinh Các | `/api/tang-kinh-cac` | sách, tài liệu, highlight, mục tiêu đọc, upload Blob private (đọc lại qua `/blob/[...path]`) |
| Nhạc | `/api/music` | track MP3 riêng theo user, client upload Blob qua token giới hạn |
| Kiều Lâu | `/api/kieu-lau` | cảnh báo tính lúc gọi (không lưu DB), nhật ký `activity_logs`, RSS |
| Trà Đình | `/api/tra-dinh` | luyện tiếng Anh với AI: chat, ghi âm→chữ, đọc thành tiếng, bài test đầu vào, điểm 6 kỹ năng. Học tập: `/api/tra-dinh/hoc-tap` (môn, khóa, buổi học, tổng quan, lịch, thống kê) và **kho thẻ từ vựng** `/api/tra-dinh/hoc-tap/cards` (mục riêng bên dưới) |
| Hồ sơ | `/api/user` | đổi tên, đổi mật khẩu |
| Public | `/api/public/*` | contact form (không auth) |

`alert.href` của Kiều Lâu là đường dẫn route phía app Flutter (`/du-an`,
`/finance/<id>`, `/hoc-tap/<id>`) — đổi path phải sửa cả 2 bên.

Ghi thao tác quan trọng bằng `logActivity({ userId, source, action, title, metadata? })`
(`lib/activity-log.ts`); `source` ∈ `DU_AN | FINANCE | LEARN | TRA_DINH | KIEU_LAU | MUSIC`.

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
Nhạc dùng client upload qua `POST /api/music/upload` để không đi qua giới hạn body
của Function; token chỉ cho `audio/mpeg`, tối đa 50 MB. Sau upload, client lưu
metadata qua `POST /api/music/tracks`; cả token lẫn pathname track đều gắn với user.
Blob store hiện là private-only. `GET /api/music/tracks` trả thêm `streamUrl` có
token chỉ đọc cho đúng track, hết hạn sau một giờ; Flutter web phát URL này
thay vì `blobUrl`. Stream relay hỗ trợ HTTP Range để seek được.

### Nhạc (`/api/music`)

- `POST /upload`: `handleUpload` cấp client token sau khi kiểm tra JWT, chỉ cho
  pathname `music/<userId>/*.mp3`, `audio/mpeg`, tối đa 50 MiB; client gửi file
  thẳng lên Blob (private store), không gửi bytes qua API.
- `GET /tracks`: danh sách track của user, theo `position`, `createdAt`, `id`.
  Mỗi track có thêm `streamUrl`; dùng URL này cho trình phát audio (token query
  chỉ có quyền đọc track đó và hết hạn sau một giờ). Không log URL/token này.
- `POST /tracks`: lưu metadata sau upload; `title`, `blobUrl`, `blobPathname`,
  `sizeBytes` bắt buộc; `artist` và `durationSeconds` có thể null/bỏ trống.
  `position` được nối cuối danh sách.
- `PATCH /tracks/:id`: sửa `title`, `artist` (null để xoá) hoặc `position`;
  di chuyển vị trí sẽ sắp lại danh sách liên tục từ 0.
- `DELETE /tracks/:id`: xoá Blob rồi xoá row; track của user khác trả 404.
- `GET /tracks/:id/stream?token=...`: stream private Blob không cần Authorization
  header; hỗ trợ Range đơn (`206`, `Accept-Ranges`, `Content-Range`,
  `Content-Length`) và trả `401` khi token thiếu, không hợp lệ hoặc hết hạn.
  Token stream ký HS256 bằng `MOBILE_JWT_SECRET`, chỉ có quyền với một track và
  hết hạn sau một giờ. Store phải là private; không đổi upload sang public.
- Chạy `npm run test:music` để tích hợp cả upload Blob và CRUD trên Neon DEV;
  script từ chối nếu `DATABASE_URL` trùng host production.

## Triển khai production

- **Backend** deploy bằng `git push origin main` (project Vercel `amber-v4` nối GitHub `mpati98/amber-v4`, nhánh `main`;
  alias `api.duangmai.io.vn`). Build ~40 giây. Deploy backend TRƯỚC, Flutter sau.
- **Đang chạy** (07/11/2026): `dpl_GnH36PhDwqLmo6a6pzoXyMHF1wJu`, build từ commit `ff7dee8` (đợt luyện AI / PRACTICE: migration 0012 `7ed63b1`, API logs `7c9b376`,
  overview `bb30e97`, rà `study_logs` + test `ff7dee8`). **Mốc rollback** (bản trước đó, kho thẻ 06/11): `dpl_8iQN7PQ4QVvsvwzinxXeyCfThF3R` (`1942261`); trước nữa
  `dpl_ALbgRnUGVcT1YAqT4M7YC8FEVYxE` (`965f324`, nhạc 24/10) và `dpl_5pfMRSrbGyDx6oHUgMuffd2mQ31t` (`7aeee22`). Rollback: `vercel rollback <id>` (khôi phục lại: `vercel promote <id>`) hoặc promote từ dashboard. DB không tự lùi —
  migration chỉ thêm cột/bảng/giá trị enum nên bản cũ chạy được trên schema mới (đã kiểm với 0009; 0011 và 0012 là suy luận, chưa thử trên production). **Rủi ro rollback sau 0012**: `ADD VALUE 'PRACTICE'` không gỡ được;
  nếu lùi backend sau khi đã có log PRACTICE, bản cũ coi PRACTICE là học bài (`hasLessonToday`, nhánh "hôm nay" của lịch dùng `!== "CARD_REVIEW"`) nên lịch dự kiến có thể bị đẩy sai, `stats.byCourse` bị gộp sai — kiểm lịch và xoá log PRACTICE nếu cần.
  Chưa kiểm: gói Vercel có cho rollback xa hơn "bản production ngay trước" hay không.
  Máy này không có `.vercel/project.json` của backend: tra deployment hiện tại bằng `vercel api /v9/projects/amber-v4` (`targets.production`), log bằng
  `vercel logs -p amber-v4 -d <id> --since 1h --json`.
- **Migration production đã áp**: 0006 (`agent_logs`) và 0007 (buổi tập) ngày 13/10/2026; 0008 (`tra_dinh_hoc_tap`: 6 bảng `study_*` + cột
  `routines.study_subject_id`) và 0009 (`agent_logs.route` + `cloud_model`, index, CHECK) ngày 22/10/2026 — `drizzle.__drizzle_migrations` = 10/10.
  Lần 22/10 áp trực tiếp, KHÔNG có nhánh sao lưu/diễn tập (người dùng chọn dựa vào point-in-time restore của Neon, cả hai migration chỉ thêm);
  so trước/sau: số dòng của 31 bảng cũ và số dư 2 ví không đổi, 6 bảng mới rỗng. Nhánh sao lưu cũ: `backup-truoc-workout-20261013`.
- **Music migration production 0010** (`0010_wealthy_fat_cobra`, bảng `music_tracks`) đã áp ngày 24/10/2026 sau khi xác nhận đủ 10 migration trước đó.
  `drizzle.__drizzle_migrations` = 11/11; 37 bảng cũ giữ nguyên số dòng, số dư 2 ví không đổi; `music_tracks` mới rỗng. Nhánh backup Neon đã được người dùng xác nhận trước migrate: `backup-truoc-music-20261024`.
- **Migration production 0011** (`0011_noisy_jazinda`: kho thẻ từ vựng) áp ngày **06/11/2026 lúc 16:12 UTC** (mốc khôi phục theo thời điểm: `16:12:11 UTC`).
  `drizzle.__drizzle_migrations` = 12/12; 3 bảng mới (`study_cards`, `study_card_reviews`, `study_card_day_plan_items`) rỗng, 5 enum mới, cột `study_logs.activity`
  (mặc định `LESSON`) và `study_subjects.card_daily_quota` (mặc định 20, CHECK 1–20); 38 bảng cũ giữ nguyên số dòng (đã so với file đếm dòng trước migrate),
  `study_logs` 0 dòng, `study_subjects` 1 dòng quota 20. **KHÔNG có nhánh sao lưu** (người dùng chọn dựa vào point-in-time restore của Neon), nên luôn ghi mốc UTC ngay trước migrate.
  Deploy: backend `dpl_8iQN7PQ4QVvsvwzinxXeyCfThF3R` Ready lúc 16:14:48 UTC; smoke test 401 / CORS / `/api/health` đều đúng; log runtime không có lỗi.
- **Migration production 0012** (`0012_abandoned_jack_flag`: luyện AI) áp ngày **07/11/2026 lúc 08:33:21 UTC** (mốc PITR: `2026-11-07T08:33:21Z`, ghi ngay trước lệnh migrate). `study_log_activity` thêm `PRACTICE`;
  cột `study_logs.practice_session_id` (uuid null, unique index `study_logs_practice_session_id_key`, FK `study_logs_practice_session_id_fk` → `practice_session_details(project_id)` `ON DELETE SET NULL`).
  `drizzle.__drizzle_migrations` = 13/13; `study_logs` 0, `study_cards` 0, `practice_session_details` 1, 41 bảng `public`, số dư ví (Cash 2.387.000, Momo −3.350.565) đều giống hệt trước migrate. **KHÔNG có nhánh sao lưu** (dựa vào PITR).
  Deploy: backend `dpl_GnH36PhDwqLmo6a6pzoXyMHF1wJu` Ready (push `ff7dee8`); smoke test `/api/health` 200, route có token 401, preflight từ `amber.duangmai.io.vn` 204; log runtime không có lỗi.
- **Quy trình migrate production đã chạy tốt** — làm lại đúng thế này:
  1. Sao lưu: tạo nhánh Neon từ production (console; máy này không có `neonctl`). Nếu người dùng bỏ bước này (06/11/2026) thì dựa vào point-in-time restore và ghi mốc UTC (có giây) ngay trước lệnh migrate.
  2. Thử trước trên nhánh tách từ production (`test-migrate-*`): ghi số dòng + số dư ví + số migration đã áp
     (`select count(*) from drizzle.__drizzle_migrations`; nó cho biết migration nào còn treo — lần này 6 đã áp, nghĩa là
     0006 cũng chưa áp). Bảng còn rỗng thì chèn vài dòng tạm cho đúng bảng sẽ bị đổi (backfill) rồi mới migrate, xong xoá.
     Chạy `db:migrate`, kiểm: số dòng và số dư không đổi, id không null/không trùng, index duy nhất có, bảng mới có, số
     migration tăng đúng.
  3. Migrate production: đặt `DATABASE_URL` tường minh cho TỪNG lệnh (từ `DATABASE_URL_PRODUCTION`; `drizzle.config.ts` dùng
     `dotenv/config` nên biến đã đặt sẵn thắng `.env`), **in endpoint trước và dừng nếu không phải
     `ep-divine-feather-b3zba6y0`**, không in chuỗi kết nối, không ghi dòng test lên production. Đọc trước/sau bằng
     kết nối chỉ-đọc. Chạy cả `db:migrate` cho MỌI migration còn treo, không chỉ cái mình vừa viết.
  4. Push → chờ deployment Ready → xác nhận commit + alias (`vercel api /v13/deployments/<id>`) → smoke test không ghi:
     GET không token trả 401 (không 404/500), `/api/health` 200, preflight OPTIONS từ `https://amber.duangmai.io.vn` được phép.
- **Phát hành Nhạc (24/10/2026)**: migration 0010 và backend code đã lên production (`965f324`). Stream route khai báo Node.js runtime và
  `maxDuration = 300` cho Vercel Hobby (plan đã được người dùng xác nhận). Hobby dừng function sau tối đa 300 giây; nếu một response stream
  liên tục lâu hơn, nó sẽ bị cắt. Cần kiểm thử trên iPhone với MP3 dài và xử lý giới hạn này trước khi coi phát liên tục >5 phút là bảo đảm.
- **Máy này không có thông tin đăng nhập GitHub**: người dùng tự `git push`, đừng cố push hay cấu hình credential.
- **Không chạy test hợp đồng / test tích hợp với production** (chúng ghi dữ liệu thật); chỉ chạy trên Neon dev.

## Việc còn treo (chưa quyết)

- Kết thúc buổi Trà Đình và bài test đầu vào **ghi đè** toàn bộ điểm kỹ năng AI
  trả về (kể cả từ buổi chat ngắn) — đang chờ bàn: chấm theo mode / trung bình
  trọng số / giữ "điểm buổi gần nhất". Đừng tự sửa logic chấm điểm.
- Gỡ hẳn NextAuth (cookie) hay giữ; `SKILL_LABEL` trong `lib/skills.ts` không còn ai dùng.
- Rate limit đăng nhập; upload > 4,5 MB cần client upload thẳng lên Blob.
- Kho thẻ: các giới hạn đã biết nằm ở cuối mục "Kho thẻ từ vựng" (thứ tự thẻ trong kế hoạch, nhãn nguồn buổi học, trạng thái "môn chưa có thẻ").
- `prompt-amber-v4-migration.md` là tài liệu lịch sử của đợt chuyển v3 → v4 —
  không sửa nội dung. `README.md` vẫn là mẫu create-next-app.

## Việc hằng ngày và ghi buổi tập (`/api/du-an/routines`)

Bảng `routines` (`kind` CHECK | WORKOUT, mặc định CHECK), `routine_logs` (mỗi dòng = một ngày đã làm; `id` uuid riêng,
`(routine_id, log_date)` duy nhất bằng unique index `routine_logs_routine_id_log_date_key`; `duration_minutes` null với CHECK),
`workout_exercises` (bài của một log, `ON DELETE CASCADE`, `measure` REPS | SETS_REPS | DURATION). Migration **0007**
(số 0006 là `agent_logs`); cả hai đã áp lên production ngày 13/10/2026. Chuỗi ngày không đổi: có log là ngày đó đã làm.

- `GET /` (`?date=` mặc định hôm nay VN): mỗi routine có `kind`, `todayLog` (`null` | `{durationMinutes, exercises[]}`, bài
  theo `position`), và với WORKOUT thêm `lastWorkout` (bài của buổi gần nhất TRƯỚC ngày tham chiếu, `null` nếu chưa có).
  Key `lastWorkout` chỉ xuất hiện ở WORKOUT. Mỗi routine WORKOUT tốn thêm 1 truy vấn `lastWorkout`.
- `POST` / `PATCH /[id]` nhận `kind`. Đổi `kind` khi routine đã có log (bất kỳ ngày nào) → 409 `kind_locked`; gửi đúng kind
  hiện tại thì được.
- `PUT /[id]/logs/[date]`:
  - CHECK: như cũ — idempotent, không nhận ngày tương lai (`future_date`), không nhận ngày không đến hạn (`not_scheduled`),
    **cho phép ngày đã qua**; body bị bỏ qua.
  - WORKOUT: body `{durationMinutes: 1–1440, exercises?: [...]}` (tối đa 50 bài, mặc định `[]`); **chỉ hôm nay**
    (`not_today`). Upsert log + xoá-ghi lại bài trong 1 transaction, gọi lại cùng ngày là sửa buổi tập. Mỗi bài theo
    `measure`: REPS `{name, reps}`, SETS_REPS `{name, sets, reps}`, DURATION `{name, durationSeconds}`; trường thừa bị từ chối
    (400 `{error: zodFlatten}`). Validate ở `lib/workout-input.ts` (có test).
- `DELETE /[id]/logs/[date]`: xoá log, bài tập xoá theo (cascade). Trả routine như PUT.
- Mã lỗi: `routine_not_found` 404, `future_date` / `not_scheduled` / `not_today` 400, `kind_locked` 409. Mọi response PUT/DELETE
  là routine đầy đủ (tính quanh hôm nay).
- Kiểm thử: `npm test` (validate), `npm run test:routines` (tích hợp trên dev branch, cần `npm run dev` ở :3000, từ chối chạy nếu
  DB là production).

## Nhật ký amber-brain (`/api/brain-logs`)

Bảng `agent_logs` (migration 0006; `route` và `cloud_model` từ migration 0009) lưu nhật ký lượt gọi mô hình. Route gồm `GET /` (danh sách, phân trang con trỏ, lọc agent/outcome/ngày/route), `GET /[id]`, `GET /stats`, `PATCH /[id]`, `POST /[id]/feedback`, `POST /ingest` và `GET /export`. Mọi route dùng `withAuth` và lọc theo `userId`; dòng của user khác trả 404. Không có cơ chế tự xóa.

`PATCH /[id]` nhận `correctedOutput` (JSON action hợp lệ hoặc `null` để xoá bản sửa), cập nhật `correctedAt` và đánh dấu dòng đã được người dùng đánh giá mà không tự đổi `accepted`/`rejected`. Bản sửa lưu trong cột hiện có `corrected_output`; không cần migration cho bước này (commit `e7d5934`). `GET /` lọc `?route=LOCAL|CLOUD`. Ingest nhận `route`/`cloudModel` tùy chọn; giá trị route sai thành null.

Export trả thêm `route`, `cloudModel`, `trainingTarget` (ưu tiên `correctedOutput`, ngược lại `parsedOutput`), `eligible` và `eligibleReason`. `eligible=true|false|all` mặc định `all`. Eligibility có một hàm nguồn duy nhất dùng chung với `/stats`; mã reason hiện có là `corrected`, `user_rated`, `confirmed` (commit `074fae7`). Không chuyển lại điều kiện eligibility vào exporter phía brain. `npm run test:brain-logs` kiểm tra API trên DEV, tự từ chối nếu DB production.

`scripts/seed-brain-logs.ts` thêm 303 dòng giả vào DEV (commit `d25435f`), chạy `npx tsx scripts/seed-brain-logs.ts`; `--clean` chỉ xoá các dòng có marker seed. Không dùng dữ liệu seed để huấn luyện. Nợ: lint còn khoảng 71 lỗi `no-explicit-any` ở script e2e; Flutter chưa có contract test cho PATCH `correctedOutput` và lọc `route`.

## Kho thẻ từ vựng của Trà Đình (`/api/tra-dinh/hoc-tap/cards`)

Thiết kế đầy đủ và lịch sử các bước: `docs/tra-dinh-the-tu-vung-ke-hoach.md`. Lên production 06/11/2026 (migration 0011 lúc 16:12 UTC, xem "Triển khai production").
Mọi route dùng `withAuth`, zod, JSON trần, và **mọi truy vấn lọc theo `user_id`**; thẻ / buổi học của user khác trả 404 (`card_not_found`, `subject_not_found`, `log_not_found`).

### Schema (migration `0011_noisy_jazinda`)

- `study_cards`: `subject_id` (cascade), `source_log_id` (→ `study_logs`, `set null`), `phrase` (≤ 255), `phrase_key` (cụm đã chuẩn hoá: cắt, chữ thường, gộp khoảng trắng), `meaning`, `example`, `note`,
  `kind`, `topics text[]` (≤ 3), `stage`, `due_at` (null khi NEW), `review_count`, `not_yet_count`, `last_reviewed_at`, `suspended`. Unique `(subject_id, phrase_key)`, index `(user_id, due_at)`.
- `study_card_reviews`: mọi lượt đánh giá (`rating`, `bucket`, `stage_before`, `stage_after`, `due_after`), index `(card_id, reviewed_at)`; cascade theo thẻ.
- `study_card_day_plan_items`: kế hoạch thẻ của một ngày `(subject_id, plan_date, card_id)` unique + `bucket`. **Không có cột thứ tự.**
- Cột mới: `study_subjects.card_daily_quota` (int, mặc định 20, CHECK 1–20) và `study_logs.activity` (enum `study_log_activity`: `LESSON` mặc định | `CARD_REVIEW`).
- Enum mới: `study_card_stage` (NEW, LEARNING, WEEKLY, MONTHLY, QUARTERLY), `study_card_rating` (NOT_YET, REVIEW_AGAIN, REMEMBERED), `study_card_kind`
  (PHRASAL_VERB, COLLOCATION, IDIOM, PATTERN, EXPRESSION), `study_card_bucket` (DUE, NEW, HARD, RANDOM), `study_log_activity`. Thêm giá trị mới = migration mới.
- Cả ba bảng mới nằm trong `tablesFilter` của `drizzle.config.ts`.

### Route

| Route | Ghi chú |
|---|---|
| `GET /cards?subjectId=&stage=&kind=&topic=&q=&limit=&cursor=` | `limit` mặc định 50, tối đa 200; con trỏ theo `(created_at desc, id)` — `created_at` giữ dạng văn bản có micro giây (đi qua `Date` của JS sẽ cắt còn mili giây và làm sót thẻ); `q` khớp cụm hoặc nghĩa, không phân biệt hoa thường; trả `{cards, counts, nextCursor}`, `counts` (theo giai đoạn + `total` + `suspended`) của cả môn, bỏ qua mọi bộ lọc |
| `POST /cards` (201), `GET/PATCH/DELETE /cards/[id]` | PATCH chỉ nhận `phrase, meaning, example, note, kind, topics, suspended` (khoá lạ bị bỏ qua; không đổi được môn, giai đoạn, hạn, số đếm); validate thẻ sau khi gộp; 409 `duplicate_phrase`; DELETE `{ok:true}` xoá theo lượt ôn và mục kế hoạch (cascade) |
| `POST /cards/parse {subjectId, text}` | Xem trước, không lưu: `{cards, errors, duplicates, existing}`; `cards` = thẻ SẼ được tạo (đã bỏ lặp trong đầu vào và thẻ đã có); mỗi mục có `index` (từ 0) |
| `POST /cards/import {subjectId, logId?, cards[]}` (201) | Tối đa 100; có thẻ lỗi → 400 `invalid_cards` kèm `errors`, không lưu gì; bỏ qua (không lỗi) thẻ lặp / đã có; `ON CONFLICT DO NOTHING` trên `(subject_id, phrase_key)` nên nhập song song không tạo trùng; `created_at` tăng dần theo thứ tự nhập; một `logActivity` (`study_card.imported`) mỗi lần; trả `{created, skipped}` |
| `GET /cards/queue?subjectId=` | Tạo kế hoạch hôm nay lần đầu trong ngày (và bù thêm nếu còn chỗ), khoá dòng môn `FOR NO KEY UPDATE`; trả `{date, quota, cards, progress, counts, soonestDueAt}`; mỗi thẻ có `bucket` và `next` (kết quả `{stage, dueAt}` của từng mức đánh giá) |
| `POST /cards/[id]/review {rating}` (201) | Khoá dòng thẻ `FOR UPDATE` nên bấm đúp / song song chỉ áp dụng một lần; trả `{card, progress, soonestDueAt}`; 409 theo thứ tự kiểm tra: `card_suspended`, `not_in_today_plan`, `already_finished_today`, `not_due_yet` |
| `GET /cards/insights?subjectId=&days=` | `days` ∈ 7, 30 (mặc định), 90, khác → 400 `invalid_days`; trả `{days, minCards: 10, totals, byKind, byTopic, byLesson, hardestCards}` |
| `GET /cards/topics?subjectId=` | `{topics: [{topic, cards}]}`, nhiều thẻ trước rồi theo chữ cái; đếm cả thẻ tạm dừng |
| `GET /overview` | mỗi môn thêm khối `cards: {planned, finished, quota, nextReviewDay}` — **chỉ đọc, không tạo kế hoạch** (môn chưa mở hàng ôn: `planned = finished = 0`) |

`GET /api/tra-dinh/hoc-tap/overview`, `/logs`, `/stats`, `/schedule` giữ nguyên dạng cũ, chỉ thêm trường (app Flutter cũ không gửi `activity` vẫn chạy).

### Buổi ôn thẻ (`study_logs.activity = CARD_REVIEW`)

- `POST /logs` nhận `activity` (thiếu = `LESSON`). CARD_REVIEW: chỉ `subjectId`, `minutes` (1–1440), `note`; gửi `courseId` hoặc `sections` → 400 `card_review_no_course` / `card_review_no_sections`.
  Nhiều buổi mỗi ngày được; chỉ tạo / sửa / xoá cho hôm nay như buổi học bài.
- `PATCH /logs/[id]` của buổi CARD_REVIEW chỉ đổi `minutes` và `note`; gửi `activity` khác → 400 `activity_locked`.
- Mọi response log (`GET /logs`, `log` của POST/PATCH, `logs` của lịch) có thêm `activity`. `logActivity` ghi "Ôn thẻ N phút: <môn>".

### Hàm thuần trong `src/lib` (có unit test, không cần DB; `npm test` = 259 test)

| File | Làm gì |
|---|---|
| `study-card-key.ts` | `phraseKey` |
| `study-card-parse.ts` | `validateCard` (một thẻ), `parseCards`, `parseCardsText` (nhận cả khối ```json); cụm phải ≥ 2 từ, `kind` đúng một trong 5 giá trị, ≤ 3 chủ đề chữ thường, tối đa 100 thẻ |
| `study-card-schedule.ts` | `scheduleCard`, `nextFor` |
| `study-card-queue.ts` | `buildDayPlan`, `splitSlots` |
| `study-card-day.ts` | `classifyCard`, `summarizeDay`, `isExtraReview`, `comparePlanCards`, `dayBounds` |
| `study-card-insights.ts` | `buildInsights`, `lessonLabel`, `periodStart`, `countTopics` |
| `vn-time.ts` (phần thêm) | `vnDayStart`, `monthBoundsOfIso`, `quarterBoundsOfIso`, `vnQuarterBounds`, `firstReviewDayOf`, `nextReviewDay`, `DEFAULT_REVIEW_WEEKDAYS` (chỉ thêm, không đổi hàm cũ) |

Phần dùng DB (không thuần): `study-card-plan.ts` (`ensureDayPlan`, `loadDays`, `queueCard`) và `study-cards.ts` (view, đếm, con trỏ).

### Luật nghiệp vụ

- **Ba mức đánh giá, chuỗi giai đoạn** (mọi ngày theo giờ VN, lịch dương; "ngày ôn" = `study_subjects.review_weekdays`, mặc định Chủ nhật; hạn đặt ở 00:00 VN của ngày đó):
  `NOT_YET` → LEARNING, hạn sau 5 phút · `REVIEW_AGAIN` → LEARNING, hạn 00:00 ngày mai · `REMEMBERED`: NEW/LEARNING → WEEKLY (ngày ôn kế tiếp sau hôm nay),
  WEEKLY → MONTHLY (ngày ôn đầu tiên của THÁNG dương lịch kế tiếp), MONTHLY/QUARTERLY → QUARTERLY (ngày ôn đầu tiên của QUÝ dương lịch kế tiếp).
- **Kế hoạch ngày tối đa 20 thẻ** (`card_daily_quota` ≤ 20), tạo một lần khi mở hàng ôn lần đầu trong ngày, lưu ở `study_card_day_plan_items`, bù thêm khi còn chỗ (không bao giờ bỏ mục đã có):
  1. **DUE** trước: thẻ không NEW, không tạm dừng, `due_at` đến hết hôm nay (VN), quá hạn lâu nhất trước, tối đa quota; dư thì dồn sang ngày sau.
  2. Chỗ còn lại R chia **70/20/10**: khó = làm tròn R/5, ngẫu nhiên = làm tròn R/10, mới = phần còn lại.
  3. NEW theo thứ tự tạo; HARD = không NEW, chưa đến hạn, ≥ 2 lượt NOT_YET trong 30 ngày, xếp theo tỷ lệ NOT_YET giảm dần rồi thẻ ôn lâu nhất; RANDOM = phần còn lại, xáo có hạt giống `subjectId:ngày`.
  4. Thiếu nhóm nào thì bù theo thứ tự NEW → HARD → RANDOM; vẫn thiếu thì để trống, không ép đủ 20. Chỉ ôn được thẻ nằm trong kế hoạch hôm nay.
- **Trạng thái thẻ trong ngày**: PENDING (hôm nay chưa ôn) · FINISHED (lượt cuối hôm nay không phải NOT_YET, hoặc là NOT_YET nhưng hạn quay lại rơi sang ngày khác) · RETURNING (lượt cuối là NOT_YET, hạn còn trong
  hôm nay: hiện lại khi `due_at ≤ now`, còn đợi thì tính vào `soonestDueAt`). Thẻ tạm dừng không tính vào `planned` / `finished` / hàng ôn.
- **Ôn thêm** (`isExtra`): chỉ khi thẻ thuộc nhóm HARD hoặc RANDOM **và đây là lượt ôn đầu tiên trong ngày** thì `REMEMBERED` GIỮ NGUYÊN giai đoạn và hạn. NOT_YET / REVIEW_AGAIN vẫn áp dụng như thường; lượt sau NOT_YET trong cùng
  ngày là lượt thường. Server tính sẵn điều này trong `next` (đã kiểm trên dữ liệu thật: thẻ HARD/RANDOM có `next.REMEMBERED` trùng giai đoạn và hạn hiện tại).
- **Nhóm khó là tích luỹ**: một thẻ "từng Chưa nhớ" khi `not_yet_count ≥ 1` (đếm suốt đời thẻ, kể cả sau này Đã nhớ). Nhóm (theo loại, chủ đề, buổi học nguồn) chỉ hiện khi có **≥ 10 thẻ từng Chưa nhớ** (`minCards`); xếp theo tỷ lệ
  rồi số thẻ. Thẻ hay quên: `not_yet_count ≥ 3`, nhiều nhất trước, tối đa 10. Chỉ `totals` (`reviews`, `notYetRate`, `promotedToWeekly`) tính trong kỳ `days` (ngày VN, tính cả hôm nay); thẻ có nhiều chủ đề tính ở mỗi chủ đề.
  Nhãn buổi học "dd/MM · tên khóa" (buổi không khóa "Ôn tập", buổi ôn thẻ "Ôn thẻ"); thẻ không có buổi nguồn không tạo nhóm buổi học.

### Chỗ đọc `study_logs` xử lý CARD_REVIEW

- **Tính cả phút CARD_REVIEW** (không cần code riêng): `dayTotals` (tổng ngày, tuần, mục tiêu, lý do thiếu), `pendingReasonDates`, chuỗi ngày routine STUDY, `goal_met`, `today.logCount` của overview.
- **Chỉ tính buổi LESSON**: `forecastSubject` (`hasLessonToday` trong `study-forecast.ts`: có buổi hôm nay mới đẩy lịch dự báo sang ngày mai) và nhánh "hôm nay" của `buildSchedule`
  (bỏ kế hoạch học bài chỉ khi có buổi LESSON). Hai chỗ này phải đi cùng nhau.
- **Thống kê `byCourse`**: buổi CARD_REVIEW thành mục riêng `title = "Ôn thẻ"` (`CARD_REVIEW_COURSE_TITLE`). Mục này và mục "Ôn tập" đều có `courseId: null` → **client không được dùng `courseId` làm khoá duy nhất**
  (màn Thống kê Flutter cũ dùng nó làm khoá widget và sẽ ném "Duplicate keys found" khi gặp hai mục này; đã sửa bằng `statsCourseKeys`).
- `logViews`, lịch và `recentLogs` của khóa chịu được buổi không khóa; `recentLogs` lọc theo khóa nên không bao giờ có buổi ôn thẻ.

### Kiểm thử e2e (Neon DEV, cần `npm run dev` ở :3000; từ chối chạy nếu `DATABASE_URL` trùng host production; tự tạo user tạm và xoá ở `finally`)

```bash
npm test                                       # 259 unit test, không cần DB
npx tsx scripts/study-cards-e2e.ts             # CRUD, parse, import (kể cả nhập song song), lọc, phân trang, phân quyền
npx tsx scripts/study-cards-queue-e2e.ts       # kế hoạch ngày, review, mọi mã 409, ôn song song, khối cards của overview
npx tsx scripts/study-cards-insights-e2e.ts    # nhóm khó, ngưỡng 10, kỳ 7/30/90, topics (gài thẻ + lượt ôn thẳng vào DB)
npx tsx scripts/study-logs-e2e.ts              # buổi học + CARD_REVIEW + routine STUDY (chuỗi ngày, lý do)
npx tsx scripts/study-overview-e2e.ts          # tổng quan, lịch, thống kê
```

`study-cards-queue-e2e` tự bỏ qua nếu còn < 10 phút tới nửa đêm giờ VN (NOT_YET cần hạn quay lại trong ngày). Trước khi push: `npx tsc --noEmit`, `npm test`, `npm run build`.

### Giới hạn đã biết (chưa làm)

- **Kế hoạch ngày không lưu thứ tự thẻ** (bảng không có cột vị trí). Hàng ôn dùng thứ tự suy ra: DUE → NEW → HARD → RANDOM; DUE theo `due_at`, các nhóm còn lại theo ngày tạo rồi id — không còn là thứ tự xáo của
  RANDOM hay thứ tự tỷ lệ của HARD lúc tạo. Muốn đúng thứ tự gốc cần cột `position` (migration mới).
- **Mặt sau thẻ ôn không có nhãn nguồn buổi học**: `GET /cards/queue` chỉ trả `sourceLogId`, chưa trả nhãn "dd/MM · khóa".
- **Insights không có trạng thái "môn chưa có thẻ nào"**: phản hồi không nói số thẻ của môn, nên môn trống và môn chưa đủ ngưỡng giống nhau (mảng rỗng).
- Thẻ và lượt ôn chưa đẩy vào `agent_logs`; chưa có liên kết giữa các thẻ, đo thời gian trả lời, nhắc ôn qua Kiều Lâu.
