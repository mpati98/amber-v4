# Nghị Sự Đường – Ghi nhận tập thể dục hằng ngày

Lập ngày 12/10/2026, lên production tối 13/10/2026. Mở rộng "Việc hằng ngày" (`routines`, `routine_logs`) đã có; không tạo tòa hay màn mới.

## 1. Yêu cầu

- Mỗi ngày một buổi tập: tổng số phút, kèm danh sách bài đã tập.
- Mỗi bài đo theo một trong ba kiểu: số lần (chống đẩy 20), số hiệp × số lần (squat 3×15), hoặc thời lượng (plank 60 giây).
- Buổi tập chỉ ghi cho hôm nay, không ghi bù. (Routine CHECK vẫn cho tick ngày đã qua, chỉ chặn ngày tương lai và ngày không đến hạn; giữ nguyên.)

## 2. Thiết kế

Schema (migration `0007_petite_satana`):
- `routines` + `kind` (enum `routine_kind`: `CHECK` | `WORKOUT`, mặc định `CHECK`).
- `routine_logs`: khoá chính mới `id` (uuid); cặp `(routine_id, log_date)` vẫn duy nhất qua index `routine_logs_routine_id_log_date_key`. Thêm `duration_minutes` (int, null được).
- Bảng mới `workout_exercises`: `id`, `routine_log_id` (FK tới `routine_logs.id`, cascade), `position`, `name`, `measure` (enum `exercise_measure`: `REPS` | `SETS_REPS` | `DURATION`), `sets`, `reps`, `duration_seconds`. Đã có trong `tablesFilter`.

API (backend 8807f21):
- `GET /api/du-an/routines` (và kết quả của POST, PATCH, PUT, DELETE): mỗi routine có `kind`, `todayLog` (`null` hoặc `{durationMinutes, exercises[]}`, bài xếp theo `position`), và với WORKOUT có thêm `lastWorkout` (bài của buổi gần nhất trước hôm nay, hoặc `null`).
- `PUT /api/du-an/routines/[id]/logs/[date]` cho WORKOUT: `{durationMinutes: 1..1440, exercises?: [...]}`, tối đa 50 bài. Mỗi bài là `{name, measure:"REPS", reps}`, `{name, measure:"SETS_REPS", sets, reps}` hoặc `{name, measure:"DURATION", durationSeconds}`; trường không thuộc kiểu đo bị từ chối. Gọi lại trong ngày là sửa buổi. Lỗi: 400 zod, 400 `not_today` / `future_date` / `not_scheduled`, 404 `routine_not_found`.
- `DELETE` log trả routine với `todayLog: null`; bài tập bị xoá theo.
- `PATCH` routine nhận `kind`; đổi khi đã có log trả 409 `kind_locked`.
- Chuỗi ngày không đổi: có log là ngày đó đã làm.
- Test tích hợp: `npm run test:routines` (cần `npm run dev`; tự từ chối nếu `DATABASE_URL` là production).

Flutter (b1209cd, contract test 0598467):
- Model trong `routine.dart` (`RoutineKind`, `ExerciseMeasure`, `Exercise`, `TodayLog`); thiếu `kind` thì coi là CHECK.
- Form việc hằng ngày có "Loại": "Việc thường" / "Tập thể dục"; khoá khi routine đã có log.
- `workout_log_sheet.dart` (mở bằng `showFinanceSheet`): số phút bắt buộc 1–1440, các dòng bài theo kiểu đo; điền sẵn từ `todayLog`, không thì bài từ `lastWorkout` (để trống số phút). Lưu là PUT; "Xoá buổi tập" là DELETE.
- Thẻ routine WORKOUT: icon tạ, xong thì hiện "30 phút · 4 bài". Không mở được khi hôm nay không đến hạn.
- `routineErrorMessage` (`workout_form.dart`) đổi mã lỗi backend thành câu tiếng Việt.

## 3. Các bước

| # | Bước | Repo | Trạng thái |
|---|---|---|---|
| 1 | Schema + migration 0007, áp lên dev | backend | xong, 98f2ef2 |
| 2 | API log buổi tập | backend | xong, 8807f21 |
| 3 | Sheet ghi buổi tập, loại routine trong form | Flutter | xong, b1209cd |
| 4a | Contract test với backend dev | Flutter | xong, 0598467 (6/6) |
| 4b | Người dùng thử tay trên dev | — | xong |
| 5a | Commit `CLAUDE.md`; nhánh Neon sao lưu; thử migration trên nhánh tách từ production | cả hai | xong: docs 6228a47 (backend), 95162a5 (Flutter) |
| 5b | Migrate production (áp 0006 và 0007; số dòng và số dư ví không đổi) | backend | xong 13/10 |
| 5c | Deploy backend | backend | xong: dpl_FyeZ2MAr67PuXrisVbLitU3DBa4M (6228a47) |
| 5d | Deploy Flutter, thử tay trên iPhone | Flutter | xong 13/10 |

Rollback: backend `vercel rollback dpl_EFfp2L1FjKaDkNapWnZJWiD96CEm` (e83ba54, chạy được trên schema mới). DB: nhánh Neon `backup-truoc-workout-20261013`.

Ghi chú:
- Migration 0006 (`agent_logs`) chưa từng được áp lên production dù code `/api/brain-logs` đã chạy ở đó từ e83ba54; đợt này đã áp kèm.
- Máy chạy agent không có credential GitHub; người dùng tự push.

## 4. Để sau

- Lịch sử và thống kê buổi tập, danh sách bài tập dựng sẵn, nhập buổi tập qua chat với amber-brain.
- Xoá nhánh Neon `test-migrate-0007`; giữ `backup-truoc-workout-20261013` vài ngày rồi xoá.
