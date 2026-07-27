import { rowsOf, type Database } from "../db/runtime.ts";
import { buildEditorialIntelligence, type EditorialDecision, type IntelligenceNews } from "./editorial-intelligence.ts";
import { loadIntelligenceNews } from "./intelligence-news.ts";

export type CompetitorEditorialReference = {
  id: number;
  competitorId: number;
  competitorName: string;
  competitorDomain: string;
  title: string;
  url: string;
  excerpt: string;
  content: string;
  topics: string[];
  categories: string[];
  tags: string[];
  publishedAt: string | null;
};

export type CompetitiveSupport = {
  reference: CompetitorEditorialReference;
  primaryDecision: EditorialDecision;
  supportingDecisions: EditorialDecision[];
  matchedTerms: string[];
};

type CompetitorArticleRow = {
  id: number;
  competitor_id: number;
  competitor_name: string;
  competitor_domain: string;
  title: string;
  url: string;
  excerpt: string;
  content_text: string;
  topics: string;
  categories: string;
  tags: string;
  published_at: string | null;
};

type RankedNews = {
  news: IntelligenceNews;
  score: number;
  matchedTerms: string[];
};

const STOPWORDS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "entre", "é", "na", "nas",
  "no", "nos", "o", "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "que", "se", "sem", "sobre", "um",
  "uma", "the", "and", "for", "from", "with",
]);

export async function prepareCompetitiveEditorialSupport(
  db: Database,
  articleId: number,
  preferredNewsId?: number,
): Promise<CompetitiveSupport> {
  const article = await loadCompetitorArticle(db, articleId);
  if (!article) throw new Error("Artigo concorrente não encontrado ou indisponível.");
  if (!article.title.trim() || (!article.excerpt.trim() && !article.content.trim())) {
    throw new Error("O artigo concorrente não possui conteúdo suficiente para originar uma pauta.");
  }

  const news = await loadIntelligenceNews(db);
  const candidates = rankSupportingNews(article, news);
  const preferred = preferredNewsId ? candidates.find((item) => item.news.id === preferredNewsId) : null;
  const ranked = [
    ...(preferred ? [preferred] : []),
    ...candidates.filter((item) => item.news.id !== preferred?.news.id),
  ].slice(0, 3);
  if (!ranked.length) {
    throw new CompetitorEditorialSupportError(
      "Nenhuma fonte independente relacionada foi encontrada no Monitoramento. Sincronize fontes do tema antes de gerar o Kit.",
    );
  }

  const decisions = ranked
    .map((item) => buildEditorialIntelligence([item.news]).newsOfTheDay)
    .filter((decision): decision is EditorialDecision => Boolean(decision?.produceContent));
  if (!decisions.length) {
    throw new CompetitorEditorialSupportError(
      "As notícias relacionadas ainda não possuem conteúdo e fonte válidos para sustentar um Kit original.",
    );
  }

  return {
    reference: article,
    primaryDecision: decisions[0],
    supportingDecisions: decisions.slice(1),
    matchedTerms: ranked[0].matchedTerms,
  };
}

export function competitorArticleIdFromOrigin(origin: string | null | undefined) {
  const match = /^seo_competitor_article:(\d+)$/.exec(origin ?? "");
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function rankSupportingNews(reference: CompetitorEditorialReference, news: IntelligenceNews[]): RankedNews[] {
  const titleTerms = terms(reference.title);
  const topicTerms = new Set([
    ...reference.topics.flatMap(terms),
    ...reference.categories.flatMap(terms),
    ...reference.tags.flatMap(terms),
  ]);
  const contextTerms = new Set([...titleTerms, ...topicTerms, ...terms(`${reference.excerpt} ${reference.content.slice(0, 3_000)}`)]);
  const competitorHost = hostname(reference.competitorDomain || reference.url);

  return news.flatMap((item) => {
    if (item.status === "discarded" || item.status === "archived") return [];
    if (!item.title.trim() || (!item.excerpt.trim() && !item.content.trim())) return [];
    if (competitorHost && hostname(item.originalUrl) === competitorHost) return [];

    const newsTitle = new Set(terms(item.title));
    const newsTopics = new Set(item.topics.flatMap(terms));
    const newsContext = new Set([...newsTitle, ...newsTopics, ...terms(`${item.excerpt} ${item.content.slice(0, 2_000)}`)]);
    const titleMatches = intersection(titleTerms, newsTitle);
    const topicMatches = intersection(topicTerms, newsTopics);
    const contextMatches = intersection(contextTerms, newsContext);
    if (!topicMatches.length && titleMatches.length < 2 && contextMatches.length < 3) return [];

    const ageDays = Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 86_400_000);
    const recency = Number.isFinite(ageDays) ? Math.max(0, 12 - Math.min(12, ageDays / 30)) : 0;
    const score = topicMatches.length * 12 + titleMatches.length * 7 + Math.min(12, contextMatches.length * 2)
      + item.relevanceScore * .18 + recency;
    if (score < 18) return [];
    return [{ news: item, score, matchedTerms: unique([...topicMatches, ...titleMatches, ...contextMatches]).slice(0, 12) }];
  }).sort((left, right) => right.score - left.score
    || right.news.relevanceScore - left.news.relevanceScore
    || Date.parse(right.news.publishedAt) - Date.parse(left.news.publishedAt)
    || left.news.id - right.news.id);
}

export class CompetitorEditorialSupportError extends Error {
  readonly code = "independent_source_required";
  constructor(message: string) {
    super(message);
    this.name = "CompetitorEditorialSupportError";
  }
}

async function loadCompetitorArticle(db: Database, articleId: number) {
  const result = await db.prepare(`
    SELECT a.id, a.competitor_id, c.name AS competitor_name, c.domain AS competitor_domain,
      a.title, a.url, a.excerpt, a.content_text, a.topics, a.categories, a.tags, a.published_at
    FROM seo_competitor_articles a
    JOIN seo_competitors c ON c.id = a.competitor_id
    WHERE a.id = ? AND a.status = 'published' AND c.archived_at IS NULL
    LIMIT 1
  `).bind(articleId).all<CompetitorArticleRow>();
  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    id: row.id,
    competitorId: row.competitor_id,
    competitorName: row.competitor_name,
    competitorDomain: row.competitor_domain,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    content: row.content_text,
    topics: parseArray(row.topics),
    categories: parseArray(row.categories),
    tags: parseArray(row.tags),
    publishedAt: row.published_at,
  } satisfies CompetitorEditorialReference;
}

function terms(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

function intersection(left: Iterable<string>, right: Set<string>) {
  return unique([...left].filter((term) => right.has(term)));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function hostname(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, "").toLocaleLowerCase("pt-BR"); } catch { return ""; }
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
