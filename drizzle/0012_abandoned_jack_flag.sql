ALTER TYPE "public"."study_log_activity" ADD VALUE 'PRACTICE';--> statement-breakpoint
ALTER TABLE "study_logs" ADD COLUMN "practice_session_id" uuid;--> statement-breakpoint
ALTER TABLE "study_logs" ADD CONSTRAINT "study_logs_practice_session_id_fk" FOREIGN KEY ("practice_session_id") REFERENCES "public"."practice_session_details"("project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_logs_practice_session_id_key" ON "study_logs" USING btree ("practice_session_id");