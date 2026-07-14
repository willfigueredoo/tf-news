import { aiConfigured, runStructuredAi, type AiConfig } from "./ai.ts";
import { appendTraceableSources, sanitizeWordPressHtml, validateArticleHtml } from "./article-html.ts";
import { articlePayloadSchema, briefPayloadSchema, coherenceSchema, type ArticlePayload, type BriefPayload, type CoherencePayload } from "./operational-schemas.ts";

export type EditorialNews = {
  id: number;
  title: string;
  sourceName: string;
  originalUrl: string;
  publishedAt: string;
  excerpt: string;
  content: string;
  region: string;
  logisticsImpact: string;
  topics: string[];
  icps: string[];
  primaryIcp: string;
};

export async function evaluateCoherence(db: D1Database, config: AiConfig, news: EditorialNews[]): Promise<CoherencePayload> {
  const deterministic = deterministicCoherence(news);
  if (news.length <= 1 || !aiConfigured(config)) return deterministic;
  try {
    const response = await runStructuredAi({
      db, config, operation: "coherence", schemaName: "tf_news_coherence", schema: coherenceSchema,
      system: "Atue como editor-chefe. Determine se as notícias podem sustentar um único conteúdo sem misturar eventos desconectados. Notícias do mesmo setor não são automaticamente o mesmo evento. Retorne JSON estrito.",
      user: JSON.stringify({ news: news.map(compactNews), deterministicSignal: deterministic }),
      maxOutputTokens: 1400,
    });
    const validIds = new Set(news.map((item) => item.id));
    const groupsAreValid = response.data.suggestedGroups.every((group) => group.newsIds.every((id) => validIds.has(id)));
    return groupsAreValid ? response.data : deterministic;
  } catch {
    return deterministic;
  }
}

export async function generateBriefWithAi(db: D1Database, config: AiConfig, input: { news: EditorialNews[]; coherence: CoherencePayload; requestedIcp: string; objective: string; primaryKeyword: string; tone: string }): Promise<BriefPayload> {
  if (!aiConfigured(config)) throw new Error("Configure AI_PROVIDER, AI_API_KEY e AI_MODEL antes de gerar o briefing.");
  const response = await runStructuredAi({
    db, config, operation: "brief", schemaName: "tf_news_editorial_brief", schema: briefPayloadSchema,
    system: `Você é editor sênior de jornalismo B2B brasileiro. Crie um briefing factual e acionável. Use somente fatos presentes nas fontes. Diferencie fato, análise e hipótese. Não invente números, declarações ou relações causais. Retorne JSON estrito.`,
    user: JSON.stringify({ requestedIcp: input.requestedIcp, objective: input.objective, primaryKeyword: input.primaryKeyword, tone: input.tone, coherence: input.coherence, sources: input.news.map(compactNews) }),
    maxOutputTokens: 3200,
  });
  const allowedUrls = new Set(input.news.map((item) => item.originalUrl));
  const facts = response.data.confirmedFacts.filter((fact) => allowedUrls.has(fact.sourceUrl));
  if (!facts.length) throw new Error("A IA não vinculou os fatos às fontes selecionadas.");
  return briefPayloadSchema.parse({ ...response.data, confirmedFacts: facts, primaryKeyword: input.primaryKeyword || response.data.primaryKeyword });
}

export async function generateArticleWithAi(db: D1Database, config: AiConfig, input: { brief: BriefPayload; news: EditorialNews[]; objective: string; tone: string }): Promise<ArticlePayload> {
  if (!aiConfigured(config)) throw new Error("Configure AI_PROVIDER, AI_API_KEY e AI_MODEL antes de gerar o artigo.");
  const response = await runStructuredAi({
    db, config, operation: "article", schemaName: "tf_news_wordpress_article", schema: articlePayloadSchema,
    system: `Você é jornalista B2B. Escreva um artigo original em português do Brasil, entre 800 e 1.400 palavras, em HTML sem Markdown. Use <p>, <h2>, <h3>, <ul>/<ol>, <li>, <strong>, <em>, <blockquote> e <a>. Separe explicitamente fatos confirmados, análise editorial e hipóteses. Cite as fontes com links. Não copie trechos longos. Não use os termos internos "Todos os ICPs", "score classificado", "impacto moderado" ou "ICP selecionado". Não invente fatos, números ou falas. Retorne JSON estrito.`,
    user: JSON.stringify({ objective: input.objective, tone: input.tone, brief: input.brief, sourceMaterial: input.news.map(compactNews) }),
    maxOutputTokens: 6500,
  });
  let contentHtml = sanitizeWordPressHtml(response.data.contentHtml);
  contentHtml = appendTraceableSources(contentHtml, input.news);
  validateArticleHtml(contentHtml);
  return articlePayloadSchema.parse({ ...response.data, contentHtml });
}

export function deterministicCoherence(news: EditorialNews[]): CoherencePayload {
  if (news.length <= 1) return { coherent: true, confidence: 1, explanation: "Uma única notícia forma um conteúdo editorial independente.", sharedEventOrTheme: news[0]?.topics[0] || news[0]?.primaryIcp || "Tema único", suggestedGroups: news.length ? [{ label: news[0].topics[0] || news[0].primaryIcp, newsIds: [news[0].id] }] : [] };
  const adjacency = new Map<number, Set<number>>(news.map((item) => [item.id, new Set([item.id])]));
  for (let index = 0; index < news.length; index += 1) {
    for (let other = index + 1; other < news.length; other += 1) {
      if (related(news[index], news[other])) {
        adjacency.get(news[index].id)?.add(news[other].id);
        adjacency.get(news[other].id)?.add(news[index].id);
      }
    }
  }
  const unvisited = new Set(news.map((item) => item.id));
  const groups: number[][] = [];
  while (unvisited.size) {
    const first = unvisited.values().next().value as number;
    const queue = [first]; const group: number[] = []; unvisited.delete(first);
    while (queue.length) {
      const current = queue.shift() as number; group.push(current);
      for (const neighbor of adjacency.get(current) ?? []) if (unvisited.delete(neighbor)) queue.push(neighbor);
    }
    groups.push(group);
  }
  const sharedTopics = intersection(news.map((item) => new Set(item.topics.map(normalize))));
  const coherent = groups.length === 1;
  return {
    coherent,
    confidence: coherent ? Math.min(.95, .65 + sharedTopics.length * .1) : .85,
    explanation: coherent ? "As notícias compartilham tema, evento ou cadeia setorial suficiente para um único conteúdo." : "As notícias formam grupos temáticos distintos; o agrupamento pode produzir relações artificiais.",
    sharedEventOrTheme: sharedTopics[0] || (coherent ? news[0].primaryIcp : "Eventos ou temas distintos"),
    suggestedGroups: groups.map((ids, index) => ({ label: groupLabel(ids, news, index), newsIds: ids })),
  };
}

function related(a: EditorialNews, b: EditorialNews) {
  const aTopics = new Set(a.topics.map(normalize));
  const sharedTopic = b.topics.some((topic) => aTopics.has(normalize(topic)));
  const sharedIcp = a.primaryIcp === b.primaryIcp || a.icps.some((icp) => b.icps.includes(icp));
  const aTokens = tokens(`${a.title} ${a.excerpt}`); const bTokens = tokens(`${b.title} ${b.excerpt}`);
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length / Math.max(1, Math.min(aTokens.size, bTokens.size));
  return sharedTopic || (sharedIcp && overlap >= .18) || overlap >= .3;
}

function compactNews(item: EditorialNews) { return { id: item.id, title: item.title, sourceName: item.sourceName, originalUrl: item.originalUrl, publishedAt: item.publishedAt, summary: item.excerpt, content: item.content.slice(0, 7000), region: item.region, topics: item.topics, icps: item.icps, primaryIcp: item.primaryIcp, logisticsImpact: item.logisticsImpact }; }
function tokens(value: string) { return new Set(normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 5)); }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function intersection(sets: Set<string>[]) { return sets.length ? [...sets[0]].filter((value) => sets.every((set) => set.has(value))) : []; }
function groupLabel(ids: number[], news: EditorialNews[], index: number) { const items = news.filter((item) => ids.includes(item.id)); return items.flatMap((item) => item.topics)[0] || items[0]?.primaryIcp || `Conteúdo ${index + 1}`; }
