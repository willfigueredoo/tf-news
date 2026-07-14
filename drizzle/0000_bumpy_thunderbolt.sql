CREATE TABLE "ai_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"request_id" text,
	"error_message" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"brief_id" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"excerpt" text NOT NULL,
	"content" text NOT NULL,
	"meta_title" text NOT NULL,
	"meta_description" text NOT NULL,
	"primary_keyword" text NOT NULL,
	"secondary_keywords" text NOT NULL,
	"category" text NOT NULL,
	"tags" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"quality_score" integer DEFAULT 78 NOT NULL,
	"factual_confidence" double precision DEFAULT 0.8 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "editorial_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"selected_icp" text NOT NULL,
	"objective" text NOT NULL,
	"primary_keyword" text NOT NULL,
	"payload" text NOT NULL,
	"news_ids" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"locked_until" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"original_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"source_id" integer NOT NULL,
	"source_name" text NOT NULL,
	"author" text,
	"published_at" text NOT NULL,
	"collected_at" text NOT NULL,
	"excerpt" text NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"title_hash" text NOT NULL,
	"region" text NOT NULL,
	"logistics_impact" text NOT NULL,
	"relevance_score" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"topics" text NOT NULL,
	"icps" text NOT NULL,
	"primary_icp" text DEFAULT 'Mercado e Logística' NOT NULL,
	"secondary_icps" text DEFAULT '[]' NOT NULL,
	"classification_reason" text NOT NULL,
	"classification_method" text DEFAULT 'deterministic' NOT NULL,
	"manually_edited_at" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"feed_url" text NOT NULL,
	"website_url" text,
	"reliability_score" integer DEFAULT 75 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_collected_at" text,
	"last_success_at" text,
	"last_failure_at" text,
	"last_error" text,
	"last_status" text DEFAULT 'never' NOT NULL,
	"last_duration_ms" integer,
	"last_http_status" integer,
	"last_item_count" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	CONSTRAINT "sources_feed_url_unique" UNIQUE("feed_url")
);
--> statement-breakpoint
CREATE TABLE "wordpress_publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"wordpress_post_id" integer NOT NULL,
	"wordpress_url" text,
	"wordpress_edit_url" text,
	"wordpress_status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "wordpress_publications_article_id_unique" UNIQUE("article_id")
);
--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_brief_id_editorial_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."editorial_briefs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_publications" ADD CONSTRAINT "wordpress_publications_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_canonical_unique" ON "news_items" USING btree ("canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "news_external_source_unique" ON "news_items" USING btree ("external_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "news_title_hash_unique" ON "news_items" USING btree ("title_hash");--> statement-breakpoint
CREATE INDEX "news_relevance_idx" ON "news_items" USING btree ("relevance_score","published_at");--> statement-breakpoint
INSERT INTO "sources" ("name", "domain", "feed_url", "website_url", "reliability_score", "active", "last_status", "last_item_count", "consecutive_failures", "created_at", "updated_at")
VALUES ('Canal Rural', 'canalrural.com.br', 'https://www.canalrural.com.br/feed/', 'https://www.canalrural.com.br/', 85, TRUE, 'never', 0, 0, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT ("feed_url") DO NOTHING;--> statement-breakpoint
INSERT INTO "sources" ("name", "domain", "feed_url", "website_url", "reliability_score", "active", "last_status", "last_item_count", "consecutive_failures", "created_at", "updated_at")
VALUES ('Agência Brasil', 'agenciabrasil.ebc.com.br', 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', 'https://agenciabrasil.ebc.com.br/', 90, TRUE, 'never', 0, 0, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT ("feed_url") DO NOTHING;
