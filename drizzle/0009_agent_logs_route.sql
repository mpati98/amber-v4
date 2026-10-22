ALTER TABLE "agent_logs" ADD COLUMN "route" text;--> statement-breakpoint
ALTER TABLE "agent_logs" ADD COLUMN "cloud_model" text;--> statement-breakpoint
CREATE INDEX "agent_logs_user_route_created_at_idx" ON "agent_logs" USING btree ("user_id","route","created_at");--> statement-breakpoint
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_route_check" CHECK ("agent_logs"."route" in ('LOCAL', 'CLOUD'));