CREATE TABLE IF NOT EXISTS `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brief_id` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text NOT NULL,
	`content` text NOT NULL,
	`meta_title` text NOT NULL,
	`meta_description` text NOT NULL,
	`primary_keyword` text NOT NULL,
	`secondary_keywords` text NOT NULL,
	`category` text NOT NULL,
	`tags` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`quality_score` integer DEFAULT 78 NOT NULL,
	`factual_confidence` real DEFAULT 0.8 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `editorial_briefs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `articles_slug_unique` ON `articles` (`slug`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `editorial_briefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`selected_icp` text NOT NULL,
	`objective` text NOT NULL,
	`primary_keyword` text NOT NULL,
	`payload` text NOT NULL,
	`news_ids` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`processed_items` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `news_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`original_url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`source_id` integer NOT NULL,
	`source_name` text NOT NULL,
	`author` text,
	`published_at` text NOT NULL,
	`collected_at` text NOT NULL,
	`excerpt` text NOT NULL,
	`content_hash` text NOT NULL,
	`title_hash` text NOT NULL,
	`region` text NOT NULL,
	`logistics_impact` text NOT NULL,
	`relevance_score` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`topics` text NOT NULL,
	`icps` text NOT NULL,
	`classification_reason` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `news_canonical_unique` ON `news_items` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `news_external_source_unique` ON `news_items` (`external_id`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `news_title_hash_unique` ON `news_items` (`title_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`feed_url` text NOT NULL,
	`website_url` text,
	`reliability_score` integer DEFAULT 75 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_collected_at` text,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sources_feed_url_unique` ON `sources` (`feed_url`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `wordpress_publications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`wordpress_post_id` integer NOT NULL,
	`wordpress_url` text,
	`wordpress_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `wordpress_publications_article_id_unique` ON `wordpress_publications` (`article_id`);
