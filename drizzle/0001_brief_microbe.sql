CREATE TABLE "news_item_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_item_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_value" text,
	"next_value" text,
	"metadata" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "read_at" text;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "archived_at" text;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "internal_notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "manual_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "collection_run_id" text;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "updated_at" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "type" text DEFAULT 'rss' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "priority" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "collection_frequency_minutes" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "language" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "country" text DEFAULT 'BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "region" text DEFAULT 'Brasil' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "related_icps" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "next_collection_at" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "archived_at" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "total_news_collected" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "average_response_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "news_item_history" ADD CONSTRAINT "news_item_history_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_history_item_idx" ON "news_item_history" USING btree ("news_item_id","created_at");--> statement-breakpoint
CREATE INDEX "news_status_idx" ON "news_items" USING btree ("status","collected_at");--> statement-breakpoint
CREATE INDEX "news_collection_run_idx" ON "news_items" USING btree ("collection_run_id");