import type { Database } from "../db/runtime.ts";
import { canonicalizeUrl, classifyNews, parseFeed, sha256 } from "./editorial.ts";
import { acquireJobLock, releaseJobLock } from "./jobs.ts";
import {
  extractHtmlMetadata,
  htmlToText,
  normalizeDomain,
  normalizeExternalUrl,
  normalizeSiteUrl,
  parseSitemap,
  safeExternalFetch,
} from "./seo-security.ts";

type SiteRow = {
  id: number;
  name: string;
  domain: string;
  blog_url: string;
  wordpress_api_url: string | null;
  sitemap_url: string | null;
  rss_url: string | null;
};

export type SeoSourceRow = {
  id: number;
  source_type: "wordpress_rest" | "sitemap" | "rss" | "html_index";
  url: string;
  priority: number;
  status: string;
};

type CompetitorRow = {
  id: number;
  name: string;
  domain: string;
  content_url: string | null;
  sitemap_url: string | null;
  rss_url: string | null;
  active: boolean;
};

export type CollectedArticle = {
  externalId: string;
  title: string;
  url: string;
  canonicalUrl: string;
  slug: string;
  excerpt: string;
  contentText: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  author: string | null;
  categories: string[];
  tags: string[];
  featuredImageUrl: string | null;
  status: string;
  metaDescription: string | null;
  keywords: string[];
  icps: string[];
  topics: string[];
  contentHash: string;
  method: "wordpress_rest" | "sitemap" | "rss";
  sourceId?: number | null;
};

export type SeoSyncResult = {
  runId: number;
  targetId: number;
  scope: "site" | "competitor";
  method: string;
  found: number;
  inserted: number;
  updated: number;
  ignored: number;
  unavailable: number;
  durationMs: number;
  changed: boolean;
};

export type DiscoveredSeoSource = {
  sourceType: "wordpress_rest" | "sitemap" | "rss";
  url: string;
  valid: boolean;
  itemCount: number;
  detail: string;
};

export type SeoSyncCursor = {
  offset?: number;
  pageSize?: number;
  before?: string;
  childIndex?: number;
  entryOffset?: number;
};

export type SeoSyncBatch = {
  articles: CollectedArticle[];
  cursor: SeoSyncCursor;
  processed: number;
  total: number | null;
  done: boolean;
  method: "wordpress_rest" | "sitemap" | "rss";
};

export async function getPrimarySeoSite(db: Database) {
  return db.prepare("SELECT id, name, domain, blog_url, wordpress_api_url, sitemap_url, rss_url FROM seo_sites ORDER BY id LIMIT 1").first<SiteRow>();
}

export async function syncPrimarySeoSite(
  db: Database,
  options: { fetchImpl?: typeof fetch; trigger?: "manual" | "automatic"; maxArticles?: number } = {},
) {
  const site = await getPrimarySeoSite(db);
  if (!site) throw new Error("Configure o site principal antes de iniciar a sincronização.");
  return syncSite(db, site, options);
}

export async function discoverCompetitorSources(
  input: { domain: string; contentUrl?: string | null; sitemapUrl?: string | null; rssUrl?: string | null },
  fetchImpl?: typeof fetch,
) {
  const domain = normalizeDomain(input.domain);
  const candidates = uniqueCandidates([
    input.contentUrl ? { sourceType: inferSourceType(input.contentUrl), url: input.contentUrl } : null,
    input.sitemapUrl ? { sourceType: "sitemap" as const, url: input.sitemapUrl } : null,
    input.rssUrl ? { sourceType: "rss" as const, url: input.rssUrl } : null,
    { sourceType: "wordpress_rest" as const, url: new URL("/wp-json/wp/v2/posts", domain).toString() },
    { sourceType: "sitemap" as const, url: new URL("/wp-sitemap-posts-post-1.xml", domain).toString() },
    { sourceType: "sitemap" as const, url: new URL("/wp-sitemap.xml", domain).toString() },
    { sourceType: "sitemap" as const, url: new URL("/sitemap_index.xml", domain).toString() },
    { sourceType: "sitemap" as const, url: new URL("/sitemap.xml", domain).toString() },
    { sourceType: "rss" as const, url: new URL("/feed/", domain).toString() },
    { sourceType: "rss" as const, url: new URL("/blog/feed/", domain).toString() },
  ]);

  const discovered: DiscoveredSeoSource[] = [];
  for (const candidate of candidates.slice(0, 9)) {
    try {
      const result = await probeSource(candidate.sourceType, candidate.url, fetchImpl);
      if (result.valid) discovered.push(result);
    } catch {
      // Descoberta é best-effort. Somente fontes confirmadas são retornadas ao usuário.
    }
  }
  return { domain, sources: discovered.sort((a, b) => sourcePriority(b.sourceType) - sourcePriority(a.sourceType)) };
}

export async function createSeoCompetitor(db: Database, input: {
  name: string;
  domain: string;
  contentUrl?: string | null;
  notes?: string;
  sources: Array<{ sourceType: "wordpress_rest" | "sitemap" | "rss"; url: string }>;
}) {
  if (!input.sources.length) throw new Error("Confirme ao menos uma fonte editorial válida antes de ativar o concorrente.");
  const domain = normalizeDomain(input.domain);
  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM seo_competitors WHERE domain = ? AND archived_at IS NULL").bind(domain).first<{ id: number }>();
  if (existing) throw new Error("Este concorrente já está cadastrado.");
  const created = await db.prepare("INSERT INTO seo_competitors (name, domain, content_url, sitemap_url, rss_url, active, notes, sync_status, discovered_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, TRUE, ?, 'ready', ?, ?, ?) RETURNING id")
    .bind(
      input.name.trim(),
      domain,
      input.contentUrl ? normalizeSiteUrl(input.contentUrl) : null,
      input.sources.find((source) => source.sourceType === "sitemap")?.url ?? null,
      input.sources.find((source) => source.sourceType === "rss")?.url ?? null,
      input.notes?.trim() ?? "",
      now,
      now,
      now,
    ).run();
  const id = Number(created.meta.last_row_id);
  if (!id) throw new Error("Não foi possível cadastrar o concorrente.");
  await db.batch(input.sources.map((source) => db.prepare("INSERT INTO seo_competitor_sources (competitor_id, source_type, url, status, priority, last_verified_at, created_at, updated_at) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?) ON CONFLICT (competitor_id, url) DO NOTHING")
    .bind(id, source.sourceType, normalizeSiteUrl(source.url), sourcePriority(source.sourceType), now, now, now)));
  const competitor = await loadSeoCompetitor(db, id);
  if (!competitor) throw new Error("O concorrente foi cadastrado, mas não pôde ser relido.");
  return competitor;
}

export async function updateSeoCompetitor(db: Database, input: {
  id: number;
  name?: string;
  notes?: string;
  active?: boolean;
}) {
  const now = new Date().toISOString();
  const current = await db.prepare("SELECT id, name, notes, active FROM seo_competitors WHERE id = ? AND archived_at IS NULL").bind(input.id).first<{ id: number; name: string; notes: string; active: boolean }>();
  if (!current) throw new Error("Concorrente não encontrado.");
  await db.prepare("UPDATE seo_competitors SET name = ?, notes = ?, active = ?, sync_status = CASE WHEN ? THEN sync_status ELSE 'paused' END, updated_at = ? WHERE id = ?")
    .bind(input.name?.trim() || current.name, input.notes?.trim() ?? current.notes, input.active ?? current.active, input.active ?? current.active, now, input.id).run();
  return loadSeoCompetitor(db, input.id);
}

export async function removeSeoCompetitor(db: Database, id: number) {
  const current = await db.prepare("SELECT id FROM seo_competitors WHERE id = ?").bind(id).first<{ id: number }>();
  if (!current) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE seo_sync_jobs SET status = 'cancelled', finished_at = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL WHERE scope = 'competitor' AND target_id = ? AND status IN ('queued', 'processing', 'retry')")
      .bind(now, now, id),
    db.prepare("UPDATE seo_sync_runs SET status = 'cancelled', finished_at = ?, error_message = 'Concorrente removido pelo usuário.' WHERE scope = 'competitor' AND target_id = ? AND status IN ('queued', 'running')")
      .bind(now, id),
    db.prepare("DELETE FROM seo_competitor_articles WHERE competitor_id = ?").bind(id),
    db.prepare("DELETE FROM seo_competitor_sources WHERE competitor_id = ?").bind(id),
    db.prepare("UPDATE seo_opportunities SET competitor_ids = '[]', updated_at = ? WHERE competitor_ids::jsonb @> ?::jsonb")
      .bind(now, JSON.stringify([id])),
    db.prepare("UPDATE seo_opportunities SET source_analysis_id = NULL, updated_at = ? WHERE source_analysis_id IN (SELECT id FROM seo_ai_analyses WHERE competitor_id = ?)")
      .bind(now, id),
    db.prepare("DELETE FROM seo_ai_analyses WHERE competitor_id = ?").bind(id),
    db.prepare("DELETE FROM seo_competitors WHERE id = ?").bind(id),
  ]);
  return true;
}

export async function syncSeoCompetitor(
  db: Database,
  competitorId: number,
  options: { fetchImpl?: typeof fetch; trigger?: "manual" | "automatic"; maxArticles?: number } = {},
) {
  const competitor = await db.prepare("SELECT id, name, domain, content_url, sitemap_url, rss_url, active FROM seo_competitors WHERE id = ? AND archived_at IS NULL").bind(competitorId).first<CompetitorRow>();
  if (!competitor) throw new Error("Concorrente não encontrado.");
  if (!competitor.active) throw new Error("Ative o concorrente antes de sincronizar.");
  const sources = await db.prepare("SELECT id, source_type, url, priority, status FROM seo_competitor_sources WHERE competitor_id = ? AND status = 'confirmed' ORDER BY priority DESC, id").bind(competitorId).all<SeoSourceRow>();
  if (!sources.results.length) throw new Error("Fonte indisponível para coleta automática.");
  return syncCompetitor(db, competitor, sources.results, options);
}

export async function syncAllSeoSources(
  db: Database,
  options: { fetchImpl?: typeof fetch; trigger?: "manual" | "automatic"; maxArticles?: number } = {},
) {
  const owner = await acquireJobLock(db, "seo-sync-all", 15 * 60);
  if (!owner) return { locked: true, site: null, competitors: [] as Array<Record<string, unknown>>, changed: false };
  try {
    let changed = false;
    let site: SeoSyncResult | { error: string } | null = null;
    try {
      site = await syncPrimarySeoSite(db, options);
      changed ||= site.changed;
    } catch (error) {
      site = { error: safeError(error) };
    }
    const rows = await db.prepare("SELECT id FROM seo_competitors WHERE active = TRUE AND archived_at IS NULL ORDER BY id").all<{ id: number }>();
    const competitors: Array<Record<string, unknown>> = [];
    for (const row of rows.results) {
      try {
        const result = await syncSeoCompetitor(db, row.id, options);
        competitors.push(result);
        changed ||= result.changed;
      } catch (error) {
        competitors.push({ targetId: row.id, error: safeError(error) });
      }
    }
    return { locked: false, site, competitors, changed };
  } finally {
    await releaseJobLock(db, "seo-sync-all", owner);
  }
}

export async function loadSeoCompetitor(db: Database, id: number) {
  return db.prepare(`
    SELECT c.*, COUNT(a.id)::int AS article_count,
      COUNT(a.id) FILTER (WHERE a.published_at >= ? AND a.status = 'published')::int AS articles_last_30_days,
      MAX(a.published_at) AS last_published_at
    FROM seo_competitors c
    LEFT JOIN seo_competitor_articles a ON a.competitor_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).bind(new Date(Date.now() - 30 * 86_400_000).toISOString(), id).first<Record<string, unknown> & { id: number }>();
}

async function syncSite(
  db: Database,
  site: SiteRow,
  options: { fetchImpl?: typeof fetch; trigger?: "manual" | "automatic"; maxArticles?: number },
) {
  const lockName = `seo-site:${site.id}`;
  const owner = await acquireJobLock(db, lockName, 10 * 60);
  if (!owner) throw new Error("A sincronização do Blog TransFAST já está em andamento.");
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const runId = await createSyncRun(db, "site", site.id, options.trigger ?? "manual", startedAt);
  try {
    const sources = await db.prepare("SELECT id, source_type, url, priority, status FROM seo_site_sources WHERE site_id = ? ORDER BY priority DESC, id").bind(site.id).all<SeoSourceRow>();
    let collected: CollectedArticle[] = [];
    let method = "";
    let lastError = "";
    for (const source of sources.results) {
      try {
        collected = await collectFromSource(source, options.fetchImpl, options.maxArticles ?? 2_000);
        if (collected.length) {
          method = source.source_type;
          await markSourceSuccess(db, "seo_site_sources", source.id);
          break;
        }
      } catch (error) {
        lastError = safeError(error);
        await markSourceFailure(db, "seo_site_sources", source.id, lastError);
      }
    }
    if (!collected.length) throw new Error(lastError || "Nenhum artigo público foi encontrado nas fontes configuradas.");
    const counts = await persistSiteArticles(db, site.id, collected, startedAt);
    const unavailable = method === "wordpress_rest"
      ? await markUnavailableSiteArticles(db, site.id, startedAt)
      : 0;
    const finishedAt = new Date().toISOString();
    const result: SeoSyncResult = {
      runId,
      targetId: site.id,
      scope: "site",
      method,
      found: collected.length,
      ...counts,
      unavailable,
      durationMs: Date.now() - started,
      changed: counts.inserted > 0 || counts.updated > 0 || unavailable > 0,
    };
    await db.batch([
      db.prepare("UPDATE seo_sites SET status = 'ready', last_sync_at = ?, next_sync_at = ?, last_error = NULL, articles_found = ?, articles_synced = (SELECT COUNT(*)::int FROM seo_articles WHERE site_id = ? AND status = 'published'), discovery_method = ?, updated_at = ? WHERE id = ?")
        .bind(finishedAt, new Date(Date.now() + 86_400_000).toISOString(), collected.length, site.id, method, finishedAt, site.id),
      finishSyncRun(db, runId, "success", result, null, finishedAt),
    ]);
    return result;
  } catch (error) {
    const message = safeError(error);
    const finishedAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE seo_sites SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(message, finishedAt, site.id),
      finishSyncRun(db, runId, "failed", null, message, finishedAt),
    ]);
    throw new Error(message);
  } finally {
    await releaseJobLock(db, lockName, owner);
  }
}

async function syncCompetitor(
  db: Database,
  competitor: CompetitorRow,
  sources: SeoSourceRow[],
  options: { fetchImpl?: typeof fetch; trigger?: "manual" | "automatic"; maxArticles?: number },
) {
  const lockName = `seo-competitor:${competitor.id}`;
  const owner = await acquireJobLock(db, lockName, 10 * 60);
  if (!owner) throw new Error("A sincronização deste concorrente já está em andamento.");
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const runId = await createSyncRun(db, "competitor", competitor.id, options.trigger ?? "manual", startedAt);
  try {
    let collected: CollectedArticle[] = [];
    let method = "";
    let lastError = "";
    for (const source of sources) {
      try {
        collected = (await collectFromSource(source, options.fetchImpl, options.maxArticles ?? 500)).map((article) => ({ ...article, sourceId: source.id }));
        if (collected.length) {
          method = source.source_type;
          await markSourceSuccess(db, "seo_competitor_sources", source.id);
          break;
        }
      } catch (error) {
        lastError = safeError(error);
        await markSourceFailure(db, "seo_competitor_sources", source.id, lastError);
      }
    }
    if (!collected.length) throw new Error(lastError || "Fonte indisponível para coleta automática.");
    const counts = await persistCompetitorArticles(db, competitor.id, collected, startedAt);
    const unavailable = method === "wordpress_rest"
      ? await markUnavailableCompetitorArticles(db, competitor.id, startedAt)
      : 0;
    const finishedAt = new Date().toISOString();
    const result: SeoSyncResult = {
      runId,
      targetId: competitor.id,
      scope: "competitor",
      method,
      found: collected.length,
      ...counts,
      unavailable,
      durationMs: Date.now() - started,
      changed: counts.inserted > 0 || counts.updated > 0 || unavailable > 0,
    };
    await db.batch([
      db.prepare("UPDATE seo_competitors SET sync_status = 'ready', last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?").bind(finishedAt, finishedAt, competitor.id),
      finishSyncRun(db, runId, "success", result, null, finishedAt),
    ]);
    return result;
  } catch (error) {
    const message = safeError(error);
    const finishedAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE seo_competitors SET sync_status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(message, finishedAt, competitor.id),
      finishSyncRun(db, runId, "failed", null, message, finishedAt),
    ]);
    throw new Error(message);
  } finally {
    await releaseJobLock(db, lockName, owner);
  }
}

async function collectFromSource(source: SeoSourceRow, fetchImpl?: typeof fetch, maxArticles = 500) {
  if (source.source_type === "wordpress_rest") return collectWordPress(source.url, fetchImpl, maxArticles);
  if (source.source_type === "sitemap") return collectSitemap(source.url, fetchImpl, maxArticles);
  if (source.source_type === "rss") return collectRss(source.url, fetchImpl, maxArticles);
  throw new Error("Fonte indisponível para coleta automática.");
}

export async function collectSourceIncrementalBatch(
  source: SeoSourceRow,
  cursor: SeoSyncCursor,
  options: { fetchImpl?: typeof fetch; batchSize?: number } = {},
): Promise<SeoSyncBatch> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 5, 20));
  if (source.source_type === "wordpress_rest") {
    return collectWordPressIncremental(source.url, cursor, batchSize, options.fetchImpl);
  }
  if (source.source_type === "rss") {
    return collectRssIncremental(source.url, cursor, batchSize, options.fetchImpl);
  }
  if (source.source_type === "sitemap") {
    return collectSitemapIncremental(source.url, cursor, Math.min(batchSize, 5), options.fetchImpl);
  }
  throw new Error("Fonte indisponível para coleta automática.");
}

async function collectWordPressIncremental(
  baseUrl: string,
  cursor: SeoSyncCursor,
  requestedPageSize: number,
  fetchImpl?: typeof fetch,
): Promise<SeoSyncBatch> {
  const offset = Math.max(0, cursor.offset ?? 0);
  const before = cursor.before ?? new Date().toISOString();
  let pageSize = Math.max(1, Math.min(cursor.pageSize ?? requestedPageSize, requestedPageSize));
  while (true) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set("status", "publish");
      url.searchParams.set("per_page", String(pageSize));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("orderby", "date");
      url.searchParams.set("order", "desc");
      url.searchParams.set("before", before);
      url.searchParams.set("_fields", [
        "id", "date", "date_gmt", "modified", "modified_gmt", "link", "slug", "status",
        "title", "excerpt", "content", "yoast_head_json",
      ].join(","));
      const result = await safeExternalFetch(url.toString(), {
        fetchImpl,
        timeoutMs: 12_000,
        maxBytes: 6_000_000,
        allowedContentTypes: /json/i,
        accept: "application/json",
      });
      const posts = JSON.parse(result.text) as unknown;
      if (!Array.isArray(posts)) throw new Error("A API WordPress não retornou uma lista de artigos.");
      const reportedTotal = Number(result.response.headers.get("x-wp-total") ?? posts.length);
      const total = Math.max(posts.length, Number.isFinite(reportedTotal) ? reportedTotal : posts.length);
      const articles = await Promise.all(posts.map((post) => normalizeWordPressPost(post)));
      const nextOffset = offset + posts.length;
      return {
        articles: deduplicateArticles(articles),
        cursor: { offset: nextOffset, pageSize, before },
        processed: posts.length,
        total,
        done: posts.length === 0 || posts.length < pageSize || nextOffset >= total,
        method: "wordpress_rest",
      };
    } catch (error) {
      if (/excede o limite/i.test(safeError(error)) && pageSize > 1) {
        pageSize = Math.max(1, Math.floor(pageSize / 2));
        continue;
      }
      throw error;
    }
  }
}

async function collectRssIncremental(
  url: string,
  cursor: SeoSyncCursor,
  batchSize: number,
  fetchImpl?: typeof fetch,
): Promise<SeoSyncBatch> {
  const offset = Math.max(0, cursor.offset ?? 0);
  const all = await collectRss(url, fetchImpl, 2_000);
  const articles = all.slice(offset, offset + batchSize);
  const nextOffset = offset + articles.length;
  return {
    articles,
    cursor: { offset: nextOffset },
    processed: articles.length,
    total: all.length,
    done: nextOffset >= all.length,
    method: "rss",
  };
}

async function collectSitemapIncremental(
  url: string,
  cursor: SeoSyncCursor,
  batchSize: number,
  fetchImpl?: typeof fetch,
): Promise<SeoSyncBatch> {
  const result = await safeExternalFetch(url, {
    fetchImpl,
    timeoutMs: 10_000,
    maxBytes: 4_000_000,
    allowedContentTypes: /(xml|text)/i,
  });
  const sitemap = parseSitemap(result.text);
  if (sitemap.entries.length) {
    const offset = Math.max(0, cursor.offset ?? 0);
    const entries = sitemap.entries.slice(offset, offset + batchSize);
    const articles = await collectSitemapEntryBatch(entries, fetchImpl);
    const nextOffset = offset + entries.length;
    return {
      articles,
      cursor: { offset: nextOffset },
      processed: entries.length,
      total: sitemap.entries.length,
      done: nextOffset >= sitemap.entries.length,
      method: "sitemap",
    };
  }

  const children = prioritizedSitemaps(sitemap.childSitemaps);
  if (!children.length) {
    return { articles: [], cursor: {}, processed: 0, total: 0, done: true, method: "sitemap" };
  }
  let childIndex = Math.max(0, cursor.childIndex ?? 0);
  let entryOffset = Math.max(0, cursor.entryOffset ?? 0);
  while (childIndex < children.length) {
    const nested = await safeExternalFetch(children[childIndex], {
      fetchImpl,
      timeoutMs: 10_000,
      maxBytes: 4_000_000,
      allowedContentTypes: /(xml|text)/i,
    });
    const entries = parseSitemap(nested.text).entries;
    if (entryOffset >= entries.length) {
      childIndex += 1;
      entryOffset = 0;
      continue;
    }
    const selected = entries.slice(entryOffset, entryOffset + batchSize);
    const articles = await collectSitemapEntryBatch(selected, fetchImpl);
    const nextOffset = entryOffset + selected.length;
    const childDone = nextOffset >= entries.length;
    return {
      articles,
      cursor: childDone
        ? { childIndex: childIndex + 1, entryOffset: 0 }
        : { childIndex, entryOffset: nextOffset },
      processed: selected.length,
      total: null,
      done: childDone && childIndex + 1 >= children.length,
      method: "sitemap",
    };
  }
  return { articles: [], cursor: { childIndex, entryOffset: 0 }, processed: 0, total: null, done: true, method: "sitemap" };
}

function prioritizedSitemaps(values: string[]) {
  const editorial = values.filter((child) => /(post|blog|news|noticia|article)/i.test(child));
  return (editorial.length ? editorial : values).slice(0, 50);
}

async function collectSitemapEntryBatch(
  entries: Array<{ url: string; lastModifiedAt: string | null }>,
  fetchImpl?: typeof fetch,
) {
  const settled = await Promise.allSettled(entries.map(async (entry) => {
    const page = await safeExternalFetch(entry.url, {
      fetchImpl,
      timeoutMs: 8_000,
      maxBytes: 2_000_000,
      allowedContentTypes: /(html|text)/i,
      accept: "text/html",
    });
    return normalizeSitemapPage(page, entry.lastModifiedAt);
  }));
  return deduplicateArticles(settled
    .filter((item): item is PromiseFulfilledResult<CollectedArticle | null> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item): item is CollectedArticle => Boolean(item)));
}

async function collectWordPress(baseUrl: string, fetchImpl?: typeof fetch, maxArticles = 2_000) {
  const collected: CollectedArticle[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && collected.length < maxArticles) {
    const url = new URL(baseUrl);
    url.searchParams.set("status", "publish");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("_embed", "1");
    const result = await safeExternalFetch(url.toString(), {
      fetchImpl,
      timeoutMs: 15_000,
      maxBytes: 8_000_000,
      allowedContentTypes: /json/i,
      accept: "application/json",
    });
    const posts = JSON.parse(result.text) as unknown;
    if (!Array.isArray(posts)) throw new Error("A API WordPress não retornou uma lista de artigos.");
    totalPages = Math.max(1, Math.min(100, Number(result.response.headers.get("x-wp-totalpages") ?? 1)));
    for (const post of posts) collected.push(await normalizeWordPressPost(post));
    if (!posts.length) break;
    page += 1;
  }
  return deduplicateArticles(collected).slice(0, maxArticles);
}

export async function normalizeWordPressPost(value: unknown): Promise<CollectedArticle> {
  const post = value as Record<string, unknown>;
  const embedded = (post._embedded ?? {}) as Record<string, unknown>;
  const terms = Array.isArray(embedded["wp:term"]) ? embedded["wp:term"] as unknown[][] : [];
  const termRecords = terms.flat().filter(Boolean).map((term) => term as Record<string, unknown>);
  const categories = termRecords.filter((term) => term.taxonomy === "category").map((term) => String(term.name ?? "")).filter(Boolean);
  const tags = termRecords.filter((term) => term.taxonomy === "post_tag").map((term) => String(term.name ?? "")).filter(Boolean);
  const authors = Array.isArray(embedded.author) ? embedded.author as Array<Record<string, unknown>> : [];
  const media = Array.isArray(embedded["wp:featuredmedia"]) ? embedded["wp:featuredmedia"] as Array<Record<string, unknown>> : [];
  const contentHtml = rendered(post.content);
  const excerpt = htmlToText(rendered(post.excerpt), 2_000);
  const title = htmlToText(rendered(post.title), 500);
  const url = normalizeExternalUrl(String(post.link ?? ""));
  const yoast = (post.yoast_head_json ?? {}) as Record<string, unknown>;
  const canonicalUrl = normalizeExternalUrl(String(yoast.canonical ?? url));
  const publishedAt = nullableString(post.date_gmt ?? post.date);
  const classification = classifyNews({ title, excerpt: `${excerpt} ${htmlToText(contentHtml, 5_000)}`, publishedAt: publishedAt ?? new Date().toISOString(), reliabilityScore: 95 });
  const contentText = htmlToText(contentHtml);
  return {
    externalId: String(post.id ?? canonicalUrl),
    title,
    url,
    canonicalUrl,
    slug: String(post.slug ?? new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? ""),
    excerpt,
    contentText,
    publishedAt,
    modifiedAt: nullableString(post.modified_gmt ?? post.modified),
    author: authors[0]?.name ? String(authors[0].name) : null,
    categories,
    tags,
    featuredImageUrl: nullableString(media[0]?.source_url ?? (Array.isArray(yoast.og_image) ? (yoast.og_image as Array<Record<string, unknown>>)[0]?.url : null)),
    status: String(post.status ?? "published") === "publish" ? "published" : String(post.status ?? "published"),
    metaDescription: nullableString(yoast.description) ?? (excerpt.slice(0, 170) || null),
    keywords: uniqueTerms([...tags, ...classification.topics]),
    icps: uniqueTerms([classification.primaryIcp, ...classification.secondaryIcps]),
    topics: uniqueTerms([...classification.topics, ...categories]),
    contentHash: await sha256(`${title}\n${excerpt}\n${contentText}`),
    method: "wordpress_rest",
  };
}

async function collectRss(url: string, fetchImpl?: typeof fetch, maxArticles = 500) {
  const result = await safeExternalFetch(url, {
    fetchImpl,
    timeoutMs: 12_000,
    maxBytes: 4_000_000,
    allowedContentTypes: /(xml|rss|atom|text)/i,
  });
  const items = parseFeed(result.text);
  const collected: CollectedArticle[] = [];
  for (const item of items.slice(0, maxArticles)) {
    const canonicalUrl = normalizeExternalUrl(item.originalUrl);
    const classification = classifyNews({ title: item.title, excerpt: `${item.excerpt} ${item.content.slice(0, 5_000)}`, publishedAt: item.publishedAt, reliabilityScore: 80 });
    collected.push({
      externalId: item.externalId || canonicalUrl,
      title: item.title,
      url: canonicalUrl,
      canonicalUrl,
      slug: new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? "",
      excerpt: item.excerpt,
      contentText: htmlToText(item.content || item.excerpt),
      publishedAt: item.publishedAt,
      modifiedAt: null,
      author: item.author || null,
      categories: [],
      tags: [],
      featuredImageUrl: null,
      status: "published",
      metaDescription: item.excerpt.slice(0, 170) || null,
      keywords: classification.topics,
      icps: uniqueTerms([classification.primaryIcp, ...classification.secondaryIcps]),
      topics: classification.topics,
      contentHash: await sha256(`${item.title}\n${item.excerpt}\n${item.content}`),
      method: "rss",
    });
  }
  return deduplicateArticles(collected);
}

async function collectSitemap(url: string, fetchImpl?: typeof fetch, maxArticles = 500) {
  const result = await safeExternalFetch(url, {
    fetchImpl,
    timeoutMs: 12_000,
    maxBytes: 4_000_000,
    allowedContentTypes: /(xml|text)/i,
  });
  const sitemap = parseSitemap(result.text);
  const entries = sitemap.entries;
  if (!entries.length && sitemap.childSitemaps.length) {
    const prioritized = sitemap.childSitemaps
      .filter((child) => /(post|blog|news|noticia|article)/i.test(child))
      .slice(0, 12);
    for (const child of prioritized) {
      const nested = await safeExternalFetch(child, { fetchImpl, timeoutMs: 12_000, maxBytes: 4_000_000, allowedContentTypes: /(xml|text)/i });
      entries.push(...parseSitemap(nested.text).entries);
      if (entries.length >= maxArticles) break;
    }
  }
  const collected: CollectedArticle[] = [];
  for (const entry of entries.slice(0, Math.min(maxArticles, 120))) {
    try {
      const page = await safeExternalFetch(entry.url, {
        fetchImpl,
        timeoutMs: 10_000,
        maxBytes: 2_000_000,
        allowedContentTypes: /(html|text)/i,
        accept: "text/html",
      });
      const metadata = extractHtmlMetadata(page.text, page.finalUrl);
      if (!metadata.title || metadata.text.length < 120) continue;
      const publishedAt = metadata.publishedAt ?? entry.lastModifiedAt;
      const classification = classifyNews({ title: metadata.title, excerpt: `${metadata.description} ${metadata.text.slice(0, 5_000)}`, publishedAt: publishedAt ?? new Date().toISOString(), reliabilityScore: 75 });
      collected.push({
        externalId: metadata.canonicalUrl,
        title: metadata.title,
        url: normalizeExternalUrl(page.finalUrl),
        canonicalUrl: metadata.canonicalUrl,
        slug: new URL(metadata.canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? "",
        excerpt: metadata.description || metadata.text.slice(0, 500),
        contentText: metadata.text,
        publishedAt,
        modifiedAt: metadata.modifiedAt,
        author: metadata.author,
        categories: [],
        tags: metadata.keywords,
        featuredImageUrl: metadata.image,
        status: "published",
        metaDescription: metadata.description || null,
        keywords: uniqueTerms([...metadata.keywords, ...classification.topics]),
        icps: uniqueTerms([classification.primaryIcp, ...classification.secondaryIcps]),
        topics: classification.topics,
        contentHash: await sha256(`${metadata.title}\n${metadata.description}\n${metadata.text}`),
        method: "sitemap",
      });
    } catch {
      // Uma página indisponível não invalida o restante do sitemap.
    }
  }
  return deduplicateArticles(collected);
}

async function normalizeSitemapPage(
  page: Awaited<ReturnType<typeof safeExternalFetch>>,
  lastModifiedAt: string | null,
): Promise<CollectedArticle | null> {
  const metadata = extractHtmlMetadata(page.text, page.finalUrl);
  if (!metadata.title || metadata.text.length < 120) return null;
  const publishedAt = metadata.publishedAt ?? lastModifiedAt;
  const classification = classifyNews({
    title: metadata.title,
    excerpt: `${metadata.description} ${metadata.text.slice(0, 5_000)}`,
    publishedAt: publishedAt ?? new Date().toISOString(),
    reliabilityScore: 75,
  });
  return {
    externalId: metadata.canonicalUrl,
    title: metadata.title,
    url: normalizeExternalUrl(page.finalUrl),
    canonicalUrl: metadata.canonicalUrl,
    slug: new URL(metadata.canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? "",
    excerpt: metadata.description || metadata.text.slice(0, 500),
    contentText: metadata.text,
    publishedAt,
    modifiedAt: metadata.modifiedAt,
    author: metadata.author,
    categories: [],
    tags: metadata.keywords,
    featuredImageUrl: metadata.image,
    status: "published",
    metaDescription: metadata.description || null,
    keywords: uniqueTerms([...metadata.keywords, ...classification.topics]),
    icps: uniqueTerms([classification.primaryIcp, ...classification.secondaryIcps]),
    topics: classification.topics,
    contentHash: await sha256(`${metadata.title}\n${metadata.description}\n${metadata.text}`),
    method: "sitemap",
  };
}

export async function persistSiteArticles(db: Database, siteId: number, articles: CollectedArticle[], collectedAt: string) {
  let inserted = 0;
  let updated = 0;
  let ignored = 0;
  for (const article of articles) {
    const existing = await db.prepare(`
      SELECT id, content_hash, modified_at, status
      FROM seo_articles
      WHERE site_id = ? AND (
        external_id = ? OR canonical_url = ? OR url = ? OR content_hash = ?
        OR (LOWER(title) = LOWER(?) AND published_at IS NOT DISTINCT FROM ?)
      )
      ORDER BY id LIMIT 1
    `).bind(
      siteId,
      article.externalId,
      article.canonicalUrl,
      article.url,
      article.contentHash,
      article.title,
      article.publishedAt,
    ).first<{ id: number; content_hash: string; modified_at: string | null; status: string }>();
    const changed = !existing || existing.content_hash !== article.contentHash || existing.modified_at !== article.modifiedAt || existing.status !== article.status;
    if (existing) {
      await db.prepare(`
        UPDATE seo_articles SET
          external_id = ?, title = ?, url = ?, canonical_url = ?, slug = ?, excerpt = ?, content_text = ?,
          published_at = ?, modified_at = ?, author = ?, categories = ?, tags = ?, featured_image_url = ?,
          status = ?, meta_description = ?, keywords = ?, icps = ?, topics = ?, collection_method = ?,
          content_hash = ?, last_collected_at = ?, unavailable_at = NULL
        WHERE id = ?
      `).bind(
        article.externalId, article.title, article.url, article.canonicalUrl, article.slug, article.excerpt,
        article.contentText, article.publishedAt, article.modifiedAt, article.author, JSON.stringify(article.categories),
        JSON.stringify(article.tags), article.featuredImageUrl, article.status, article.metaDescription,
        JSON.stringify(article.keywords), JSON.stringify(article.icps), JSON.stringify(article.topics), article.method,
        article.contentHash, collectedAt, existing.id,
      ).run();
    } else {
      await db.prepare(`
      INSERT INTO seo_articles (
        site_id, external_id, title, url, canonical_url, slug, excerpt, content_text, published_at, modified_at,
        author, categories, tags, featured_image_url, status, meta_description, keywords, icps, topics,
        collection_method, content_hash, first_collected_at, last_collected_at, unavailable_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).bind(
        siteId, article.externalId, article.title, article.url, article.canonicalUrl, article.slug, article.excerpt,
        article.contentText, article.publishedAt, article.modifiedAt, article.author, JSON.stringify(article.categories),
        JSON.stringify(article.tags), article.featuredImageUrl, article.status, article.metaDescription,
        JSON.stringify(article.keywords), JSON.stringify(article.icps), JSON.stringify(article.topics), article.method,
        article.contentHash, collectedAt, collectedAt,
      ).run();
    }
    if (!existing) inserted += 1;
    else if (changed) updated += 1;
    else ignored += 1;
  }
  return { inserted, updated, ignored };
}

export async function persistCompetitorArticles(db: Database, competitorId: number, articles: CollectedArticle[], collectedAt: string) {
  let inserted = 0;
  let updated = 0;
  let ignored = 0;
  for (const article of articles) {
    const existing = await db.prepare(`
      SELECT id, content_hash, modified_at, status
      FROM seo_competitor_articles
      WHERE competitor_id = ? AND (
        external_id = ? OR canonical_url = ? OR url = ? OR content_hash = ?
        OR (LOWER(title) = LOWER(?) AND published_at IS NOT DISTINCT FROM ?)
      )
      ORDER BY id LIMIT 1
    `).bind(
      competitorId,
      article.externalId,
      article.canonicalUrl,
      article.url,
      article.contentHash,
      article.title,
      article.publishedAt,
    ).first<{ id: number; content_hash: string; modified_at: string | null; status: string }>();
    const changed = !existing || existing.content_hash !== article.contentHash || existing.modified_at !== article.modifiedAt || existing.status !== article.status;
    if (existing) {
      await db.prepare(`
        UPDATE seo_competitor_articles SET
          source_id = ?, external_id = ?, title = ?, url = ?, canonical_url = ?, published_at = ?,
          modified_at = ?, excerpt = ?, content_text = ?, featured_image_url = ?, categories = ?, tags = ?,
          topics = ?, content_hash = ?, last_collected_at = ?, status = ?, collection_method = ?, unavailable_at = NULL
        WHERE id = ?
      `).bind(
        article.sourceId ?? null, article.externalId, article.title, article.url, article.canonicalUrl,
        article.publishedAt, article.modifiedAt, article.excerpt, article.contentText, article.featuredImageUrl,
        JSON.stringify(article.categories), JSON.stringify(article.tags), JSON.stringify(article.topics),
        article.contentHash, collectedAt, article.status, article.method, existing.id,
      ).run();
    } else {
      await db.prepare(`
      INSERT INTO seo_competitor_articles (
        competitor_id, source_id, external_id, title, url, canonical_url, published_at, modified_at,
        excerpt, content_text, featured_image_url, categories, tags, topics, content_hash,
        first_collected_at, last_collected_at, status, collection_method, unavailable_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).bind(
        competitorId, article.sourceId ?? null, article.externalId, article.title, article.url, article.canonicalUrl,
        article.publishedAt, article.modifiedAt, article.excerpt, article.contentText, article.featuredImageUrl,
        JSON.stringify(article.categories), JSON.stringify(article.tags), JSON.stringify(article.topics),
        article.contentHash, collectedAt, collectedAt, article.status, article.method,
      ).run();
    }
    if (!existing) inserted += 1;
    else if (changed) updated += 1;
    else ignored += 1;
  }
  return { inserted, updated, ignored };
}

export async function markUnavailableSiteArticles(db: Database, siteId: number, startedAt: string) {
  const result = await db.prepare("UPDATE seo_articles SET status = 'unavailable', unavailable_at = ? WHERE site_id = ? AND last_collected_at < ? AND status = 'published' RETURNING id")
    .bind(new Date().toISOString(), siteId, startedAt).run();
  return result.meta.changes;
}

export async function markUnavailableCompetitorArticles(db: Database, competitorId: number, startedAt: string) {
  const result = await db.prepare("UPDATE seo_competitor_articles SET status = 'unavailable', unavailable_at = ? WHERE competitor_id = ? AND last_collected_at < ? AND status = 'published' RETURNING id")
    .bind(new Date().toISOString(), competitorId, startedAt).run();
  return result.meta.changes;
}

async function createSyncRun(db: Database, scope: string, targetId: number, trigger: string, startedAt: string) {
  const result = await db.prepare("INSERT INTO seo_sync_runs (scope, target_id, trigger, status, started_at, metadata) VALUES (?, ?, ?, 'running', ?, '{}') RETURNING id")
    .bind(scope, targetId, trigger, startedAt).run();
  const id = Number(result.meta.last_row_id);
  if (!id) throw new Error("Não foi possível registrar a sincronização.");
  return id;
}

function finishSyncRun(db: Database, runId: number, status: string, result: SeoSyncResult | null, error: string | null, finishedAt: string) {
  return db.prepare(`
    UPDATE seo_sync_runs SET status = ?, method = ?, finished_at = ?, duration_ms = ?, found = ?,
      inserted = ?, updated = ?, ignored = ?, unavailable = ?, errors = ?, error_message = ?, metadata = ?
    WHERE id = ?
  `).bind(
    status,
    result?.method ?? null,
    finishedAt,
    result?.durationMs ?? null,
    result?.found ?? 0,
    result?.inserted ?? 0,
    result?.updated ?? 0,
    result?.ignored ?? 0,
    result?.unavailable ?? 0,
    error ? 1 : 0,
    error?.slice(0, 800) ?? null,
    JSON.stringify(result ?? {}),
    runId,
  );
}

export async function markSourceSuccess(db: Database, table: "seo_site_sources" | "seo_competitor_sources", sourceId: number) {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE ${table} SET status = CASE WHEN status = 'fallback' THEN 'fallback' ELSE 'active' END, last_verified_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
    .bind(now, now, sourceId).run();
}

export async function markSourceFailure(db: Database, table: "seo_site_sources" | "seo_competitor_sources", sourceId: number, error: string) {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE ${table} SET last_verified_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .bind(now, error.slice(0, 800), now, sourceId).run();
}

async function probeSource(sourceType: "wordpress_rest" | "sitemap" | "rss", url: string, fetchImpl?: typeof fetch): Promise<DiscoveredSeoSource> {
  if (sourceType === "wordpress_rest") {
    const candidate = new URL(normalizeSiteUrl(url));
    candidate.searchParams.set("status", "publish");
    candidate.searchParams.set("per_page", "1");
    const result = await safeExternalFetch(candidate.toString(), { fetchImpl, timeoutMs: 7_000, maxBytes: 500_000, allowedContentTypes: /json/i, accept: "application/json" });
    const payload = JSON.parse(result.text) as unknown;
    return { sourceType, url: stripQuery(url), valid: Array.isArray(payload), itemCount: Array.isArray(payload) ? Number(result.response.headers.get("x-wp-total") ?? payload.length) : 0, detail: "WordPress REST API" };
  }
  if (sourceType === "rss") {
    const result = await safeExternalFetch(url, { fetchImpl, timeoutMs: 7_000, maxBytes: 1_000_000, allowedContentTypes: /(xml|rss|atom|text)/i });
    const items = parseFeed(result.text);
    return { sourceType, url: result.finalUrl, valid: items.length > 0, itemCount: items.length, detail: items.length ? "Feed RSS/Atom válido" : "Feed vazio" };
  }
  const result = await safeExternalFetch(url, { fetchImpl, timeoutMs: 7_000, maxBytes: 1_000_000, allowedContentTypes: /(xml|text)/i });
  const parsed = parseSitemap(result.text);
  const count = parsed.entries.length + parsed.childSitemaps.length;
  return { sourceType, url: result.finalUrl, valid: count > 0, itemCount: count, detail: parsed.childSitemaps.length ? "Índice de sitemaps" : "Sitemap de conteúdo" };
}

function uniqueCandidates(values: Array<{ sourceType: "wordpress_rest" | "sitemap" | "rss"; url: string } | null>) {
  const seen = new Set<string>();
  return values.filter((item): item is NonNullable<typeof item> => {
    if (!item) return false;
    try {
      item.url = normalizeSiteUrl(item.url);
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    } catch {
      return false;
    }
  });
}

function inferSourceType(url: string): "wordpress_rest" | "sitemap" | "rss" {
  if (/wp-json\/wp\/v2\/posts/i.test(url)) return "wordpress_rest";
  if (/sitemap/i.test(url)) return "sitemap";
  return "rss";
}

function sourcePriority(type: SeoSourceRow["source_type"]) {
  return type === "wordpress_rest" ? 100 : type === "sitemap" ? 80 : type === "rss" ? 60 : 20;
}

function rendered(value: unknown) {
  if (value && typeof value === "object" && "rendered" in value) return String((value as { rendered?: unknown }).rendered ?? "");
  return String(value ?? "");
}

function nullableString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function uniqueTerms(values: string[]) {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 30);
}

export function deduplicateArticles(articles: CollectedArticle[]) {
  const seen = new Set<string>();
  return articles.filter((article) => {
    if (!article.title || !article.url) return false;
    const keys = [
      `canonical:${canonicalizeUrl(article.canonicalUrl || article.url)}`,
      `url:${canonicalizeUrl(article.url)}`,
      `external:${article.externalId}`,
      `hash:${article.contentHash}`,
      `title-date:${article.title.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim()}::${article.publishedAt ?? ""}`,
    ];
    if (keys.some((key) => seen.has(key))) return false;
    for (const key of keys) seen.add(key);
    return true;
  });
}

function stripQuery(value: string) {
  const url = new URL(normalizeSiteUrl(value));
  url.search = "";
  return url.toString();
}

export function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na sincronização.")
    .replace(/(key|token|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
