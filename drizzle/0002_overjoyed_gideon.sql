CREATE TABLE "editorial_kits" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_item_id" integer NOT NULL,
	"title" text NOT NULL,
	"primary_icp" text NOT NULL,
	"editorial_score" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_kits" ADD CONSTRAINT "editorial_kits_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editorial_kits_news_idx" ON "editorial_kits" USING btree ("news_item_id","created_at");--> statement-breakpoint
CREATE INDEX "editorial_kits_status_idx" ON "editorial_kits" USING btree ("status","updated_at");