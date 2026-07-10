import { env } from "cloudflare:workers";

let ready = false;

export async function getRuntimeDb() {
  const db = env.DB;
  if (!db) throw new Error("Banco de dados indisponível.");
  if (!ready) {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, domain TEXT NOT NULL, feed_url TEXT NOT NULL UNIQUE, website_url TEXT, reliability_score INTEGER NOT NULL DEFAULT 75, active INTEGER NOT NULL DEFAULT 1, last_collected_at TEXT, last_error TEXT, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS news_items (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT NOT NULL, title TEXT NOT NULL, original_url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE, source_id INTEGER NOT NULL, source_name TEXT NOT NULL, author TEXT, published_at TEXT NOT NULL, collected_at TEXT NOT NULL, excerpt TEXT NOT NULL, content_hash TEXT NOT NULL, title_hash TEXT NOT NULL UNIQUE, region TEXT NOT NULL, logistics_impact TEXT NOT NULL, relevance_score INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', topics TEXT NOT NULL, icps TEXT NOT NULL, classification_reason TEXT NOT NULL, UNIQUE(external_id, source_id), FOREIGN KEY(source_id) REFERENCES sources(id))"),
      db.prepare("CREATE INDEX IF NOT EXISTS news_relevance_idx ON news_items(relevance_score DESC, published_at DESC)"),
      db.prepare("CREATE TABLE IF NOT EXISTS editorial_briefs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, selected_icp TEXT NOT NULL, objective TEXT NOT NULL, primary_keyword TEXT NOT NULL, payload TEXT NOT NULL, news_ids TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, brief_id INTEGER NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, excerpt TEXT NOT NULL, content TEXT NOT NULL, meta_title TEXT NOT NULL, meta_description TEXT NOT NULL, primary_keyword TEXT NOT NULL, secondary_keywords TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', quality_score INTEGER NOT NULL DEFAULT 78, factual_confidence REAL NOT NULL DEFAULT .8, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(brief_id) REFERENCES editorial_briefs(id))"),
      db.prepare("CREATE TABLE IF NOT EXISTS wordpress_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL UNIQUE, wordpress_post_id INTEGER NOT NULL, wordpress_url TEXT, wordpress_status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(article_id) REFERENCES articles(id))"),
      db.prepare("CREATE TABLE IF NOT EXISTS job_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, processed_items INTEGER NOT NULL DEFAULT 0, error_message TEXT, metadata TEXT)"),
    ]);
    ready = true;
  }
  return db;
}

export function rowsOf<T>(result: { results?: T[] }) {
  return result.results ?? [];
}
