import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  feedUrl: text("feed_url").notNull().unique(),
  websiteUrl: text("website_url"),
  reliabilityScore: integer("reliability_score").notNull().default(75),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastCollectedAt: text("last_collected_at"),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  lastError: text("last_error"),
  lastStatus: text("last_status").notNull().default("never"),
  lastDurationMs: integer("last_duration_ms"),
  lastHttpStatus: integer("last_http_status"),
  lastItemCount: integer("last_item_count").notNull().default(0),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const newsItems = sqliteTable("news_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  originalUrl: text("original_url").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  sourceId: integer("source_id").notNull().references(() => sources.id),
  sourceName: text("source_name").notNull(),
  author: text("author"),
  publishedAt: text("published_at").notNull(),
  collectedAt: text("collected_at").notNull(),
  excerpt: text("excerpt").notNull(),
  contentText: text("content_text").notNull().default(""),
  contentHash: text("content_hash").notNull(),
  titleHash: text("title_hash").notNull(),
  region: text("region").notNull(),
  logisticsImpact: text("logistics_impact").notNull(),
  relevanceScore: integer("relevance_score").notNull(),
  status: text("status").notNull().default("new"),
  topics: text("topics").notNull(),
  icps: text("icps").notNull(),
  primaryIcp: text("primary_icp").notNull().default("Mercado e Logística"),
  secondaryIcps: text("secondary_icps").notNull().default("[]"),
  classificationReason: text("classification_reason").notNull(),
  classificationMethod: text("classification_method").notNull().default("deterministic"),
  manuallyEditedAt: text("manually_edited_at"),
}, (table) => [
  uniqueIndex("news_canonical_unique").on(table.canonicalUrl),
  uniqueIndex("news_external_source_unique").on(table.externalId, table.sourceId),
  uniqueIndex("news_title_hash_unique").on(table.titleHash),
]);

export const editorialBriefs = sqliteTable("editorial_briefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  selectedIcp: text("selected_icp").notNull(),
  objective: text("objective").notNull(),
  primaryKeyword: text("primary_keyword").notNull(),
  payload: text("payload").notNull(),
  newsIds: text("news_ids").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  briefId: integer("brief_id").notNull().references(() => editorialBriefs.id),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  metaTitle: text("meta_title").notNull(),
  metaDescription: text("meta_description").notNull(),
  primaryKeyword: text("primary_keyword").notNull(),
  secondaryKeywords: text("secondary_keywords").notNull(),
  category: text("category").notNull(),
  tags: text("tags").notNull(),
  status: text("status").notNull().default("draft"),
  qualityScore: integer("quality_score").notNull().default(78),
  factualConfidence: real("factual_confidence").notNull().default(.8),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const wordpressPublications = sqliteTable("wordpress_publications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("article_id").notNull().unique().references(() => articles.id),
  wordpressPostId: integer("wordpress_post_id").notNull(),
  wordpressUrl: text("wordpress_url"),
  wordpressEditUrl: text("wordpress_edit_url"),
  wordpressStatus: text("wordpress_status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobLogs = sqliteTable("job_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  processedItems: integer("processed_items").notNull().default(0),
  errorMessage: text("error_message"),
  metadata: text("metadata"),
});

export const aiUsageLogs = sqliteTable("ai_usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  operation: text("operation").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  requestId: text("request_id"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
});

export const jobLocks = sqliteTable("job_locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  lockedUntil: text("locked_until").notNull(),
  updatedAt: text("updated_at").notNull(),
});
