import type { Database } from "../db/runtime.ts";
import { buildEditorialIntelligence, type EditorialDecision } from "./editorial-intelligence.ts";
import { createEditorialKit } from "./editorial-kit.ts";
import { loadIntelligenceNews } from "./intelligence-news.ts";
import { getAiConfig } from "./runtime-config.ts";
import type { CompetitorEditorialReference } from "./competitor-editorial.ts";

type OpportunityRow = {
  id: number;
  suggested_title: string;
  category: string;
  rationale: string;
  strategic_score: number;
  primary_keyword: string;
  search_intent: string;
  related_icps: string;
  status: string;
  generated_kit_id: number | null;
};

type SourceRow = {
  source_type: string;
  news_item_id: number | null;
  competitor_article_id: number | null;
  seo_article_id: number | null;
  relevance_score: number;
  article_title: string | null;
  article_url: string | null;
  competitor_id: number | null;
  competitor_name: string | null;
  competitor_domain: string | null;
  competitor_excerpt: string | null;
  competitor_content: string | null;
  competitor_topics: string | null;
  competitor_categories: string | null;
  competitor_tags: string | null;
  competitor_published_at: string | null;
};

export class ContentOpportunityConflictError extends Error {
  readonly code: "existing_kit" | "generation_in_progress" | "active_queue";
  readonly opportunityId: number;
  readonly kitId: number | null;

  constructor(code: ContentOpportunityConflictError["code"], opportunityId: number, kitId: number | null, message: string) {
    super(message);
    this.name = "ContentOpportunityConflictError";
    this.code = code;
    this.opportunityId = opportunityId;
    this.kitId = kitId;
  }
}

export async function generateKitForContentOpportunity(
  db: Database,
  opportunityId: number,
  options: {
    createKit?: typeof createEditorialKit;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const opportunity = await db.prepare(`
    SELECT id, suggested_title, category, rationale, strategic_score, primary_keyword,
      search_intent, related_icps, status, generated_kit_id
    FROM content_opportunities WHERE id = ?
  `).bind(opportunityId).first<OpportunityRow>();
  if (!opportunity) throw new Error("Oportunidade de conteúdo não encontrada.");
  if (opportunity.generated_kit_id) {
    throw new ContentOpportunityConflictError(
      "existing_kit",
      opportunity.id,
      opportunity.generated_kit_id,
      "Esta oportunidade já possui um Kit Editorial.",
    );
  }
  if (opportunity.status === "generating") {
    throw new ContentOpportunityConflictError(
      "generation_in_progress",
      opportunity.id,
      null,
      "A geração desta oportunidade já está em andamento.",
    );
  }

  const sources = await db.prepare(`
    SELECT source.source_type, source.news_item_id, source.competitor_article_id, source.seo_article_id,
      source.relevance_score, site_article.title AS article_title, site_article.url AS article_url,
      competitor_article.competitor_id, competitor.name AS competitor_name, competitor.domain AS competitor_domain,
      competitor_article.title AS competitor_title, competitor_article.url AS competitor_url,
      competitor_article.excerpt AS competitor_excerpt, competitor_article.content_text AS competitor_content,
      competitor_article.topics AS competitor_topics, competitor_article.categories AS competitor_categories,
      competitor_article.tags AS competitor_tags, competitor_article.published_at AS competitor_published_at
    FROM content_opportunity_sources source
    LEFT JOIN seo_articles site_article ON site_article.id = source.seo_article_id
    LEFT JOIN seo_competitor_articles competitor_article ON competitor_article.id = source.competitor_article_id
    LEFT JOIN seo_competitors competitor ON competitor.id = competitor_article.competitor_id
    WHERE source.opportunity_id = ?
    ORDER BY source.relevance_score DESC, source.id
  `).bind(opportunityId).all<SourceRow & { competitor_title?: string; competitor_url?: string }>();
  const newsIds = sources.results
    .map((source) => source.news_item_id)
    .filter((id): id is number => Boolean(id));
  if (!newsIds.length) {
    throw new Error("A oportunidade ainda não possui uma notícia rastreável para sustentar o Kit.");
  }

  const allNews = await loadIntelligenceNews(db);
  const decisions = newsIds
    .map((id) => allNews.find((news) => news.id === id))
    .filter((news): news is NonNullable<typeof news> => Boolean(news))
    .map((news) => buildEditorialIntelligence([news]).newsOfTheDay)
    .filter((decision): decision is EditorialDecision => Boolean(decision?.produceContent));
  if (!decisions.length) {
    throw new Error("As fontes relacionadas ainda não possuem conteúdo suficiente para gerar o Kit.");
  }
  const primaryDecision = decisions[0];
  const activeQueue = await db.prepare(`
    SELECT id FROM editorial_queue
    WHERE news_item_id = ? AND archived_at IS NULL
      AND status IN ('new', 'analysis', 'approved', 'generating')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).bind(primaryDecision.id).first<{ id: number }>();
  if (activeQueue) {
    throw new ContentOpportunityConflictError(
      "active_queue",
      opportunity.id,
      null,
      "A notícia principal desta oportunidade já possui uma pauta ativa.",
    );
  }

  const now = new Date().toISOString();
  const claimed = await db.prepare(`
    UPDATE content_opportunities
    SET status = 'generating', last_error = NULL, updated_at = ?
    WHERE id = ? AND generated_kit_id IS NULL
      AND status IN ('opportunity', 'postponed', 'failed')
    RETURNING id
  `).bind(now, opportunityId).first<{ id: number }>();
  if (!claimed) {
    throw new ContentOpportunityConflictError(
      "generation_in_progress",
      opportunity.id,
      null,
      "A oportunidade não está disponível para uma nova geração.",
    );
  }

  const queue = await db.prepare(`
    INSERT INTO editorial_queue (
      news_item_id, title, status, origin, version, started_at, created_at, updated_at
    )
    SELECT n.id, ?, 'generating', ?, COALESCE(MAX(queue.version), 0) + 1, ?, ?, ?
    FROM news_items n
    LEFT JOIN editorial_queue queue ON queue.news_item_id = n.id
    WHERE n.id = ?
    GROUP BY n.id
    RETURNING id
  `).bind(
    opportunity.suggested_title,
    `content_opportunity:${opportunityId}`,
    now,
    now,
    now,
    primaryDecision.id,
  ).first<{ id: number }>();
  if (!queue) {
    await returnOpportunityToFailed(db, opportunityId, "Não foi possível criar a pauta editorial.", now);
    throw new Error("Não foi possível criar a pauta editorial da oportunidade.");
  }

  const competitiveReference = firstCompetitorReference(sources.results);
  const relatedIcps = parseStringArray(opportunity.related_icps);
  const internalLinks = sources.results
    .filter((source) => source.source_type === "site_article" && source.article_title && source.article_url)
    .map((source) => ({ title: source.article_title as string, url: source.article_url as string }))
    .slice(0, 6);

  try {
    const kit = await (options.createKit ?? createEditorialKit)(
      db,
      getAiConfig(),
      primaryDecision,
      {
        queueId: queue.id,
        fetchImpl: options.fetchImpl,
        supportingDecisions: decisions.slice(1, 4),
        competitiveReference,
        evergreenContext: {
          opportunityId,
          suggestedTitle: opportunity.suggested_title,
          category: opportunity.category,
          primaryKeyword: opportunity.primary_keyword,
          searchIntent: opportunity.search_intent,
          rationale: opportunity.rationale,
          relatedIcps,
          internalLinks,
        },
      },
    );
    return { kit, opportunityId, queueId: queue.id };
  } catch (error) {
    const message = safeError(error);
    const failedAt = new Date().toISOString();
    await db.batch([
      db.prepare(`
        UPDATE content_opportunities
        SET status = 'failed', last_error = ?, updated_at = ?
        WHERE id = ? AND generated_kit_id IS NULL
      `).bind(message, failedAt, opportunityId),
      db.prepare(`
        UPDATE editorial_queue
        SET status = 'analysis', last_error = ?, updated_at = ?
        WHERE id = ? AND editorial_kit_id IS NULL
      `).bind(message, failedAt, queue.id),
    ]);
    throw error;
  }
}

function firstCompetitorReference(
  sources: Array<SourceRow & { competitor_title?: string; competitor_url?: string }>,
): CompetitorEditorialReference | undefined {
  const source = sources.find((item) => item.competitor_article_id && item.competitor_name);
  if (!source?.competitor_article_id || !source.competitor_id || !source.competitor_name || !source.competitor_domain) return undefined;
  return {
    id: source.competitor_article_id,
    competitorId: source.competitor_id,
    competitorName: source.competitor_name,
    competitorDomain: source.competitor_domain,
    title: source.competitor_title ?? "Referência editorial concorrente",
    url: source.competitor_url ?? source.competitor_domain,
    excerpt: source.competitor_excerpt ?? "",
    content: source.competitor_content ?? "",
    topics: parseStringArray(source.competitor_topics ?? "[]"),
    categories: parseStringArray(source.competitor_categories ?? "[]"),
    tags: parseStringArray(source.competitor_tags ?? "[]"),
    publishedAt: source.competitor_published_at,
  };
}

async function returnOpportunityToFailed(db: Database, opportunityId: number, message: string, now: string) {
  await db.prepare(`
    UPDATE content_opportunities
    SET status = 'failed', last_error = ?, updated_at = ?
    WHERE id = ? AND generated_kit_id IS NULL
  `).bind(message, now, opportunityId).run();
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na geração evergreen.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
