# Nghị Sự Đường – Dự án: quyết định thiết kế và kế hoạch tích hợp vào Amber v4

Chốt ngày 06/10/2026. Prototype tham chiếu: canvas "Nghị Sự Đường — 5 mô hình Dự án", artboard 6 (Chi tiết dự án) và artboard 7 (Tổng quan).

## 1. Mô hình đã chốt

Một bộ dữ liệu, ba cách nhìn: Kanban + Lịch + KR.

- Dự án chính là mục tiêu. Không có tầng Objective. Mỗi dự án có vài KR.
- Bảng (Kanban) và Lịch (timeline) là hai cách xem cùng một danh sách việc.
- Việc có thể gắn với một KR.
- 4 cột cố định: Chờ, Đang làm, Thẩm định, Xong. Giới hạn WIP của "Đang làm" là 2. Không cho cấu hình cột.

## 2. Quyết định theo từng phần

| Phần | Quyết định |
|---|---|
| KR | Hai kiểu: tự đếm (số việc đã gắn và đã xong / tổng số việc đã gắn) hoặc nhập tay (current / target kèm đơn vị). Xoá KR thì việc đang gắn thành không gắn. |
| Việc | Có nội dung dạng văn bản và checklist, dùng được cả hai cùng lúc. Tick hết checklist không tự chuyển việc sang Xong. |
| Mốc | Là một việc có cờ `isMilestone`. |
| Cảnh báo | "Quá hạn N ngày" tính từ hạn; "Nằm im N ngày" tính từ lần đổi trạng thái gần nhất. |
| Thông báo hạn | Mỗi việc bật/tắt được thông báo hạn, kèm thời gian sống riêng (số ngày). Nghị Sự Đường chỉ lưu trường này; Kiều Lâu đọc và hiển thị, làm ở phiên xây Kiều Lâu. |
| Thu-chi | Không tạo bảng mới. Dùng giao dịch sẵn có, lọc theo dự án. Thêm ở trang dự án thì giao dịch tự gắn dự án đó. |
| Xoá dự án | Xoá theo toàn bộ KR, việc và checklist. Giao dịch được giữ lại trong sổ chung và bỏ liên kết dự án (giả định, chưa xác nhận). |
| Đóng dự án | Khi chuyển sang Đã xong, lưu một tài liệu tổng kết vào Tàng Kinh Các. Không sao chép toàn bộ dữ liệu. |
| Việc hằng ngày | Loại riêng, không thuộc dự án. Chọn các thứ trong tuần. Mỗi lần làm là một dòng nhật ký theo ngày. Tick tay, không tự tick từ tòa khác. |
| Lọc/tìm việc | Chưa làm. |

## 3. Schema nháp (chốt sau bước khảo sát)

```
project         id, name, goal, status (active | paused | done),
                startDate, dueDate, closedAt, createdAt, updatedAt

key_result      id, projectId → project (cascade), name,
                mode (auto | manual), unit, target, current, order

task            id, projectId → project (cascade), krId → key_result (set null),
                title, status (todo | doing | review | done),
                startDate, dueDate, isMilestone, note,
                statusChangedAt, notifyDeadline, notifyLiveDays, order

checklist_item  id, taskId → task (cascade), text, done, order

routine         id, name, weekdays, active, createdAt
routine_log     routineId → routine (cascade), date   -- unique (routineId, date)

transaction.projectId → project (set null)            -- bảng sẵn có
```

Tài liệu tổng kết khi đóng dự án gồm: tên, mục tiêu, thời gian, kết quả từng KR, danh sách tên việc đã xong, tổng thu-chi, ghi chú tổng kết do người dùng viết.

## 4. Các bước tích hợp

Mỗi bước là một prompt cho agent. Chỉ viết prompt bước sau khi có kết quả bước trước.

| # | Bước | Repo | Trạng thái |
|---|---|---|---|
| 0 | Khảo sát hiện trạng (chỉ đọc) | cả hai | đã xuất prompt |
| 1 | Schema và migration | backend | |
| 2 | API dự án và KR, gồm xoá kéo theo | backend | |
| 3 | API việc và checklist, gồm trường thông báo hạn | backend | |
| 4 | API việc hằng ngày và endpoint tổng quan | backend | |
| 5 | Màn Tổng quan: danh sách dự án, lọc, thêm dự án | Flutter | |
| 6 | Màn Chi tiết dự án: đầu trang, KR, tab Bảng | Flutter | |
| 7 | Hộp chi tiết và sửa việc: nội dung, checklist, thông báo hạn | Flutter | |
| 8 | Tab Lịch | Flutter | |
| 9 | Tab Thu-chi | Flutter | |
| 10 | Việc hằng ngày và khối Cần chú ý trên Tổng quan | Flutter | |
| 11 | Đóng dự án (lưu tài liệu vào Tàng Kinh Các) và xoá dự án | cả hai | |

## 5. Còn mở

- Cách hiểu "thời gian sống" của thông báo hạn: thông báo xuất hiện N ngày trước hạn và tồn tại tới khi việc xong hoặc qua hạn. Chờ xác nhận.
- Giao dịch khi xoá dự án: giữ lại và bỏ liên kết. Chờ xác nhận.
