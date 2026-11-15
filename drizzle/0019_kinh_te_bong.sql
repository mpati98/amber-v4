ALTER TABLE "ledger_entries" ADD COLUMN "shadow" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Thêm cột KHÔNG kèm default trước để dòng cũ giữ null (ADD COLUMN ... DEFAULT now() sẽ đóng dấu giờ migrate lên mọi dòng cũ),
-- rồi mới đặt default cho dòng mới.
ALTER TABLE "routine_logs" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routine_logs" ALTER COLUMN "created_at" SET DEFAULT now();
