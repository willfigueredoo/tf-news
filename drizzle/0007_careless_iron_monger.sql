CREATE TABLE "seo_sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"scope" text NOT NULL,
	"target_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_id" integer,
	"source_type" text,
	"source_url" text,
	"source_position" integer DEFAULT 0 NOT NULL,
	"cursor" text DEFAULT '{}' NOT NULL,
	"batch_size" integer DEFAULT 5 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"total_items" integer,
	"found" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"unavailable" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
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
ALTER TABLE "seo_sync_jobs" ADD CONSTRAINT "seo_sync_jobs_run_id_seo_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_sync_jobs_queue_idx" ON "seo_sync_jobs" USING btree ("status","next_run_at","created_at");--> statement-breakpoint
CREATE INDEX "seo_sync_jobs_target_idx" ON "seo_sync_jobs" USING btree ("scope","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_sync_jobs_active_target_unique" ON "seo_sync_jobs" USING btree ("scope","target_id") WHERE "seo_sync_jobs"."status" in ('queued', 'processing', 'retry');