# /api/tasks — Việc của dự án (Nghị Sự Đường)

Việc (`tasks`) + checklist con (`checklist_items`). Mọi route bọc `withAuth`, lọc theo `user_id`; việc của user khác → 404.
Task từ ats-app KHÔNG nằm ở đây — xem `/api/du-an/ats-tasks` (bảng riêng `ats_tasks`, chỉ đọc).

## Route

| Route | Method | Ghi chú |
|---|---|---|
| `/` | GET | `?projectId=` (uuid, project của mình — mọi loại project), `?kind=gantt` (chỉ việc không lặp, có cả `startDate` lẫn `dueDate`). Mỗi việc kèm `occurrences`, `checklistItems`, `attention` |
| `/` | POST | 201, trả việc kèm `checklistItems` + `attention`. `logActivity` `task.created` |
| `/[id]` | PATCH | Gộp thay đổi rồi kiểm quy tắc chéo; đổi `status` ⇒ cập nhật `statusChangedAt`; sang DONE ⇒ `logActivity` `task.completed` |
| `/[id]` | DELETE | `{ ok: true }`; checklist + occurrences xoá theo (cascade) |
| `/[id]/checklist` | PUT | Thay CẢ danh sách: `{ items: [{ id?, text 1–500, done }] }`; `id` cũ giữ, không `id` = tạo mới, thiếu = xoá. Lỗi `duplicate_item_id`, `item_not_in_task` |
| `/[id]/checklist/[itemId]` | PATCH | `{ done?, text? }`; lỗi `item not found`. Tick hết checklist KHÔNG tự chuyển việc sang DONE |

Không có `GET /[id]`.

## Trường

- `status`: `PREP` (chuẩn bị) | `IN_PROGRESS` (đang thực thi) | `REVIEW` (thẩm định) | `DONE` — `TASK_STATUSES` ở `lib/task-input.ts`, mặc định `PREP`.
- Không có "priority": thay bằng `importance` và `urgency`, số nguyên 1–3 (mặc định 2).
- `durationMinutes` ≥ 5 (mặc định 15) = giờ ước lượng (kinh tế thưởng theo cột này); `actualMinutes` 0–14400 hoặc null = giờ thực tế (chỉ làm hao Thể lực).
- `projectId` tuỳ chọn (việc không thuộc dự án được); `krId` phải thuộc đúng project của việc.
- `startDate`, `dueDate` `"YYYY-MM-DD"`; `isMilestone`; `notifyDeadline` + `prepLeadDays` 0–60 (Kiều Lâu báo trước hạn, mặc định 3 ngày); `rrule` (việc lặp).
- `attention`: `{ kind: "OVERDUE" | "IDLE", days }` | null — `lib/task-attention.ts`: DONE → null; `dueDate` < hôm nay (VN) → OVERDUE;
  IN_PROGRESS/REVIEW không đổi trạng thái ≥ 5 ngày → IDLE.

## Lỗi (400 trừ khi ghi khác)

`{ error: zodFlatten }`, `empty patch`, `end_before_start`, `notify_requires_due_date`, `kr_requires_project`, `kr_not_in_project`,
`project_not_found` (404), `task not found` (404).

## Hook

POST/PATCH/DELETE gọi `scheduleEconomySync` khi việc đã/đang DONE (xem mục Kinh tế trong `amber-v4/CLAUDE.md`).
