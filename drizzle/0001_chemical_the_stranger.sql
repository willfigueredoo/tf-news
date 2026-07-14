CREATE TABLE `ai_usage_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`request_id` text,
	`error_message` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_locks` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`locked_until` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `news_items` ADD `content_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `news_items` ADD `primary_icp` text DEFAULT 'Mercado e Logística' NOT NULL;--> statement-breakpoint
ALTER TABLE `news_items` ADD `secondary_icps` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `news_items` ADD `classification_method` text DEFAULT 'deterministic' NOT NULL;--> statement-breakpoint
ALTER TABLE `news_items` ADD `manually_edited_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_success_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_failure_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_status` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_http_status` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_item_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sources` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `wordpress_publications` ADD `wordpress_edit_url` text;
--> statement-breakpoint
INSERT OR IGNORE INTO `sources` (`name`, `domain`, `feed_url`, `website_url`, `reliability_score`, `active`, `last_status`, `last_item_count`, `consecutive_failures`, `created_at`, `updated_at`) VALUES ('Canal Rural', 'canalrural.com.br', 'https://www.canalrural.com.br/feed/', 'https://www.canalrural.com.br/', 85, 1, 'never', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
INSERT OR IGNORE INTO `sources` (`name`, `domain`, `feed_url`, `website_url`, `reliability_score`, `active`, `last_status`, `last_item_count`, `consecutive_failures`, `created_at`, `updated_at`) VALUES ('Agência Brasil', 'agenciabrasil.ebc.com.br', 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', 'https://agenciabrasil.ebc.com.br/', 90, 1, 'never', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
