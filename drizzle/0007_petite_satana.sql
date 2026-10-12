CREATE TYPE "public"."exercise_measure" AS ENUM('REPS', 'SETS_REPS', 'DURATION');--> statement-breakpoint
CREATE TYPE "public"."routine_kind" AS ENUM('CHECK', 'WORKOUT');--> statement-breakpoint
CREATE TABLE "workout_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_log_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"measure" "exercise_measure" NOT NULL,
	"sets" integer,
	"reps" integer,
	"duration_seconds" integer
);
--> statement-breakpoint
ALTER TABLE "routine_logs" DROP CONSTRAINT "routine_logs_routine_id_log_date_pk";--> statement-breakpoint
ALTER TABLE "routine_logs" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_logs" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "kind" "routine_kind" DEFAULT 'CHECK' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_routine_log_id_routine_logs_id_fk" FOREIGN KEY ("routine_log_id") REFERENCES "public"."routine_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_exercises_routine_log_id_idx" ON "workout_exercises" USING btree ("routine_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routine_logs_routine_id_log_date_key" ON "routine_logs" USING btree ("routine_id","log_date");