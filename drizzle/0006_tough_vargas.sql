CREATE TABLE "seo_ai_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"competitor_id" integer,
	"operation" text NOT NULL,
	"input_hash" text NOT NULL,
	"version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"confidence" double precision,
	"payload" text DEFAULT '{}' NOT NULL,
	"data_refs" text DEFAULT '{}' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"request_id" text,
	"error_message" text,
	"valid_until" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"slug" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"published_at" text,
	"modified_at" text,
	"author" text,
	"categories" text DEFAULT '[]' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"featured_image_url" text,
	"status" text DEFAULT 'published' NOT NULL,
	"meta_description" text,
	"keywords" text DEFAULT '[]' NOT NULL,
	"icps" text DEFAULT '[]' NOT NULL,
	"topics" text DEFAULT '[]' NOT NULL,
	"collection_method" text NOT NULL,
	"content_hash" text NOT NULL,
	"first_collected_at" text NOT NULL,
	"last_collected_at" text NOT NULL,
	"unavailable_at" text
);
--> statement-breakpoint
CREATE TABLE "seo_authority_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"score" integer NOT NULL,
	"previous_score" integer,
	"confidence" double precision NOT NULL,
	"google_status" text DEFAULT 'not_connected' NOT NULL,
	"google_score" integer,
	"gemini_score" integer,
	"engine_score" integer NOT NULL,
	"contributions" text NOT NULL,
	"positive_factors" text DEFAULT '[]' NOT NULL,
	"negative_factors" text DEFAULT '[]' NOT NULL,
	"metrics" text NOT NULL,
	"source_states" text NOT NULL,
	"calculated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_competitor_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"source_id" integer,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"published_at" text,
	"modified_at" text,
	"excerpt" text DEFAULT '' NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"featured_image_url" text,
	"categories" text DEFAULT '[]' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"topics" text DEFAULT '[]' NOT NULL,
	"content_hash" text NOT NULL,
	"first_collected_at" text NOT NULL,
	"last_collected_at" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"collection_method" text NOT NULL,
	"unavailable_at" text
);
--> statement-breakpoint
CREATE TABLE "seo_competitor_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"last_verified_at" text,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"content_url" text,
	"sitemap_url" text,
	"rss_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"last_sync_at" text,
	"sync_status" text DEFAULT 'pending_confirmation' NOT NULL,
	"last_error" text,
	"discovered_at" text,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"opportunity_key" text NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"icp" text NOT NULL,
	"priority" text NOT NULL,
	"seo_potential" text NOT NULL,
	"confidence" integer NOT NULL,
	"reasons" text NOT NULL,
	"signal_origins" text NOT NULL,
	"competitor_ids" text DEFAULT '[]' NOT NULL,
	"news_ids" text DEFAULT '[]' NOT NULL,
	"site_article_ids" text DEFAULT '[]' NOT NULL,
	"suggested_angle" text,
	"status" text DEFAULT 'new' NOT NULL,
	"valid_until" text NOT NULL,
	"source_analysis_id" integer,
	"editorial_queue_id" integer,
	"editorial_kit_id" integer,
	"reviewed_at" text,
	"discarded_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_site_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"last_verified_at" text,
	"last_error" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"blog_url" text NOT NULL,
	"wordpress_api_url" text,
	"sitemap_url" text,
	"rss_url" text,
	"status" text DEFAULT 'pending_sync' NOT NULL,
	"last_sync_at" text,
	"next_sync_at" text,
	"last_error" text,
	"articles_found" integer DEFAULT 0 NOT NULL,
	"articles_synced" integer DEFAULT 0 NOT NULL,
	"discovery_method" text DEFAULT 'wordpress_rest' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target_id" integer,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"started_at" text NOT NULL,
	"finished_at" text,
	"duration_ms" integer,
	"found" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"unavailable" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"metadata" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_ai_analyses" ADD CONSTRAINT "seo_ai_analyses_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_ai_analyses" ADD CONSTRAINT "seo_ai_analyses_competitor_id_seo_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."seo_competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_authority_snapshots" ADD CONSTRAINT "seo_authority_snapshots_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_competitor_articles" ADD CONSTRAINT "seo_competitor_articles_competitor_id_seo_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."seo_competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_competitor_articles" ADD CONSTRAINT "seo_competitor_articles_source_id_seo_competitor_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."seo_competitor_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_competitor_sources" ADD CONSTRAINT "seo_competitor_sources_competitor_id_seo_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."seo_competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_source_analysis_id_seo_ai_analyses_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "public"."seo_ai_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_editorial_queue_id_editorial_queue_id_fk" FOREIGN KEY ("editorial_queue_id") REFERENCES "public"."editorial_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_editorial_kit_id_editorial_kits_id_fk" FOREIGN KEY ("editorial_kit_id") REFERENCES "public"."editorial_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_site_sources" ADD CONSTRAINT "seo_site_sources_site_id_seo_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."seo_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_ai_analyses_input_unique" ON "seo_ai_analyses" USING btree ("operation","input_hash");--> statement-breakpoint
CREATE INDEX "seo_ai_analyses_site_idx" ON "seo_ai_analyses" USING btree ("site_id","operation","created_at");--> statement-breakpoint
CREATE INDEX "seo_ai_analyses_competitor_idx" ON "seo_ai_analyses" USING btree ("competitor_id","operation","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_articles_external_unique" ON "seo_articles" USING btree ("site_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_articles_canonical_unique" ON "seo_articles" USING btree ("site_id","canonical_url");--> statement-breakpoint
CREATE INDEX "seo_articles_published_idx" ON "seo_articles" USING btree ("site_id","status","published_at");--> statement-breakpoint
CREATE INDEX "seo_articles_hash_idx" ON "seo_articles" USING btree ("site_id","content_hash");--> statement-breakpoint
CREATE INDEX "seo_authority_site_idx" ON "seo_authority_snapshots" USING btree ("site_id","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_competitor_articles_external_unique" ON "seo_competitor_articles" USING btree ("competitor_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_competitor_articles_canonical_unique" ON "seo_competitor_articles" USING btree ("competitor_id","canonical_url");--> statement-breakpoint
CREATE INDEX "seo_competitor_articles_published_idx" ON "seo_competitor_articles" USING btree ("competitor_id","status","published_at");--> statement-breakpoint
CREATE INDEX "seo_competitor_articles_hash_idx" ON "seo_competitor_articles" USING btree ("competitor_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_competitor_sources_url_unique" ON "seo_competitor_sources" USING btree ("competitor_id","url");--> statement-breakpoint
CREATE INDEX "seo_competitor_sources_priority_idx" ON "seo_competitor_sources" USING btree ("competitor_id","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_competitors_domain_unique" ON "seo_competitors" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "seo_competitors_status_idx" ON "seo_competitors" USING btree ("active","sync_status","last_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_opportunities_key_unique" ON "seo_opportunities" USING btree ("site_id","opportunity_key");--> statement-breakpoint
CREATE INDEX "seo_opportunities_status_idx" ON "seo_opportunities" USING btree ("site_id","status","valid_until");--> statement-breakpoint
CREATE INDEX "seo_opportunities_rank_idx" ON "seo_opportunities" USING btree ("site_id","priority","confidence");--> statement-breakpoint
CREATE INDEX "seo_opportunities_queue_idx" ON "seo_opportunities" USING btree ("editorial_queue_id");--> statement-breakpoint
CREATE INDEX "seo_opportunities_kit_idx" ON "seo_opportunities" USING btree ("editorial_kit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_site_sources_url_unique" ON "seo_site_sources" USING btree ("site_id","url");--> statement-breakpoint
CREATE INDEX "seo_site_sources_priority_idx" ON "seo_site_sources" USING btree ("site_id","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_sites_domain_unique" ON "seo_sites" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "seo_sites_status_idx" ON "seo_sites" USING btree ("status","next_sync_at");--> statement-breakpoint
CREATE INDEX "seo_sync_runs_target_idx" ON "seo_sync_runs" USING btree ("scope","target_id","started_at");--> statement-breakpoint
CREATE INDEX "seo_sync_runs_status_idx" ON "seo_sync_runs" USING btree ("status","started_at");--> statement-breakpoint
INSERT INTO "seo_sites" (
	"name", "domain", "blog_url", "wordpress_api_url", "sitemap_url", "rss_url",
	"status", "articles_found", "articles_synced", "discovery_method", "created_at", "updated_at"
) VALUES (
	'TransFAST',
	'https://transfast.log.br',
	'https://transfast.log.br/blog/',
	'https://transfast.log.br/wp-json/wp/v2/posts',
	'https://transfast.log.br/wp-sitemap-posts-post-1.xml',
	'https://transfast.log.br/feed/',
	'pending_sync',
	0,
	0,
	'wordpress_rest',
	NOW()::text,
	NOW()::text
) ON CONFLICT ("domain") DO NOTHING;--> statement-breakpoint
INSERT INTO "seo_site_sources" (
	"site_id", "source_type", "url", "status", "priority", "created_at", "updated_at"
)
SELECT "id", 'wordpress_rest', 'https://transfast.log.br/wp-json/wp/v2/posts', 'active', 100, NOW()::text, NOW()::text
FROM "seo_sites" WHERE "domain" = 'https://transfast.log.br'
ON CONFLICT ("site_id", "url") DO NOTHING;--> statement-breakpoint
INSERT INTO "seo_site_sources" (
	"site_id", "source_type", "url", "status", "priority", "created_at", "updated_at"
)
SELECT "id", 'sitemap', 'https://transfast.log.br/wp-sitemap-posts-post-1.xml', 'fallback', 80, NOW()::text, NOW()::text
FROM "seo_sites" WHERE "domain" = 'https://transfast.log.br'
ON CONFLICT ("site_id", "url") DO NOTHING;--> statement-breakpoint
INSERT INTO "seo_site_sources" (
	"site_id", "source_type", "url", "status", "priority", "created_at", "updated_at"
)
SELECT "id", 'rss', 'https://transfast.log.br/feed/', 'fallback', 60, NOW()::text, NOW()::text
FROM "seo_sites" WHERE "domain" = 'https://transfast.log.br'
ON CONFLICT ("site_id", "url") DO NOTHING;
