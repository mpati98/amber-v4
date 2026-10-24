CREATE TABLE "music_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"artist" varchar(255),
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"duration_seconds" integer,
	"size_bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_tracks_blob_pathname_unique" UNIQUE("blob_pathname"),
	CONSTRAINT "music_tracks_duration_seconds_check" CHECK ("music_tracks"."duration_seconds" is null or "music_tracks"."duration_seconds" >= 0),
	CONSTRAINT "music_tracks_size_bytes_check" CHECK ("music_tracks"."size_bytes" > 0 and "music_tracks"."size_bytes" <= 52428800),
	CONSTRAINT "music_tracks_position_check" CHECK ("music_tracks"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "music_tracks" ADD CONSTRAINT "music_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_tracks_user_position_idx" ON "music_tracks" USING btree ("user_id","position");