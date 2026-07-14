import { env } from "cloudflare:workers";

let ready = false;

export async function getRuntimeDb() {
  const db = env.DB;
  if (!db) throw new Error("Banco de dados indisponível.");
  if (!ready) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, domain TEXT NOT NULL, feed_url TEXT NOT NULL UNIQUE, website_url TEXT, reliability_score INTEGER NOT NULL DEFAULT 75, active INTEGER NOT NULL DEFAULT 1, last_collected_at TEXT, last_success_at TEXT, last_failure_at TEXT, last_error TEXT, last_status TEXT NOT NULL DEFAULT 'never', last_duration_ms INTEGER, last_http_status INTEGER, last_item_count INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS news_items (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT NOT NULL, title TEXT NOT NULL, original_url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE, source_id INTEGER NOT NULL, source_name TEXT NOT NULL, author TEXT, published_at TEXT NOT NULL, collected_at TEXT NOT NULL, excerpt TEXT NOT NULL, content_text TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL, title_hash TEXT NOT NULL UNIQUE, region TEXT NOT NULL, logistics_impact TEXT NOT NULL, relevance_score INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', topics TEXT NOT NULL, icps TEXT NOT NULL, primary_icp TEXT NOT NULL DEFAULT 'Mercado e Logística', secondary_icps TEXT NOT NULL DEFAULT '[]', classification_reason TEXT NOT NULL, classification_method TEXT NOT NULL DEFAULT 'deterministic', manually_edited_at TEXT, UNIQUE(external_id, source_id), FOREIGN KEY(source_id) REFERENCES sources(id))"),
      db.prepare("CREATE INDEX IF NOT EXISTS news_relevance_idx ON news_items(relevance_score DESC, published_at DESC)"),
      db.prepare("CREATE TABLE IF NOT EXISTS editorial_briefs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, selected_icp TEXT NOT NULL, objective TEXT NOT NULL, primary_keyword TEXT NOT NULL, payload TEXT NOT NULL, news_ids TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, brief_id INTEGER NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, excerpt TEXT NOT NULL, content TEXT NOT NULL, meta_title TEXT NOT NULL, meta_description TEXT NOT NULL, primary_keyword TEXT NOT NULL, secondary_keywords TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', quality_score INTEGER NOT NULL DEFAULT 78, factual_confidence REAL NOT NULL DEFAULT .8, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(brief_id) REFERENCES editorial_briefs(id))"),
      db.prepare("CREATE TABLE IF NOT EXISTS wordpress_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL UNIQUE, wordpress_post_id INTEGER NOT NULL, wordpress_url TEXT, wordpress_edit_url TEXT, wordpress_status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(article_id) REFERENCES articles(id))"),
      db.prepare("CREATE TABLE IF NOT EXISTS job_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, processed_items INTEGER NOT NULL DEFAULT 0, error_message TEXT, metadata TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS ai_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, estimated_cost_usd REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0, request_id TEXT, error_message TEXT, created_at TEXT NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage_logs(created_at DESC)"),
      db.prepare("CREATE TABLE IF NOT EXISTS job_locks (name TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, locked_until TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    ]);
    ready = true;
  }
  return db;
}

export function rowsOf<T>(result: { results?: T[] }) {
  return result.results ?? [];
}
