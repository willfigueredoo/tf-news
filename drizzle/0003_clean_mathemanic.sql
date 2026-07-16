CREATE TABLE "editorial_kit_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"editorial_kit_id" integer NOT NULL,
	"editorial_source_id" integer,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"publisher" text NOT NULL,
	"primary_or_secondary" text NOT NULL,
	"authority_level" text NOT NULL,
	"published_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"operational_source_id" integer,
	"source_key" text NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"base_url" text NOT NULL,
	"feed_url" text,
	"category" text NOT NULL,
	"subcategories" text DEFAULT '[]' NOT NULL,
	"authority_level" text NOT NULL,
	"authority_score" integer DEFAULT 50 NOT NULL,
	"source_type" text NOT NULL,
	"editorial_role" text NOT NULL,
	"primary_or_secondary" text NOT NULL,
	"official_entity" boolean DEFAULT false NOT NULL,
	"country" text DEFAULT 'BR' NOT NULL,
	"language" text DEFAULT 'pt-BR' NOT NULL,
	"monitoring_mode" text DEFAULT 'reference' NOT NULL,
	"active_for_collection" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reliability" integer DEFAULT 75 NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"update_frequency_minutes" integer DEFAULT 720 NOT NULL,
	"topics_allowed" text DEFAULT '[]' NOT NULL,
	"topics_restricted" text DEFAULT '[]' NOT NULL,
	"geographic_scope" text DEFAULT 'Brasil' NOT NULL,
	"related_icps" text DEFAULT '[]' NOT NULL,
	"requires_cross_check" boolean DEFAULT false NOT NULL,
	"preferred_original_source" boolean DEFAULT false NOT NULL,
	"paywall" text DEFAULT 'none' NOT NULL,
	"requires_javascript" boolean DEFAULT false NOT NULL,
	"robots_status" text DEFAULT 'unknown' NOT NULL,
	"sitemap_url" text,
	"last_verified_at" text,
	"last_successful_collection_at" text,
	"last_failed_collection_at" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"editorial_notes" text DEFAULT '' NOT NULL,
	"bias_or_interest_disclosure" text DEFAULT '' NOT NULL,
	"minimum_confirmation_sources" integer DEFAULT 1 NOT NULL,
	"can_confirm_regulation" boolean DEFAULT false NOT NULL,
	"can_confirm_statistics" boolean DEFAULT false NOT NULL,
	"can_confirm_company_events" boolean DEFAULT false NOT NULL,
	"can_confirm_operational_disruption" boolean DEFAULT false NOT NULL,
	"can_confirm_prices" boolean DEFAULT false NOT NULL,
	"can_confirm_weather" boolean DEFAULT false NOT NULL,
	"can_confirm_international_trade" boolean DEFAULT false NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategic_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text DEFAULT '[]' NOT NULL,
	"domain" text NOT NULL,
	"icp" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"editorial_weight" integer DEFAULT 20 NOT NULL,
	"evidence_source_url" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_kit_sources" ADD CONSTRAINT "editorial_kit_sources_editorial_kit_id_editorial_kits_id_fk" FOREIGN KEY ("editorial_kit_id") REFERENCES "public"."editorial_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_kit_sources" ADD CONSTRAINT "editorial_kit_sources_editorial_source_id_editorial_sources_id_fk" FOREIGN KEY ("editorial_source_id") REFERENCES "public"."editorial_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_sources" ADD CONSTRAINT "editorial_sources_operational_source_id_sources_id_fk" FOREIGN KEY ("operational_source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_kit_sources_url_unique" ON "editorial_kit_sources" USING btree ("editorial_kit_id","url");--> statement-breakpoint
CREATE INDEX "editorial_kit_sources_kit_idx" ON "editorial_kit_sources" USING btree ("editorial_kit_id");--> statement-breakpoint
CREATE INDEX "editorial_kit_sources_source_idx" ON "editorial_kit_sources" USING btree ("editorial_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_sources_key_unique" ON "editorial_sources" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "editorial_sources_domain_idx" ON "editorial_sources" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "editorial_sources_collection_idx" ON "editorial_sources" USING btree ("active_for_collection","monitoring_mode","status");--> statement-breakpoint
CREATE INDEX "editorial_sources_authority_idx" ON "editorial_sources" USING btree ("authority_level","authority_score");--> statement-breakpoint
CREATE INDEX "editorial_sources_category_idx" ON "editorial_sources" USING btree ("category","country");--> statement-breakpoint
CREATE INDEX "editorial_sources_operational_idx" ON "editorial_sources" USING btree ("operational_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategic_accounts_domain_unique" ON "strategic_accounts" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "strategic_accounts_status_idx" ON "strategic_accounts" USING btree ("status","icp");