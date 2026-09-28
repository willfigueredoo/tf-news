CREATE TABLE "reel_idea_research_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_item_id" integer NOT NULL,
	"reel_idea_id" integer,
	"task_id" text,
	"task_url" text,
	"request_id" text,
	"provider" text DEFAULT 'manus' NOT NULL,
	"agent_profile" text DEFAULT 'lite' NOT NULL,
	"status" text DEFAULT 'submitting' NOT NULL,
	"origin_type" text NOT NULL,
	"content_type" text DEFAULT 'news' NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"selection_window_days" integer,
	"related_news_ids" text DEFAULT '[]' NOT NULL,
	"research_payload" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_event_id" text,
	"error_message" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
ALTER TABLE "reel_idea_research_jobs" ADD CONSTRAINT "reel_idea_research_jobs_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_idea_research_jobs" ADD CONSTRAINT "reel_idea_research_jobs_reel_idea_id_reel_ideas_id_fk" FOREIGN KEY ("reel_idea_id") REFERENCES "public"."reel_ideas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reel_idea_research_jobs_task_unique" ON "reel_idea_research_jobs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reel_idea_research_jobs_event_unique" ON "reel_idea_research_jobs" USING btree ("last_event_id");--> statement-breakpoint
CREATE INDEX "reel_idea_research_jobs_queue_idx" ON "reel_idea_research_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "reel_idea_research_jobs_news_idx" ON "reel_idea_research_jobs" USING btree ("news_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reel_idea_research_jobs_active_news_unique" ON "reel_idea_research_jobs" USING btree ("news_item_id") WHERE "reel_idea_research_jobs"."status" in ('submitting', 'researching', 'ready', 'generating', 'waiting');