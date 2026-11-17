CREATE TABLE "ats_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ats_id" text NOT NULL,
	"title" text NOT NULL,
	"status" varchar(16),
	"due_date" date,
	"done_at" timestamp with time zone,
	"ats_created_at" timestamp with time zone NOT NULL,
	"ats_updated_at" timestamp with time zone NOT NULL,
	"project_ats_id" text,
	"project_name" text,
	"project_type" varchar(16),
	"project_archived" boolean DEFAULT false NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"user_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"since" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_ids_check_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "sync_cursors_user_id_source_pk" PRIMARY KEY("user_id","source")
);
--> statement-breakpoint
ALTER TABLE "ats_tasks" ADD CONSTRAINT "ats_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ats_tasks_user_id_ats_id_key" ON "ats_tasks" USING btree ("user_id","ats_id");