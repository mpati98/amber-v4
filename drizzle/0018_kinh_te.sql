CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" varchar(16) NOT NULL,
	"stamina_self" integer,
	"exercise_minutes" integer,
	"sport_minutes" integer,
	"rest_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_ins_slot_check" CHECK ("check_ins"."slot" in ('noon', 'evening')),
	CONSTRAINT "check_ins_stamina_self_check" CHECK ("check_ins"."stamina_self" is null or "check_ins"."stamina_self" between 1 and 5),
	CONSTRAINT "check_ins_exercise_minutes_check" CHECK ("check_ins"."exercise_minutes" is null or "check_ins"."exercise_minutes" between 0 and 1440),
	CONSTRAINT "check_ins_sport_minutes_check" CHECK ("check_ins"."sport_minutes" is null or "check_ins"."sport_minutes" between 0 and 1440)
);
--> statement-breakpoint
CREATE TABLE "debuffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" varchar(16) NOT NULL,
	"label" varchar(255),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "debuffs_level_check" CHECK ("debuffs"."level" in ('light', 'medium', 'heavy')),
	CONSTRAINT "debuffs_ended_after_started_check" CHECK ("debuffs"."ended_at" is null or "debuffs"."ended_at" >= "debuffs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "economy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"type" varchar(64) NOT NULL,
	"source" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"vn_date" date NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_events_source_check" CHECK ("economy_events"."source" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "exemption_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"bought_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"task_ref" varchar(200),
	CONSTRAINT "exemption_cards_price_check" CHECK ("exemption_cards"."price" >= 0),
	CONSTRAINT "exemption_cards_used_check" CHECK (("exemption_cards"."task_ref" is null) = ("exemption_cards"."used_at" is null))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"rule_id" varchar(64) NOT NULL,
	"rules_version" integer NOT NULL,
	"key" varchar(32) NOT NULL,
	"raw_amount" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"vn_date" date NOT NULL,
	CONSTRAINT "ledger_entries_key_check" CHECK ("ledger_entries"."key" in ('nguyen_te', 'stamina')),
	CONSTRAINT "ledger_entries_source_check" CHECK ("ledger_entries"."source" in ('auto', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" integer NOT NULL,
	"weekly_limit" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_items_price_check" CHECK ("reward_items"."price" > 0),
	CONSTRAINT "reward_items_weekly_limit_check" CHECK ("reward_items"."weekly_limit" is null or "reward_items"."weekly_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"yaml" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"proposed_by" varchar(16) DEFAULT 'user' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "rule_sets_status_check" CHECK ("rule_sets"."status" in ('active', 'proposed', 'retired', 'rejected')),
	CONSTRAINT "rule_sets_proposed_by_check" CHECK ("rule_sets"."proposed_by" in ('user', 'brain'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "actual_minutes" integer;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debuffs" ADD CONSTRAINT "debuffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_events" ADD CONSTRAINT "economy_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exemption_cards" ADD CONSTRAINT "exemption_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Chỉ mục duy nhất phải có TRƯỚC khoá ngoại ghép trỏ vào nó (drizzle-kit sinh sai thứ tự).
CREATE UNIQUE INDEX "economy_events_user_id_event_id_key" ON "economy_events" USING btree ("user_id","event_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_fk" FOREIGN KEY ("user_id","event_id") REFERENCES "public"."economy_events"("user_id","event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_item_id_reward_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."reward_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_items" ADD CONSTRAINT "reward_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_user_id_date_slot_key" ON "check_ins" USING btree ("user_id","date","slot");--> statement-breakpoint
CREATE INDEX "debuffs_user_id_started_at_idx" ON "debuffs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "economy_events_user_id_vn_date_idx" ON "economy_events" USING btree ("user_id","vn_date");--> statement-breakpoint
CREATE UNIQUE INDEX "exemption_cards_user_id_task_ref_key" ON "exemption_cards" USING btree ("user_id","task_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_user_id_event_id_rule_id_key_key" ON "ledger_entries" USING btree ("user_id","event_id","rule_id","key");--> statement-breakpoint
CREATE INDEX "ledger_entries_user_id_vn_date_idx" ON "ledger_entries" USING btree ("user_id","vn_date");--> statement-breakpoint
CREATE INDEX "redemptions_user_id_at_idx" ON "redemptions" USING btree ("user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_user_id_version_key" ON "rule_sets" USING btree ("user_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_one_active_key" ON "rule_sets" USING btree ("user_id") WHERE "rule_sets"."status" = 'active';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_actual_minutes_check" CHECK ("tasks"."actual_minutes" is null or "tasks"."actual_minutes" between 0 and 14400);