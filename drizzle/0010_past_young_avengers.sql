ALTER TABLE "reel_ideas" ADD COLUMN "content_type" text DEFAULT 'news' NOT NULL;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD COLUMN "selection_window_days" integer;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD COLUMN "relevance_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD COLUMN "relevance_level" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD COLUMN "relevance_breakdown" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "reel_ideas" ADD COLUMN "relevance_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "reel_ideas_automation_idx" ON "reel_ideas" USING btree ("automatic","content_type","created_at");