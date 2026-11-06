# Trà Đình – Học tập: thiết kế và kế hoạch tích hợp vào Amber v4

Lập ngày 14/10/2026. Mockup tham chiếu: canvas "Trà Đình — Học tập" (9 artboard: Nghị Sự Đường – việc hằng ngày, Tổng quan, Lịch tuần, Lịch tháng, Thống kê, Chi tiết khóa, Ghi buổi học, Thêm khóa, Muốn mua).

Phạm vi: phần Học tập của Trà Đình (khóa học, buổi học, mục tiêu, lịch, thống kê) và routine loại "Học" ở Nghị Sự Đường. Chưa đụng tới bài xếp trình độ và điểm kỹ năng.

## 1. Mô hình đã chốt

- Kỹ năng (đã có ở Trà Đình) → Khóa học → Các phần của khóa → Buổi học.
- Mỗi kỹ năng có mục tiêu phút/ngày (Tiếng Anh: 60). Mục tiêu tuần = tổng mục tiêu ngày của các kỹ năng × số ngày.
- Mục tiêu ngày là mục tiêu cứng: đủ mới tính là xong; dưới mức phải có lý do.
- Buổi học chỉ ghi cho hôm nay. Ngày đã qua chỉ được ghi bù lý do, không ghi bù số phút.
- Lịch dự kiến không gắn cố định bài vào ngày; được tính lại từ các phần còn lại mỗi lần đọc. Học vượt thì lịch tự dời lên.
- Chuỗi ngày nằm ở Nghị Sự Đường (routine loại STUDY gắn với một kỹ năng), tính từ buổi học ở Trà Đình, không tick tay.

## 2. Quyết định theo từng phần

| Phần                    | Quyết định                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khóa học                | Tên, giảng viên, nền tảng, link, kỹ năng, trạng thái `WISHLIST` (muốn mua) / `QUEUED` (chờ học) / `ACTIVE` (đang học) / `DONE`. Khóa chờ có thứ tự học (`queue_position`), đổi được. Khóa muốn mua có giá định mua (văn bản tự do) và ghi chú; "Đã mua" chuyển sang `QUEUED`.                                                                                                   |
| Các phần                | Tên, thời lượng (phút), thứ tự, `done_at`. Nhập bằng cách dán mục lục, mỗi dòng "tên phần + thời lượng" (dạng `1h09m`, `32m`, `2:05`); server/Flutter đọc và cho xem trước. Tick xong được ở chi tiết khóa hoặc khi ghi buổi học. Khóa tự sang `DONE` khi mọi phần xong.                                                                                                        |
| Buổi học                | Thuộc một kỹ năng, có thể gắn một khóa. Ngày (giờ VN), số phút 1–1440, các phần đã học (kèm cờ "xong phần"), ghi chú. Một ngày có nhiều buổi. Không có khóa và không chọn phần = buổi ôn tập. Chỉ tạo/sửa/xoá cho hôm nay.                                                                                                                                                      |
| Lý do chưa đủ           | Một bản ghi theo (kỹ năng, ngày): mã lý do `BUSY` / `TIRED` / `AWAY` / `OTHER` + văn bản. Tạo khi lưu buổi học với "Hôm nay dừng ở đây", hoặc ghi bù cho ngày đã qua. Ngày đã qua chưa đủ mục tiêu mà chưa có lý do → `pendingReason`.                                                                                                                                          |
| Routine STUDY           | `routines.kind` thêm `STUDY`, có `skill_id`. Không dùng `routine_logs`. Trạng thái ngày: số phút = tổng buổi học của kỹ năng trong ngày; xong khi ≥ mục tiêu. Chuỗi chỉ đếm ngày đến hạn đã xong; hôm nay chưa đủ không làm chuỗi về 0.                                                                                                                                         |
| Lịch dự kiến            | Mỗi kỹ năng có `video_minutes_per_day` (mặc định 40: phần còn lại của 60 phút là luyện tập) và các thứ ôn tập (`review_weekdays`, mặc định Chủ nhật). Ngày tới: lấy khóa `ACTIVE` rồi `QUEUED` theo thứ tự, trải các phần chưa xong theo `video_minutes_per_day`. Ngày ôn tập không xếp bài. Phần đang học tính đủ thời lượng còn lại của phần (chưa theo dõi phút trong phần). |
| Kế hoạch gốc            | `courses.baseline_finish_date`: chụp lần đầu khi khóa sang `ACTIVE` (và chụp dự kiến cho các khóa `QUEUED` cùng lúc). Có thao tác "Chốt lại kế hoạch" để chụp lại. Sớm/trễ = ngày dự kiến xong − ngày gốc.                                                                                                                                                                      |
| Thống kê                | Khoảng 7 ngày / 30 ngày / tất cả, lọc theo kỹ năng: tổng thời gian, số buổi, trung bình/ngày, số ngày đạt mục tiêu, số phút từng ngày, thời gian theo khóa, so với kế hoạch theo khóa và cả lộ trình, ngày học dài nhất, thứ học nhiều nhất.                                                                                                                                    |
| Lỗi ghi đè điểm kỹ năng | Ngoài phạm vi. Bảng buổi học mới tách khỏi `SkillSession` cũ nên không dính lỗi.                                                                                                                                                                                                                                                                                                |
| Để sau                  | Nhắc học qua Kiều Lâu, ghi buổi học qua chat với amber-brain, kéo-thả thứ tự khóa (bản đầu dùng nút lên/xuống), tự lấy mục lục từ Udemy.                                                                                                                                                                                                                                        |

## 3. Schema (đề xuất, chốt sau bước 0)

Migration `0008_tra_dinh_hoc_tap`:

- `skills` (có sẵn, tên bảng thật xác nhận ở bước 0) + `daily_goal_minutes` (int, null = không đặt mục tiêu), `video_minutes_per_day` (int, mặc định 40), `review_weekdays` (int[], mặc định `{7}`; 1 = thứ Hai).
- `courses`: `id`, `skill_id` (FK, cascade), `title`, `instructor`, `platform`, `url`, `status` (enum `course_status`), `queue_position` (int, null được), `target_price` (text), `note`, `baseline_finish_date` (date), `started_at`, `finished_at`, `created_at`, `updated_at`.
- `course_sections`: `id`, `course_id` (FK, cascade), `position`, `title`, `duration_minutes`, `done_at`.
- `study_sessions`: `id`, `skill_id` (FK, cascade), `course_id` (FK, set null), `session_date` (date, giờ VN), `minutes` (1–1440), `note`, `created_at`.
- `study_session_sections`: `session_id` (FK, cascade), `section_id` (FK, cascade), `marked_done` (bool); khoá chính `(session_id, section_id)`.
- `study_day_reasons`: `id`, `skill_id` (FK, cascade), `reason_date` (date), `code` (enum `study_reason_code`), `text`, `created_at`; duy nhất `(skill_id, reason_date)`.
- `routines` + `skill_id` (FK, set null); enum `routine_kind` thêm `STUDY`.
- Thêm các bảng mới vào `tablesFilter`.

## 4. API (đề xuất)

Khóa học

- `GET /api/tra-dinh/courses?skillId=&status=`; `POST /api/tra-dinh/courses` (kèm `sections` đã đọc, hoặc `sectionsText` để server đọc).
- `GET/PATCH/DELETE /api/tra-dinh/courses/[id]`: GET kèm `sections`, `sessions` gần đây, `progress`, `forecastFinishDate`, `baselineFinishDate`, `deltaDays`.
- `PUT /api/tra-dinh/courses/[id]/sections` (thay cả danh sách, giữ `done_at` theo id), `PATCH /api/tra-dinh/courses/[id]/sections/[sectionId]` (`done`).
- `POST /api/tra-dinh/courses/[id]/move` `{direction: "up"|"down"}`; `POST /api/tra-dinh/courses/[id]/rebaseline`.
- `POST /api/tra-dinh/sections/parse` `{text}` → các phần đọc được và tổng thời lượng (dùng cho xem trước).

Buổi học và lý do

- `GET /api/tra-dinh/sessions?skillId=&from=&to=`.
- `POST /api/tra-dinh/sessions` `{skillId, courseId?, minutes, sections?: [{sectionId, markDone}], note?, stopForToday?: {code, text?}}`; chỉ cho hôm nay (400 `not_today`). Có `stopForToday` mà tổng hôm nay < mục tiêu thì ghi lý do trong cùng transaction; thiếu lý do khi cần → 400 `reason_required`.
- `PATCH/DELETE /api/tra-dinh/sessions/[id]`: chỉ buổi của hôm nay.
- `PUT/DELETE /api/tra-dinh/skills/[id]/reasons/[date]`: ghi/xoá lý do; ngày tương lai → 400 `future_date`; ngày đã đủ mục tiêu → 400 `goal_met`.

Tổng quan, lịch, thống kê

- `GET /api/tra-dinh/overview`: mục tiêu tuần (tổng và từng kỹ năng), số phút từng ngày trong tuần, hôm nay (phút, số buổi, gợi ý phần tiếp), khóa đang học (tiến độ, dự kiến xong, sớm/trễ), số khóa theo trạng thái.
- `GET /api/tra-dinh/schedule?skillId=&from=&to=`: mỗi ngày `{date, kind: "past"|"today"|"planned"|"review", minutes?, goalMinutes, reason?, sessions?, plannedItems?: [{courseId, sectionId, title}], milestones?: [{courseId, type:"finish"}]}`, kèm `aheadSessions` so với kế hoạch gốc.
- `GET /api/tra-dinh/stats?skillId=&range=7|30|all`.

Nghị Sự Đường

- `GET /api/du-an/routines`: routine STUDY có `skillId`, `todayMinutes`, `goalMinutes`, `done`, `streak`, `pendingReason` (ngày gần nhất chưa đủ mục tiêu mà chưa có lý do, hoặc `null`).
- `POST/PATCH` routine nhận `kind: "STUDY"` + `skillId`; tạo STUDY khi kỹ năng chưa có `daily_goal_minutes` → 400 `goal_missing`.
- `PUT .../logs/[date]` với routine STUDY → 400 `study_routine_auto`.

Quy ước như các tòa khác: `withAuth`, zod, JSON trần, POST 201, DELETE `{ok:true}`, `db.transaction` khi ghi nhiều bảng, `logActivity`. Ngày tính theo giờ VN.

## 5. Các bước tích hợp

| #   | Bước                                                                                                                              | Repo    | Trạng thái |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| 0   | Khảo sát Trà Đình hiện có (bảng, API, màn Flutter), code routines, lịch sử migration                                              | cả hai  | chưa làm   |
| 1   | Schema + migration 0008, áp lên dev                                                                                               | backend |            |
| 2   | API khóa học, các phần, đọc mục lục, thứ tự, kế hoạch gốc                                                                         | backend |            |
| 3   | API buổi học, lý do, routine STUDY                                                                                                | backend |            |
| 4   | API tổng quan, lịch dự kiến, thống kê                                                                                             | backend |            |
| 5   | Flutter: Tổng quan Trà Đình, danh sách/chi tiết/thêm khóa, Muốn mua                                                               | Flutter |            |
| 6   | Flutter: sheet ghi buổi học + lý do; thẻ routine STUDY và hỏi lý do ở Nghị Sự Đường                                               | Flutter |            |
| 7   | Flutter: Lịch tuần/tháng                                                                                                          | Flutter |            |
| 8   | Flutter: Thống kê                                                                                                                 | Flutter |            |
| 9a  | Contract test với backend dev                                                                                                     | Flutter |            |
| 9b  | Người dùng thử tay trên dev                                                                                                       | —       |            |
| 10  | Production: nhánh Neon sao lưu, kiểm tra `drizzle.__drizzle_migrations`, migrate, deploy backend, deploy Flutter, thử trên iPhone | cả hai  |            |
| 11  | Tổng kết vào `CLAUDE.md`; cập nhật `amber-kien-truc-v4.md`                                                                        | cả hai  |            |

## 6. Ràng buộc kỹ thuật

Giữ nguyên mục 7 của `claude/nghi-su-duong-du-an-ke-hoach.md` (deploy, chạy local, lệnh DB production, quy ước backend/Flutter). Thêm:

- Trước khi migrate production: kiểm tra `drizzle.__drizzle_migrations` để không sót migration như lần 0006.
- Test tích hợp backend tự từ chối nếu `DATABASE_URL` là production.
- Máy chạy agent không có credential GitHub; người dùng tự push.
