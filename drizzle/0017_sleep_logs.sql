CREATE TABLE "sleep_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sleep_minutes" integer NOT NULL,
	"quality" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sleep_logs_sleep_minutes_check" CHECK ("sleep_logs"."sleep_minutes" between 0 and 1440),
	CONSTRAINT "sleep_logs_quality_check" CHECK ("sleep_logs"."quality" is null or "sleep_logs"."quality" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "sleep_logs" ADD CONSTRAINT "sleep_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_logs_user_id_date_key" ON "sleep_logs" USING btree ("user_id","date");