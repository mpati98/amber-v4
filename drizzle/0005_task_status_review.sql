-- Bỏ trạng thái WAITING; thêm REVIEW (kiểm duyệt). Việc đang WAITING quay về PREP.
UPDATE "tasks" SET "status" = 'PREP' WHERE "status" = 'WAITING';