CREATE TABLE "editorial_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_item_id" integer NOT NULL,
	"editorial_kit_id" integer,
	"title" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"origin" text DEFAULT 'monitoring' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"requested_by" text,
	"last_error" text,
	"started_at" text,
	"completed_at" text,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_queue" ADD CONSTRAINT "editorial_queue_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_queue" ADD CONSTRAINT "editorial_queue_editorial_kit_id_editorial_kits_id_fk" FOREIGN KEY ("editorial_kit_id") REFERENCES "public"."editorial_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_queue_news_version_unique" ON "editorial_queue" USING btree ("news_item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_queue_active_news_unique" ON "editorial_queue" USING btree ("news_item_id") WHERE "editorial_queue"."status" in ('new', 'analysis', 'approved', 'generating') and "editorial_queue"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "editorial_queue_status_idx" ON "editorial_queue" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "editorial_queue_news_idx" ON "editorial_queue" USING btree ("news_item_id","created_at");--> statement-breakpoint
CREATE INDEX "editorial_queue_kit_idx" ON "editorial_queue" USING btree ("editorial_kit_id");