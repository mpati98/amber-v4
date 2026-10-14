CREATE TYPE "public"."study_course_status" AS ENUM('WISHLIST', 'QUEUED', 'ACTIVE', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."study_reason_code" AS ENUM('BUSY', 'TIRED', 'AWAY', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."routine_kind" ADD VALUE 'STUDY';--> statement-breakpoint
CREATE TABLE "study_course_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "study_course_sections_duration_minutes_check" CHECK ("study_course_sections"."duration_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "study_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"instructor" varchar(255),
	"platform" varchar(255),
	"url" text,
	"status" "study_course_status" DEFAULT 'QUEUED' NOT NULL,
	"queue_position" integer,
	"target_price" text,
	"note" text,
	"baseline_finish_date" date,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_day_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason_date" date NOT NULL,
	"code" "study_reason_code" NOT NULL,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_log_sections" (
	"log_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"marked_done" boolean DEFAULT false NOT NULL,
	CONSTRAINT "study_log_sections_log_id_section_id_pk" PRIMARY KEY("log_id","section_id")
);
--> statement-breakpoint
CREATE TABLE "study_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"course_id" uuid,
	"log_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_logs_minutes_check" CHECK ("study_logs"."minutes" between 1 and 1440)
);
--> statement-breakpoint
CREATE TABLE "study_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"daily_goal_minutes" integer,
	"video_minutes_per_day" integer DEFAULT 40 NOT NULL,
	"review_weekdays" integer[] DEFAULT '{7}' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_subjects_daily_goal_minutes_check" CHECK ("study_subjects"."daily_goal_minutes" between 1 and 1440),
	CONSTRAINT "study_subjects_video_minutes_per_day_check" CHECK ("study_subjects"."video_minutes_per_day" between 1 and 1440)
);
--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "study_subject_id" uuid;--> statement-breakpoint
ALTER TABLE "study_course_sections" ADD CONSTRAINT "study_course_sections_course_id_study_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."study_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_courses" ADD CONSTRAINT "study_courses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_courses" ADD CONSTRAINT "study_courses_subject_id_study_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."study_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_day_reasons" ADD CONSTRAINT "study_day_reasons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_day_reasons" ADD CONSTRAINT "study_day_reasons_subject_id_study_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."study_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_log_sections" ADD CONSTRAINT "study_log_sections_log_id_study_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."study_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_log_sections" ADD CONSTRAINT "study_log_sections_section_id_study_course_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."study_course_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_logs" ADD CONSTRAINT "study_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_logs" ADD CONSTRAINT "study_logs_subject_id_study_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."study_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_logs" ADD CONSTRAINT "study_logs_course_id_study_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."study_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_subjects" ADD CONSTRAINT "study_subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_course_sections_course_id_position_key" ON "study_course_sections" USING btree ("course_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "study_day_reasons_subject_id_reason_date_key" ON "study_day_reasons" USING btree ("subject_id","reason_date");--> statement-breakpoint
CREATE INDEX "study_logs_subject_id_log_date_idx" ON "study_logs" USING btree ("subject_id","log_date");--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_study_subject_id_study_subjects_id_fk" FOREIGN KEY ("study_subject_id") REFERENCES "public"."study_subjects"("id") ON DELETE set null ON UPDATE no action;