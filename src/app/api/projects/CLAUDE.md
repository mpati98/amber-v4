# /api/projects — Dự án và KR (Nghị Sự Đường)

Bảng `projects` dùng chung nhiều loại (`type`): `STANDARD` (dự án có KR + bảng việc), `FINANCE` (1 project / tháng, xem `/api/finance`),
`PRACTICE` (buổi luyện Trà Đình). Mọi route bọc `withAuth`, lọc theo `user_id`. Các route `/[id]/...` chỉ nhận project **STANDARD**
của mình (`findOwnedStandardProject`); khác → 404 `project_not_found`.

## Route

| Route | Method | Ghi chú |
|---|---|---|
| `/` | GET | `?type=STANDARD[&status=ACTIVE\|PAUSED\|DONE]` lọc theo `status`, mới trước; type khác / không type: lọc `archivedAt is null` |
| `/` | POST | `{ name, color?, type? (tự do, mặc định STANDARD), goal?, startDate?, endDate? }` → 201 |
| `/[id]` | GET | project + `keyResults` (kèm tiến độ) |
| `/[id]` | PATCH | `{ name?, goal?, color?, startDate?, endDate?, status? }`; sang DONE phải qua `/close` (400 `use_close_endpoint`); mở lại DONE → ACTIVE/PAUSED được (xoá `closedAt`) |
| `/[id]` | DELETE | xoá hẳn; DB xoá theo việc, KR, checklist; giao dịch tài chính chỉ gỡ `linked_project_id` |
| `/[id]/close` | POST | `{ note? ≤ 5000 }` — `status = DONE` + `closedAt` và tạo 1 tài liệu tổng kết ở Tàng Kinh Các trong cùng transaction; đã DONE → 400 `project_already_done` |
| `/[id]/key-results` | GET / POST | danh sách / tạo KR |
| `/[id]/key-results/[krId]` | PATCH / DELETE | lỗi `key_result_not_found` (404) |

## Trường

- `status` (STANDARD): `ACTIVE` | `PAUSED` | `DONE` (`PROJECT_STATUSES`, `lib/project-input.ts`). STANDARD không dùng `archivedAt`.
- KR (`lib/key-result-input.ts`): `{ name ≤ 255, mode: AUTO | MANUAL, unit? ≤ 32, target?, current? }`.
  AUTO: tiến độ đếm từ việc gắn `krId` (lưu target = current = 0). MANUAL: `target ≥ 1`, `0 ≤ current ≤ target`.
- Ngày `"YYYY-MM-DD"`; `endDate < startDate` → 400 `end_before_start`.

## Liên quan

- Màn Dự án dùng `GET /api/du-an/summary` (số liệu + `attention`) và `GET /api/du-an/overview?year=`; cả hai chỉ đọc project STANDARD.
- Task ats-app không tạo project ở đây — xem `/api/du-an/ats-tasks`.
