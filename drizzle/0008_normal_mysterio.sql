CREATE TABLE "content_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"suggested_title" text NOT NULL,
	"normalized_topic" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rationale" text NOT NULL,
	"strategic_score" integer NOT NULL,
	"priority" text NOT NULL,
	"evergreen_score" integer NOT NULL,
	"icp_score" integer NOT NULL,
	"recurrence_score" integer NOT NULL,
	"content_gap_score" integer NOT NULL,
	"competitor_score" integer NOT NULL,
	"google_signals_score" integer,
	"score_factors" text DEFAULT '{}' NOT NULL,
	"primary_keyword" text NOT NULL,
	"search_intent" text NOT NULL,
	"related_icps" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'opportunity' NOT NULL,
	"origin_type" text NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"generated_kit_id" integer,
	"published_article_id" integer,
	"postponed_reason" text,
	"ai_analysis_id" integer,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_opportunity_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_key" text DEFAULT 'evergreen' NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"batch_size" integer DEFAULT 3 NOT NULL,
	"total_candidates" integer DEFAULT 0 NOT NULL,
	"processed_candidates" integer DEFAULT 0 NOT NULL,
	"opportunities_created" integer DEFAULT 0 NOT NULL,
	"opportunities_updated" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"candidate_snapshot" text DEFAULT '[]' NOT NULL,
	"last_error" text,
	"lease_owner" text,
	"lease_expires_at" text,
	"next_run_at" text NOT NULL,
	"started_at" text,
	"finished_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_opportunity_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"news_item_id" integer,
	"competitor_article_id" integer,
	"seo_article_id" integer,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_generated_kit_id_editorial_kits_id_fk" FOREIGN KEY ("generated_kit_id") REFERENCES "public"."editorial_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_published_article_id_seo_articles_id_fk" FOREIGN KEY ("published_article_id") REFERENCES "public"."seo_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_ai_analysis_id_seo_ai_analyses_id_fk" FOREIGN KEY ("ai_analysis_id") REFERENCES "public"."seo_ai_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunity_sources" ADD CONSTRAINT "content_opportunity_sources_opportunity_id_content_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunity_sources" ADD CONSTRAINT "content_opportunity_sources_news_item_id_news_items_id_fk" FOREIGN KEY ("news_item_id") REFERENCES "public"."news_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunity_sources" ADD CONSTRAINT "content_opportunity_sources_competitor_article_id_seo_competitor_articles_id_fk" FOREIGN KEY ("competitor_article_id") REFERENCES "public"."seo_competitor_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunity_sources" ADD CONSTRAINT "content_opportunity_sources_seo_article_id_seo_articles_id_fk" FOREIGN KEY ("seo_article_id") REFERENCES "public"."seo_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_opportunities_topic_unique" ON "content_opportunities" USING btree ("normalized_topic");--> statement-breakpoint
CREATE UNIQUE INDEX "content_opportunities_kit_unique" ON "content_opportunities" USING btree ("generated_kit_id");--> statement-breakpoint
CREATE INDEX "content_opportunities_status_idx" ON "content_opportunities" USING btree ("status","strategic_score","updated_at");--> statement-breakpoint
CREATE INDEX "content_opportunities_priority_idx" ON "content_opportunities" USING btree ("priority","strategic_score");--> statement-breakpoint
CREATE INDEX "content_opportunities_article_idx" ON "content_opportunities" USING btree ("published_article_id");--> statement-breakpoint
CREATE INDEX "content_opportunity_jobs_queue_idx" ON "content_opportunity_jobs" USING btree ("status","next_run_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_opportunity_jobs_active_unique" ON "content_opportunity_jobs" USING btree ("job_key") WHERE "content_opportunity_jobs"."status" in ('queued', 'processing', 'retry');--> statement-breakpoint
CREATE UNIQUE INDEX "content_opportunity_sources_news_unique" ON "content_opportunity_sources" USING btree ("opportunity_id","news_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_opportunity_sources_competitor_unique" ON "content_opportunity_sources" USING btree ("opportunity_id","competitor_article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_opportunity_sources_article_unique" ON "content_opportunity_sources" USING btree ("opportunity_id","seo_article_id");--> statement-breakpoint
CREATE INDEX "content_opportunity_sources_opportunity_idx" ON "content_opportunity_sources" USING btree ("opportunity_id","source_type");--> statement-breakpoint
CREATE INDEX "content_opportunity_sources_news_idx" ON "content_opportunity_sources" USING btree ("news_item_id");--> statement-breakpoint
CREATE INDEX "content_opportunity_sources_competitor_idx" ON "content_opportunity_sources" USING btree ("competitor_article_id");