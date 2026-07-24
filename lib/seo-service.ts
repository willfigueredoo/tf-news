import type { Database } from "../db/runtime.ts";
import { aiConfigured, type AiConfig } from "./ai.ts";
import { normalizeDomain, normalizeSiteUrl } from "./seo-security.ts";

type SiteRow = {
  id: number;
  name: string;
  domain: string;
  blog_url: string;
  wordpress_api_url: string | null;
  sitemap_url: string | null;
  rss_url: string | null;
  status: string;
  last_sync_at: string | null;
  next_sync_at: string | null;
  last_error: string | null;
  articles_found: number;
  articles_synced: number;
  discovery_method: string;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: number;
  source_type: string;
  url: string;
  status: string;
  priority: number;
  last_verified_at: string | null;
  last_error: string | null;
};

type SnapshotRow = {
  id: number;
  score: number;
  previous_score: number | null;
  confidence: number;
  google_status: string;
  google_score: number | null;
  gemini_score: number | null;
  engine_score: number;
  contributions: string;
  positive_factors: string;
  negative_factors: string;
  metrics: string;
  source_states: string;
  calculated_at: string;
};

type AnalysisRow = {
  id: number;
  operation: string;
  provider: string;
  model: string;
  status: string;
  confidence: number | null;
  payload: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type CompetitorRow = {
  id: number;
  name: string;
  domain: string;
  content_url: string | null;
  sitemap_url: string | null;
  rss_url: string | null;
  active: boolean;
  notes: string;
  last_sync_at: string | null;
  sync_status: string;
  last_error: string | null;
  discovered_at: string | null;
  created_at: string;
  updated_at: string;
  article_count: number;
  articles_last_30_days: number;
  last_published_at: string | null;
};

type CompetitorArticleRow = {
  id: number;
  competitor_id: number;
  title: string;
  url: string;
  published_at: string | null;
  modified_at: string | null;
  excerpt: string;
  topics: string;
  categories: string;
  tags: string;
  collection_method: string;
};

type OpportunityRow = {
  id: number;
  title: string;
  topic: string;
  icp: string;
  priority: string;
  seo_potential: string;
  confidence: number;
  reasons: string;
  signal_origins: string;
  competitor_ids: string;
  news_ids: string;
  site_article_ids: string;
  suggested_angle: string | null;
  status: string;
  valid_until: string;
  editorial_queue_id: number | null;
  editorial_kit_id: number | null;
  created_at: string;
  updated_at: string;
};

type SyncRunRow = {
  id: number;
  scope: string;
  target_id: number | null;
  trigger: string;
  status: string;
  method: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  found: number;
  inserted: number;
  updated: number;
  ignored: number;
  unavailable: number;
  errors: number;
  error_message: string | null;
};

export async function loadSeoIntelligenceSnapshot(db: Database, config: AiConfig) {
  const site = await db.prepare("SELECT * FROM seo_sites ORDER BY id LIMIT 1").first<SiteRow>();
  if (!site) {
    return {
      state: "not_configured",
      site: null,
      authority: null,
      competitors: [],
      competitorArticles: [],
      opportunities: [],
      syncRuns: [],
      ai: aiState(config),
      google: { searchConsole: "not_connected", analytics4: "not_connected" },
    };
  }

  const [
    siteSources,
    snapshots,
    authorityAnalysis,
    competitors,
    competitorArticles,
    competitorSources,
    competitorAnalyses,
    opportunities,
    syncRuns,
  ] = await Promise.all([
    db.prepare("SELECT id, source_type, url, status, priority, last_verified_at, last_error FROM seo_site_sources WHERE site_id = ? ORDER BY priority DESC, id").bind(site.id).all<SourceRow>(),
    db.prepare("SELECT * FROM seo_authority_snapshots WHERE site_id = ? ORDER BY calculated_at DESC, id DESC LIMIT 30").bind(site.id).all<SnapshotRow>(),
    db.prepare("SELECT id, operation, provider, model, status, confidence, payload, input_tokens, output_tokens, estimated_cost_usd, error_message, created_at, updated_at FROM seo_ai_analyses WHERE site_id = ? AND operation = 'seo_authority_summary' ORDER BY created_at DESC, id DESC LIMIT 1").bind(site.id).first<AnalysisRow>(),
    db.prepare(`
      SELECT c.*,
        COUNT(a.id)::int AS article_count,
        COUNT(a.id) FILTER (WHERE a.published_at >= ? AND a.status = 'published')::int AS articles_last_30_days,
        MAX(a.published_at) FILTER (WHERE a.status = 'published') AS last_published_at
      FROM seo_competitors c
      LEFT JOIN seo_competitor_articles a ON a.competitor_id = c.id
      WHERE c.archived_at IS NULL
      GROUP BY c.id
      ORDER BY c.name
    `).bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).all<CompetitorRow>(),
    db.prepare(`
      SELECT id, competitor_id, title, url, published_at, modified_at, excerpt, topics, categories, tags, collection_method
      FROM seo_competitor_articles
      WHERE status = 'published'
      ORDER BY published_at DESC NULLS LAST, id DESC
      LIMIT 300
    `).all<CompetitorArticleRow>(),
    db.prepare("SELECT id, competitor_id, source_type, url, status, priority, last_verified_at, last_error FROM seo_competitor_sources ORDER BY priority DESC, id")
      .all<SourceRow & { competitor_id: number }>(),
    db.prepare(`
      SELECT DISTINCT ON (competitor_id)
        id, competitor_id, operation, provider, model, status, confidence, payload,
        input_tokens, output_tokens, estimated_cost_usd, error_message, created_at, updated_at
      FROM seo_ai_analyses
      WHERE competitor_id IS NOT NULL AND operation = 'seo_competitor_analysis'
      ORDER BY competitor_id, created_at DESC, id DESC
    `).all<AnalysisRow & { competitor_id: number }>(),
    db.prepare(`
      SELECT id, title, topic, icp, priority, seo_potential, confidence, reasons, signal_origins,
        competitor_ids, news_ids, site_article_ids, suggested_angle, status, valid_until,
        editorial_queue_id, editorial_kit_id, created_at, updated_at
      FROM seo_opportunities
      WHERE site_id = ? AND status <> 'expired'
      ORDER BY confidence DESC, created_at DESC
      LIMIT 100
    `).bind(site.id).all<OpportunityRow>(),
    db.prepare("SELECT id, scope, target_id, trigger, status, method, started_at, finished_at, duration_ms, found, inserted, updated, ignored, unavailable, errors, error_message FROM seo_sync_runs ORDER BY started_at DESC, id DESC LIMIT 50")
      .all<SyncRunRow>(),
  ]);

  const latestSnapshot = snapshots.results[0] ?? null;
  const latestAuthorityAnalysis = authorityAnalysis ? mapAnalysis(authorityAnalysis) : null;
  const analysesByCompetitor = new Map(competitorAnalyses.results.map((analysis) => [analysis.competitor_id, mapAnalysis(analysis)]));
  const sourcesByCompetitor = new Map<number, Array<ReturnType<typeof mapSource>>>();
  for (const source of competitorSources.results) {
    const current = sourcesByCompetitor.get(source.competitor_id) ?? [];
    current.push(mapSource(source));
    sourcesByCompetitor.set(source.competitor_id, current);
  }

  const authority = latestSnapshot ? {
    value: latestSnapshot.score,
    previousValue: latestSnapshot.previous_score,
    evolution: latestSnapshot.previous_score === null ? null : latestSnapshot.score - latestSnapshot.previous_score,
    confidence: latestSnapshot.confidence,
    updatedAt: latestSnapshot.calculated_at,
    contributions: parseJson(latestSnapshot.contributions, []),
    positiveFactors: parseStringArray(latestSnapshot.positive_factors),
    negativeFactors: parseStringArray(latestSnapshot.negative_factors),
    metrics: parseJson(latestSnapshot.metrics, {}),
    sourceStates: parseJson(latestSnapshot.source_states, {}),
    summary: analysisSummary(latestAuthorityAnalysis),
    analysis: latestAuthorityAnalysis,
    history: snapshots.results
      .slice()
      .reverse()
      .map((snapshot) => ({ score: snapshot.score, calculatedAt: snapshot.calculated_at })),
    methodology: "Índice proprietário calculado com sinais efetivamente disponíveis, consistência editorial, qualidade semântica e inteligência competitiva do TF News.",
  } : null;

  return {
    state: deriveState(site, latestSnapshot, config),
    site: {
      id: site.id,
      name: site.name,
      domain: site.domain,
      blogUrl: site.blog_url,
      wordpressApiUrl: site.wordpress_api_url,
      sitemapUrl: site.sitemap_url,
      rssUrl: site.rss_url,
      status: site.status,
      lastSyncAt: site.last_sync_at,
      nextSyncAt: site.next_sync_at,
      lastError: site.last_error,
      articlesFound: site.articles_found,
      articlesSynced: site.articles_synced,
      discoveryMethod: site.discovery_method,
      sources: siteSources.results.map(mapSource),
    },
    authority,
    competitors: competitors.results.map((competitor) => ({
      id: competitor.id,
      name: competitor.name,
      domain: competitor.domain,
      contentUrl: competitor.content_url,
      sitemapUrl: competitor.sitemap_url,
      rssUrl: competitor.rss_url,
      active: competitor.active,
      notes: competitor.notes,
      lastSyncAt: competitor.last_sync_at,
      syncStatus: competitor.sync_status,
      lastError: competitor.last_error,
      discoveredAt: competitor.discovered_at,
      articleCount: competitor.article_count,
      articlesLast30Days: competitor.articles_last_30_days,
      lastPublishedAt: competitor.last_published_at,
      sources: sourcesByCompetitor.get(competitor.id) ?? [],
      analysis: analysesByCompetitor.get(competitor.id) ?? null,
    })),
    competitorArticles: competitorArticles.results.map((article) => ({
      id: article.id,
      competitorId: article.competitor_id,
      title: article.title,
      url: article.url,
      publishedAt: article.published_at,
      modifiedAt: article.modified_at,
      excerpt: article.excerpt,
      topics: uniqueTerms([
        ...parseStringArray(article.topics),
        ...parseStringArray(article.categories),
        ...parseStringArray(article.tags),
      ]).slice(0, 8),
      collectionMethod: article.collection_method,
    })),
    opportunities: opportunities.results.map((opportunity) => ({
      id: opportunity.id,
      title: opportunity.title,
      topic: opportunity.topic,
      icp: opportunity.icp,
      priority: opportunity.priority,
      seoPotential: opportunity.seo_potential,
      confidence: opportunity.confidence,
      reasons: parseStringArray(opportunity.reasons),
      signalOrigins: parseStringArray(opportunity.signal_origins),
      competitorIds: parseNumberArray(opportunity.competitor_ids),
      newsIds: parseNumberArray(opportunity.news_ids),
      siteArticleIds: parseNumberArray(opportunity.site_article_ids),
      suggestedAngle: opportunity.suggested_angle,
      status: opportunity.status,
      validUntil: opportunity.valid_until,
      editorialQueueId: opportunity.editorial_queue_id,
      editorialKitId: opportunity.editorial_kit_id,
      createdAt: opportunity.created_at,
      updatedAt: opportunity.updated_at,
    })),
    syncRuns: syncRuns.results.map((run) => ({
      id: run.id,
      scope: run.scope,
      targetId: run.target_id,
      trigger: run.trigger,
      status: run.status,
      method: run.method,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      durationMs: run.duration_ms,
      found: run.found,
      inserted: run.inserted,
      updated: run.updated,
      ignored: run.ignored,
      unavailable: run.unavailable,
      errors: run.errors,
      errorMessage: run.error_message,
    })),
    ai: aiState(config),
    google: { searchConsole: "not_connected", analytics4: "not_connected" },
  };
}

export async function updatePrimarySeoSite(db: Database, input: {
  name: string;
  domain: string;
  blogUrl: string;
  wordpressApiUrl?: string | null;
  sitemapUrl?: string | null;
  rssUrl?: string | null;
}) {
  const current = await db.prepare("SELECT id FROM seo_sites ORDER BY id LIMIT 1").first<{ id: number }>();
  if (!current) throw new Error("A configuração principal de SEO ainda não existe.");
  const now = new Date().toISOString();
  const domain = normalizeDomain(input.domain);
  const blogUrl = normalizeSiteUrl(input.blogUrl);
  const wordpressApiUrl = input.wordpressApiUrl ? normalizeSiteUrl(input.wordpressApiUrl) : null;
  const sitemapUrl = input.sitemapUrl ? normalizeSiteUrl(input.sitemapUrl) : null;
  const rssUrl = input.rssUrl ? normalizeSiteUrl(input.rssUrl) : null;
  const statements = [
    db.prepare(`
      UPDATE seo_sites
      SET name = ?, domain = ?, blog_url = ?, wordpress_api_url = ?, sitemap_url = ?, rss_url = ?,
        status = 'pending_sync', updated_at = ?
      WHERE id = ?
    `).bind(input.name.trim(), domain, blogUrl, wordpressApiUrl, sitemapUrl, rssUrl, now, current.id),
    db.prepare("DELETE FROM seo_site_sources WHERE site_id = ?").bind(current.id),
  ];
  const configuredSources = [
    wordpressApiUrl ? { type: "wordpress_rest", url: wordpressApiUrl, status: "active", priority: 100 } : null,
    sitemapUrl ? { type: "sitemap", url: sitemapUrl, status: wordpressApiUrl ? "fallback" : "active", priority: 80 } : null,
    rssUrl ? { type: "rss", url: rssUrl, status: wordpressApiUrl || sitemapUrl ? "fallback" : "active", priority: 60 } : null,
  ].filter((source): source is NonNullable<typeof source> => Boolean(source));
  for (const source of configuredSources) {
    statements.push(db.prepare(`
      INSERT INTO seo_site_sources (site_id, source_type, url, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(current.id, source.type, source.url, source.status, source.priority, now, now));
  }
  await db.batch(statements);
  return current.id;
}

function mapSource(source: SourceRow) {
  return {
    id: source.id,
    sourceType: source.source_type,
    url: source.url,
    status: source.status,
    priority: source.priority,
    lastVerifiedAt: source.last_verified_at,
    lastError: source.last_error,
  };
}

function mapAnalysis(row: AnalysisRow) {
  return {
    id: row.id,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    status: row.status,
    confidence: row.confidence,
    payload: parseJson(row.payload, {}),
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function aiState(config: AiConfig) {
  return {
    configured: aiConfigured(config),
    provider: config.provider,
    model: config.model,
  };
}

function deriveState(site: SiteRow, snapshot: SnapshotRow | null, config: AiConfig) {
  if (site.status === "error") return "sync_error";
  if (!site.last_sync_at) return "awaiting_first_sync";
  if (!snapshot) return "analysis_pending";
  if (!aiConfigured(config)) return "gemini_unavailable";
  return "ready";
}

function analysisSummary(analysis: ReturnType<typeof mapAnalysis> | null) {
  const payload = analysis?.payload;
  if (!payload || typeof payload !== "object" || !("summary" in payload)) return null;
  return typeof payload.summary === "string" ? payload.summary : null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string) {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function parseNumberArray(value: string) {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed)
    ? parsed.map(Number).filter((item) => Number.isInteger(item) && item > 0)
    : [];
}

function uniqueTerms(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
