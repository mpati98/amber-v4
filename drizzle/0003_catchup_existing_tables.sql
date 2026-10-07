CREATE TYPE "public"."document_type" AS ENUM('TEXT', 'CHECKLIST', 'MINDMAP', 'IMAGE', 'FILE');--> statement-breakpoint
CREATE TYPE "public"."publication_format" AS ENUM('PHYSICAL', 'EBOOK', 'AUDIOBOOK');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('TO_READ', 'READING', 'READ', 'ABANDONED');--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"ip_hash" text NOT NULL,
	"email_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" "document_type" DEFAULT 'TEXT' NOT NULL,
	"content" text,
	"attachmentUrl" text,
	"tags" text DEFAULT '[]' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"sourceUrl" text,
	"topicId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "highlights" (
	"id" text PRIMARY KEY NOT NULL,
	"publicationId" text NOT NULL,
	"quote" text NOT NULL,
	"page" integer,
	"note" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"isbn" text,
	"coverUrl" text,
	"format" "publication_format" DEFAULT 'PHYSICAL' NOT NULL,
	"status" "publication_status" DEFAULT 'TO_READ' NOT NULL,
	"rating" integer,
	"currentPage" integer,
	"totalPages" integer,
	"tags" text DEFAULT '[]' NOT NULL,
	"url" text,
	"review" text,
	"notes" text,
	"dateAdded" timestamp DEFAULT now() NOT NULL,
	"dateStarted" timestamp,
	"dateFinished" timestamp
);
--> statement-breakpoint
CREATE TABLE "reading_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"targetBooks" integer,
	"targetPages" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_topicId_topics_id_fk" FOREIGN KEY ("topicId") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_publicationId_publications_id_fk" FOREIGN KEY ("publicationId") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_ip_hash_created_at_idx" ON "contact_messages" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_goals_year_unique" ON "reading_goals" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_unique" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_name_unique" ON "topics" USING btree ("name");