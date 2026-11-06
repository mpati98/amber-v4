CREATE TYPE "public"."study_card_bucket" AS ENUM('DUE', 'NEW', 'HARD', 'RANDOM');--> statement-breakpoint
CREATE TYPE "public"."study_card_kind" AS ENUM('PHRASAL_VERB', 'COLLOCATION', 'IDIOM', 'PATTERN', 'EXPRESSION');--> statement-breakpoint
CREATE TYPE "public"."study_card_rating" AS ENUM('NOT_YET', 'REVIEW_AGAIN', 'REMEMBERED');--> statement-breakpoint
CREATE TYPE "public"."study_card_stage" AS ENUM('NEW', 'LEARNING', 'WEEKLY', 'MONTHLY', 'QUARTERLY');--> statement-breakpoint
CREATE TYPE "public"."study_log_activity" AS ENUM('LESSON', 'CARD_REVIEW');--> statement-breakpoint
CREATE TABLE "study_card_day_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"card_id" uuid NOT NULL,
	"bucket" "study_card_bucket" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_card_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" "study_card_rating" NOT NULL,
	"bucket" "study_card_bucket" NOT NULL,
	"stage_before" "study_card_stage" NOT NULL,
	"stage_after" "study_card_stage" NOT NULL,
	"due_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"source_log_id" uuid,
	"phrase" varchar(255) NOT NULL,
	"phrase_key" varchar(255) NOT NULL,
	"meaning" text NOT NULL,
	"example" text NOT NULL,
	"note" text,
	"kind" "study_card_kind" NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"stage" "study_card_stage" DEFAULT 'NEW' NOT NULL,
	"due_at" timestamp with time zone,
	"review_count" integer DEFAULT 0 NOT NULL,
	"not_yet_count" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_logs" ADD COLUMN "activity" "study_log_activity" DEFAULT 'LESSON' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_subjects" ADD COLUMN "card_daily_quota" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "study_card_day_plan_items" ADD CONSTRAINT "study_card_day_plan_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_card_day_plan_items" ADD CONSTRAINT "study_card_day_plan_items_subject_id_study_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."study_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_card_day_plan_items" ADD CONSTRAINT "study_card_day_plan_items_card_id_study_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."study_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_card_reviews" ADD CONSTRAINT "study_card_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_card_reviews" ADD CONSTRAINT "study_card_reviews_card_id_study_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."study_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_subject_id_study_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."study_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_source_log_id_study_logs_id_fk" FOREIGN KEY ("source_log_id") REFERENCES "public"."study_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_card_day_plan_items_subject_id_plan_date_card_id_key" ON "study_card_day_plan_items" USING btree ("subject_id","plan_date","card_id");--> statement-breakpoint
CREATE INDEX "study_card_reviews_card_id_reviewed_at_idx" ON "study_card_reviews" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "study_cards_subject_id_phrase_key_key" ON "study_cards" USING btree ("subject_id","phrase_key");--> statement-breakpoint
CREATE INDEX "study_cards_user_id_due_at_idx" ON "study_cards" USING btree ("user_id","due_at");--> statement-breakpoint
ALTER TABLE "study_subjects" ADD CONSTRAINT "study_subjects_card_daily_quota_check" CHECK ("study_subjects"."card_daily_quota" between 1 and 20);