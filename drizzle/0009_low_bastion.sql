CREATE TABLE "reel_idea_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"reel_idea_id" integer NOT NULL,
	"news_item_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_item_id" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"industry_relevance" text NOT NULL,
	"suggested_angle" text NOT NULL,
	"suggested_copy" text NOT NULL,
	"primary_pillar" text NOT NULL,
	"secondary_pillar" text,
	"priority" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"origin_type" text NOT NULL,
	"editorial_score" integer NOT NULL,
	"responsible" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request_id" text,
	"source_snapshot" text NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reel_idea_sources" ADD CONSTRAINT "reel_idea_sources_reel_idea_id_reel_ideas_id_fk" FOREIGN KEY ("reel_idea_id") REFERENCES "public"."reel_ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_idea_sources" ADD CONSTRAINT "reel_idea_sources_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD CONSTRAINT "reel_ideas_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reel_idea_sources_unique" ON "reel_idea_sources" USING btree ("reel_idea_id","news_item_id");--> statement-breakpoint
CREATE INDEX "reel_idea_sources_idea_idx" ON "reel_idea_sources" USING btree ("reel_idea_id");--> statement-breakpoint
CREATE INDEX "reel_idea_sources_news_idx" ON "reel_idea_sources" USING btree ("news_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reel_ideas_news_unique" ON "reel_ideas" USING btree ("news_item_id");--> statement-breakpoint
CREATE INDEX "reel_ideas_status_idx" ON "reel_ideas" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "reel_ideas_pillar_idx" ON "reel_ideas" USING btree ("primary_pillar","priority");--> statement-breakpoint
CREATE INDEX "reel_ideas_origin_idx" ON "reel_ideas" USING btree ("origin_type","created_at");