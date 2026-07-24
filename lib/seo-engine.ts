import type { Database } from "../db/runtime.ts";
import { aiConfigured, runStructuredAi, type AiConfig } from "./ai.ts";
import { sha256 } from "./editorial.ts";
import {
  seoAuthorityAnalysisSchema,
  seoCompetitorAnalysisSchema,
  seoOpportunityRankingSchema,
  type SeoAuthorityAnalysis,
  type SeoCompetitorAnalysis,
} from "./seo-schemas.ts";

type SeoArticleRow = {
  id: number;
  title: string;
  url: string;
  excerpt: string;
  content_text: string;
  published_at: string | null;
  modified_at: string | null;
  categories: string;
  tags: string;
  topics: string;
  icps: string;
};

type CompetitorArticleRow = {
  id: number;
  competitor_id: number;
  competitor_name: string;
  title: string;
  url: string;
  excerpt: string;
  content_text: string;
  published_at: string | null;
  topics: string;
  categories: string;
  tags: string;
};

type NewsRow = {
  id: number;
  title: string;
  excerpt: string;
  published_at: string;
  topics: string;
  primary_icp: string;
  relevance_score: number;
};

type ExistingAnalysisRow = {
  id: number;
  payload: string;
  confidence: number | null;
  valid_until: string | null;
  input_hash: string;
  provider: string;
  model: string;
  created_at: string;
};

export type SeoEngineMetrics = {
  articleCount: number;
  articlesLast30Days: number;
  articlesLast90Days: number;
  publishingFrequencyPerWeek: number;
  regularityScore: number;
  recencyScore: number;
  updatedArticleRatio: number;
  analyzableArticleRatio: number;
  topicDiversity: number;
  dominantTopic: string | null;
  dominantTopicShare: number;
  clusterCount: number;
  monitoredTopicCoverage: number;
  competitorGapCount: number;
  reactionSpeedScore: number;
};

export type SeoAuthorityCalculation = {
  score: number;
  previousScore: number | null;
  confidence: number;
  engineScore: number;
  geminiScore: number | null;
  googleStatus: "not_connected";
  contributions: Array<{
    id: "google-signals" | "gemini-ai" | "tf-news-engine";
    label: string;
    status: "available" | "not_connected" | "pending";
    score: number | null;
    configuredWeight: number;
    effectiveWeight: number;
    description: string;
  }>;
  metrics: SeoEngineMetrics;
  positiveFactors: string[];
  negativeFactors: string[];
  calculatedAt: string;
};

type OpportunityCandidate = {
  candidateKey: string;
  title: string;
  topic: string;
  icp: string;
  priority: "high" | "medium" | "low";
  seoPotential: "very_high" | "high" | "moderate";
  confidence: number;
  reasons: string[];
  signalOrigins: string[];
  competitorIds: number[];
  newsIds: number[];
  siteArticleIds: number[];
  suggestedAngle: string | null;
};

export async function refreshSeoIntelligence(
  db: Database,
  config: AiConfig,
  options: { withAi?: boolean; forceAi?: boolean } = {},
) {
  const site = await db.prepare("SELECT id, name, domain, last_sync_at FROM seo_sites ORDER BY id LIMIT 1").first<{ id: number; name: string; domain: string; last_sync_at: string | null }>();
  if (!site) throw new Error("Configure o site principal para calcular a Inteligência SEO.");
  const dataset = await loadDataset(db, site.id);
  const metrics = calculateMetrics(dataset.siteArticles, dataset.competitorArticles, dataset.news);
  let candidates = await generateOpportunityCandidates(db, site.id, dataset);
  let authorityAnalysis = await loadLatestAuthorityAnalysis(db, site.id);
  let rankingAnalysisId: number | null = null;
  const shouldUseAi = Boolean(options.withAi && aiConfigured(config) && dataset.siteArticles.length);

  if (shouldUseAi) {
    const authorityInput = authorityAiInput(site, metrics, dataset, candidates);
    const authorityInputHash = await sha256(JSON.stringify(authorityInput));
    const rankingInput = opportunityRankingInput(candidates);
    const rankingInputHash = await sha256(JSON.stringify(rankingInput));
    const [authorityResult, rankingResult] = await Promise.allSettled([
      analyzeAuthority(db, config, site.id, authorityInputHash, authorityInput, Boolean(options.forceAi)),
      candidates.length
        ? rankOpportunities(db, config, site.id, rankingInputHash, rankingInput, Boolean(options.forceAi))
        : Promise.resolve(null),
    ]);
    if (authorityResult.status === "fulfilled" && authorityResult.value) authorityAnalysis = authorityResult.value.analysis;
    if (rankingResult.status === "fulfilled" && rankingResult.value) {
      rankingAnalysisId = rankingResult.value.analysisId;
      candidates = mergeOpportunityRanking(candidates, rankingResult.value.ranking.items);
    }
  }

  const savedOpportunities = await persistOpportunities(db, site.id, candidates, rankingAnalysisId);
  const authority = await calculateAndSaveAuthority(db, site.id, metrics, authorityAnalysis);
  return {
    siteId: site.id,
    authority,
    authorityAnalysis,
    opportunities: savedOpportunities,
    aiConfigured: aiConfigured(config),
    aiUsed: shouldUseAi,
  };
}

export async function analyzeSeoCompetitor(db: Database, config: AiConfig, competitorId: number, force = false) {
  if (!aiConfigured(config)) throw new Error("O Gemini ainda não está configurado.");
  const competitor = await db.prepare("SELECT id, name, domain, last_sync_at FROM seo_competitors WHERE id = ? AND archived_at IS NULL").bind(competitorId).first<{ id: number; name: string; domain: string; last_sync_at: string | null }>();
  if (!competitor) throw new Error("Concorrente não encontrado.");
  const rows = await db.prepare("SELECT id, title, url, excerpt, content_text, published_at, topics, categories, tags FROM seo_competitor_articles WHERE competitor_id = ? AND status = 'published' ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 80")
    .bind(competitorId).all<Omit<CompetitorArticleRow, "competitor_id" | "competitor_name">>();
  if (!rows.results.length) throw new Error("Sincronize artigos do concorrente antes de solicitar a análise.");
  const siteTopicsResult = await db.prepare("SELECT topics FROM seo_articles WHERE status = 'published' ORDER BY published_at DESC NULLS LAST LIMIT 300").all<{ topics: string }>();
  const input = {
    competitor: { id: competitor.id, name: competitor.name, domain: competitor.domain, lastSyncAt: competitor.last_sync_at },
    articles: rows.results.map((article) => ({
      id: article.id,
      title: article.title,
      url: article.url,
      excerpt: article.excerpt.slice(0, 1_000),
      publishedAt: article.published_at,
      topics: parseList(article.topics),
      categories: parseList(article.categories),
      tags: parseList(article.tags),
    })),
    transfastTopics: topTerms(siteTopicsResult.results.flatMap((row) => parseList(row.topics)), 30),
  };
  const inputHash = await sha256(JSON.stringify(input));
  const cached = await loadCachedAnalysis<SeoCompetitorAnalysis>(db, "seo_competitor_analysis", inputHash);
  if (cached && !force) return { analysisId: cached.id, analysis: cached.payload, cached: true };
  try {
    const response = await runStructuredAi({
      db,
      config,
      operation: "seo_competitor_analysis",
      schemaName: "tf_news_seo_competitor_analysis_v1",
      schema: seoCompetitorAnalysisSchema,
      system: [
        "Você é um analista editorial técnico e imparcial.",
        "Analise somente os artigos efetivamente fornecidos.",
        "Não afirme conhecer estratégia interna da empresa.",
        "Use formulações como 'O conteúdo publicado sugere concentração editorial em...'.",
        "Não invente audiência, tráfego, posição no Google ou dados não fornecidos.",
        "Retorne exclusivamente o JSON solicitado.",
      ].join(" "),
      user: JSON.stringify(input),
      maxOutputTokens: 1_800,
      diagnosticContext: { competitorId, articleCount: rows.results.length },
    });
    const analysisId = await storeSuccessfulAnalysis(db, {
      siteId: null,
      competitorId,
      operation: "seo_competitor_analysis",
      inputHash,
      config,
      confidence: response.data.confidence,
      payload: response.data,
      dataRefs: { articleIds: rows.results.map((row) => row.id), lastSyncAt: competitor.last_sync_at },
      usage: response.usage,
      requestId: response.requestId,
      validDays: 7,
    });
    return { analysisId, analysis: response.data, cached: false };
  } catch (error) {
    await storeFailedAnalysis(db, { siteId: null, competitorId, operation: "seo_competitor_analysis", inputHash, config, error });
    throw error;
  }
}

export async function calculateAndSaveAuthority(
  db: Database,
  siteId: number,
  metrics: SeoEngineMetrics,
  analysis: SeoAuthorityAnalysis | null,
) {
  const engineScore = calculateEngineScore(metrics);
  const geminiScore = analysis?.qualitativeScore ?? null;
  const available = [
    { id: "tf-news-engine" as const, score: engineScore, configuredWeight: 65 },
    ...(geminiScore === null ? [] : [{ id: "gemini-ai" as const, score: geminiScore, configuredWeight: 35 }]),
  ];
  const availableWeight = available.reduce((sum, item) => sum + item.configuredWeight, 0);
  const score = Math.round(available.reduce((sum, item) => sum + item.score * (item.configuredWeight / availableWeight), 0));
  const confidence = Number(Math.min(1, .35 + Math.min(metrics.articleCount, 60) / 120 + (analysis?.confidence ?? 0) * .25).toFixed(2));
  const previous = await db.prepare("SELECT score, metrics, gemini_score, engine_score FROM seo_authority_snapshots WHERE site_id = ? ORDER BY calculated_at DESC, id DESC LIMIT 1")
    .bind(siteId).first<{ score: number; metrics: string; gemini_score: number | null; engine_score: number }>();
  const positiveFactors = buildPositiveFactors(metrics);
  const negativeFactors = buildNegativeFactors(metrics);
  const contributions: SeoAuthorityCalculation["contributions"] = [
    {
      id: "google-signals",
      label: "Google Signals",
      status: "not_connected",
      score: null,
      configuredWeight: 0,
      effectiveWeight: 0,
      description: "Google Search Console e GA4 ainda não estão conectados.",
    },
    {
      id: "gemini-ai",
      label: "Gemini Analysis",
      status: geminiScore === null ? "pending" : "available",
      score: geminiScore,
      configuredWeight: 35,
      effectiveWeight: geminiScore === null ? 0 : Number((35 / availableWeight * 100).toFixed(1)),
      description: geminiScore === null ? "Análise qualitativa pendente." : "Qualidade, profundidade, clareza e consistência semântica do acervo.",
    },
    {
      id: "tf-news-engine",
      label: "TF News Engine",
      status: "available",
      score: engineScore,
      configuredWeight: 65,
      effectiveWeight: Number((65 / availableWeight * 100).toFixed(1)),
      description: "Frequência, regularidade, recência, diversidade, cobertura e lacunas editoriais.",
    },
  ];
  const calculatedAt = new Date().toISOString();
  const calculation: SeoAuthorityCalculation = {
    score,
    previousScore: previous?.score ?? null,
    confidence,
    engineScore,
    geminiScore,
    googleStatus: "not_connected",
    contributions,
    metrics,
    positiveFactors,
    negativeFactors,
    calculatedAt,
  };
  if (
    !previous
    || previous.score !== score
    || previous.engine_score !== engineScore
    || previous.gemini_score !== geminiScore
    || previous.metrics !== JSON.stringify(metrics)
  ) {
    await db.prepare(`
      INSERT INTO seo_authority_snapshots (
        site_id, score, previous_score, confidence, google_status, google_score, gemini_score,
        engine_score, contributions, positive_factors, negative_factors, metrics, source_states, calculated_at
      ) VALUES (?, ?, ?, ?, 'not_connected', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      siteId,
      score,
      previous?.score ?? null,
      confidence,
      geminiScore,
      engineScore,
      JSON.stringify(contributions),
      JSON.stringify(positiveFactors),
      JSON.stringify(negativeFactors),
      JSON.stringify(metrics),
      JSON.stringify({ google: "not_connected", gemini: geminiScore === null ? "pending" : "available", tfNewsEngine: "available" }),
      calculatedAt,
    ).run();
  }
  return calculation;
}

export function calculateMetrics(siteArticles: SeoArticleRow[], competitorArticles: CompetitorArticleRow[], news: NewsRow[]): SeoEngineMetrics {
  const now = Date.now();
  const published = siteArticles.filter((article) => article.published_at && Number.isFinite(Date.parse(article.published_at)));
  const last30 = published.filter((article) => Date.parse(article.published_at as string) >= now - 30 * 86_400_000);
  const last90 = published.filter((article) => Date.parse(article.published_at as string) >= now - 90 * 86_400_000);
  const analyzable = siteArticles.filter((article) => article.content_text.trim().length >= 500);
  const mostRecent = published.map((article) => Date.parse(article.published_at as string)).sort((a, b) => b - a)[0] ?? 0;
  const daysSinceLatest = mostRecent ? Math.max(0, (now - mostRecent) / 86_400_000) : 365;
  const updated = published.filter((article) => article.modified_at && article.modified_at !== article.published_at);
  const weeks = new Set(last90.map((article) => isoWeek(article.published_at as string)));
  const allTopics = siteArticles.flatMap((article) => articleTerms(article));
  const topicCounts = countTerms(allTopics);
  const dominant = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const monitoredTopics = new Set(news.flatMap((item) => parseList(item.topics).map(normalizeTerm)));
  const siteTopics = new Set(allTopics.map(normalizeTerm));
  const coveredTopics = [...monitoredTopics].filter((topic) => siteTopics.has(topic)).length;
  const competitorTopics = countTerms(competitorArticles.flatMap((article) => articleTerms(article)));
  const competitorGaps = [...competitorTopics].filter(([topic, count]) => count >= 2 && !siteTopics.has(normalizeTerm(topic))).length;
  const newsLatestByTopic = latestByTopic(news.map((item) => ({ publishedAt: item.published_at, topics: parseList(item.topics) })));
  const siteLatestByTopic = latestByTopic(siteArticles.map((item) => ({ publishedAt: item.published_at, topics: articleTerms(item) })));
  const reactionScores = [...newsLatestByTopic.entries()].map(([topic, newsAt]) => {
    const siteAt = siteLatestByTopic.get(topic);
    if (!siteAt || siteAt < newsAt) return 0;
    const days = Math.max(0, (siteAt - newsAt) / 86_400_000);
    return Math.max(0, 100 - days * 12);
  });
  return {
    articleCount: siteArticles.length,
    articlesLast30Days: last30.length,
    articlesLast90Days: last90.length,
    publishingFrequencyPerWeek: Number((last90.length / 13).toFixed(2)),
    regularityScore: Math.round(Math.min(100, weeks.size / 13 * 100)),
    recencyScore: Math.round(Math.max(0, 100 - daysSinceLatest * 4)),
    updatedArticleRatio: ratio(updated.length, Math.max(1, published.length)),
    analyzableArticleRatio: ratio(analyzable.length, Math.max(1, siteArticles.length)),
    topicDiversity: topicCounts.size,
    dominantTopic: dominant?.[0] ?? null,
    dominantTopicShare: dominant ? Number((dominant[1] / Math.max(1, allTopics.length)).toFixed(2)) : 0,
    clusterCount: [...topicCounts.values()].filter((count) => count >= 2).length,
    monitoredTopicCoverage: ratio(coveredTopics, Math.max(1, monitoredTopics.size)),
    competitorGapCount: competitorGaps,
    reactionSpeedScore: reactionScores.length ? Math.round(reactionScores.reduce((sum, score) => sum + score, 0) / reactionScores.length) : 0,
  };
}

export function calculateEngineScore(metrics: SeoEngineMetrics) {
  if (metrics.articleCount === 0) {
    return 0;
  }

  const volume = Math.min(100, metrics.articleCount / 50 * 100);
  const frequency = Math.min(100, metrics.publishingFrequencyPerWeek / 2 * 100);
  const diversity = Math.min(100, metrics.topicDiversity / 14 * 100);
  const balance = Math.max(0, 100 - Math.max(0, metrics.dominantTopicShare - .2) * 140);
  const update = metrics.updatedArticleRatio * 100;
  const analyzable = metrics.analyzableArticleRatio * 100;
  const coverage = metrics.monitoredTopicCoverage * 100;
  return Math.round(
    volume * .10
    + frequency * .14
    + metrics.regularityScore * .14
    + metrics.recencyScore * .12
    + update * .08
    + analyzable * .10
    + diversity * .10
    + balance * .07
    + coverage * .09
    + metrics.reactionSpeedScore * .06,
  );
}

async function loadDataset(db: Database, siteId: number) {
  const siteArticles = await db.prepare("SELECT id, title, url, excerpt, content_text, published_at, modified_at, categories, tags, topics, icps FROM seo_articles WHERE site_id = ? AND status = 'published' ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 2000")
    .bind(siteId).all<SeoArticleRow>();
  const competitorArticles = await db.prepare(`
    SELECT a.id, a.competitor_id, c.name AS competitor_name, a.title, a.url, a.excerpt,
      a.content_text, a.published_at, a.topics, a.categories, a.tags
    FROM seo_competitor_articles a
    JOIN seo_competitors c ON c.id = a.competitor_id
    WHERE a.status = 'published' AND c.active = TRUE AND c.archived_at IS NULL
    ORDER BY a.published_at DESC NULLS LAST, a.id DESC LIMIT 2000
  `).all<CompetitorArticleRow>();
  const news = await db.prepare("SELECT id, title, excerpt, published_at, topics, primary_icp, relevance_score FROM news_items WHERE published_at >= ? AND archived_at IS NULL AND discarded = FALSE ORDER BY relevance_score DESC, published_at DESC LIMIT 1000")
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).all<NewsRow>();
  const kits = await db.prepare("SELECT id, title, primary_icp, created_at FROM editorial_kits WHERE archived_at IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 500")
    .bind(new Date(Date.now() - 180 * 86_400_000).toISOString()).all<{ id: number; title: string; primary_icp: string; created_at: string }>();
  const queue = await db.prepare("SELECT id, title, status, news_item_id FROM editorial_queue WHERE archived_at IS NULL AND status IN ('new','analysis','approved','generating','ready') ORDER BY updated_at DESC LIMIT 500")
    .all<{ id: number; title: string; status: string; news_item_id: number }>();
  return { siteArticles: siteArticles.results, competitorArticles: competitorArticles.results, news: news.results, kits: kits.results, queue: queue.results };
}

export async function generateOpportunityCandidates(db: Database, siteId: number, dataset: Awaited<ReturnType<typeof loadDataset>>) {
  const newsByTopic = groupNewsByTopic(dataset.news);
  const competitorByTopic = groupCompetitorsByTopic(dataset.competitorArticles);
  const siteByTopic = groupSiteByTopic(dataset.siteArticles);
  const candidateTopics = new Set([...newsByTopic.keys(), ...competitorByTopic.keys()]);
  const candidates: OpportunityCandidate[] = [];
  const existing = await db.prepare("SELECT opportunity_key, status, discarded_at FROM seo_opportunities WHERE site_id = ?").bind(siteId).all<{ opportunity_key: string; status: string; discarded_at: string | null }>();
  const existingMap = new Map(existing.results.map((item) => [item.opportunity_key, item]));
  for (const normalizedTopic of candidateTopics) {
    const newsItems = newsByTopic.get(normalizedTopic) ?? [];
    const competitorItems = competitorByTopic.get(normalizedTopic) ?? [];
    const siteItems = siteByTopic.get(normalizedTopic) ?? [];
    const displayTopic = preferredTopic([...newsItems.flatMap((item) => parseList(item.topics)), ...competitorItems.flatMap((item) => articleTerms(item))], normalizedTopic);
    const icp = dominantValue(newsItems.map((item) => item.primary_icp).filter(Boolean)) ?? "Mercado e Logística";
    const key = `${normalizeTerm(displayTopic)}::${normalizeTerm(icp)}`;
    const previous = existingMap.get(key);
    if (previous?.status === "discarded" && previous.discarded_at && Date.parse(previous.discarded_at) >= Date.now() - 30 * 86_400_000) continue;
    const latestSite = siteItems.map((item) => Date.parse(item.published_at ?? "")).filter(Number.isFinite).sort((a, b) => b - a)[0] ?? 0;
    const recentSite = latestSite >= Date.now() - 120 * 86_400_000;
    const titleCollision = [...dataset.kits, ...dataset.queue].some((item) => similarity(`${item.title}`, displayTopic) >= .6);
    if ((recentSite || titleCollision) && newsItems.length < 4) continue;
    const confidence = clamp(Math.round(42 + Math.min(25, newsItems.length * 5) + Math.min(18, competitorItems.length * 4) + (siteItems.length ? 0 : 15) - (recentSite ? 15 : 0)));
    if (confidence < 55) continue;
    const reasons = [
      ...(newsItems.length ? [`${newsItems.length} notícia(s) monitorada(s) relacionada(s)`] : []),
      ...(competitorItems.length ? [`${competitorItems.length} publicação(ões) concorrente(s) relacionada(s)`] : []),
      ...(siteItems.length ? [`Cobertura própria baixa ou desatualizada (${siteItems.length} artigo(s))`] : ["Tema ainda não identificado no acervo publicado da TransFAST"]),
      ...(newsItems.some((item) => item.relevance_score >= 75) ? ["Alta relevância editorial no Monitoramento"] : []),
    ].slice(0, 6);
    candidates.push({
      candidateKey: key,
      title: displayTopic,
      topic: displayTopic,
      icp,
      priority: confidence >= 85 ? "high" : confidence >= 70 ? "medium" : "low",
      seoPotential: confidence >= 88 ? "very_high" : confidence >= 70 ? "high" : "moderate",
      confidence,
      reasons,
      signalOrigins: unique(["monitoring", ...(competitorItems.length ? ["competitors"] : []), ...(siteItems.length ? ["transfast_archive"] : ["content_gap"])]),
      competitorIds: uniqueNumbers(competitorItems.map((item) => item.competitor_id)),
      newsIds: uniqueNumbers(newsItems.map((item) => item.id)),
      siteArticleIds: uniqueNumbers(siteItems.map((item) => item.id)),
      suggestedAngle: null,
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 30);
}

async function persistOpportunities(db: Database, siteId: number, candidates: OpportunityCandidate[], analysisId: number | null) {
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
  for (const candidate of candidates) {
    await db.prepare(`
      INSERT INTO seo_opportunities (
        site_id, opportunity_key, title, topic, icp, priority, seo_potential, confidence,
        reasons, signal_origins, competitor_ids, news_ids, site_article_ids, suggested_angle,
        status, valid_until, source_analysis_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)
      ON CONFLICT (site_id, opportunity_key) DO UPDATE SET
        title=excluded.title, topic=excluded.topic, icp=excluded.icp, priority=excluded.priority,
        seo_potential=excluded.seo_potential, confidence=excluded.confidence, reasons=excluded.reasons,
        signal_origins=excluded.signal_origins, competitor_ids=excluded.competitor_ids,
        news_ids=excluded.news_ids, site_article_ids=excluded.site_article_ids,
        suggested_angle=COALESCE(excluded.suggested_angle, seo_opportunities.suggested_angle),
        status=CASE WHEN seo_opportunities.status IN ('accepted','in_production','converted_to_kit','discarded')
          THEN seo_opportunities.status ELSE 'new' END,
        valid_until=excluded.valid_until, source_analysis_id=COALESCE(excluded.source_analysis_id, seo_opportunities.source_analysis_id),
        updated_at=excluded.updated_at
    `).bind(
      siteId, candidate.candidateKey, candidate.title, candidate.topic, candidate.icp, candidate.priority,
      candidate.seoPotential, candidate.confidence, JSON.stringify(candidate.reasons), JSON.stringify(candidate.signalOrigins),
      JSON.stringify(candidate.competitorIds), JSON.stringify(candidate.newsIds), JSON.stringify(candidate.siteArticleIds),
      candidate.suggestedAngle, validUntil, analysisId, now, now,
    ).run();
  }
  await db.prepare("UPDATE seo_opportunities SET status = 'expired', updated_at = ? WHERE site_id = ? AND valid_until < ? AND status IN ('new','reviewed')")
    .bind(now, siteId, now).run();
  const rows = await db.prepare("SELECT * FROM seo_opportunities WHERE site_id = ? AND status <> 'expired' ORDER BY confidence DESC, created_at DESC LIMIT 100").bind(siteId).all<Record<string, unknown>>();
  return rows.results;
}

async function analyzeAuthority(
  db: Database,
  config: AiConfig,
  siteId: number,
  inputHash: string,
  input: ReturnType<typeof authorityAiInput>,
  force: boolean,
) {
  const cached = await loadCachedAnalysis<SeoAuthorityAnalysis>(db, "seo_authority_summary", inputHash);
  if (cached && !force) return { analysisId: cached.id, analysis: cached.payload, cached: true };
  try {
    const response = await runStructuredAi({
      db,
      config,
      operation: "seo_authority_summary",
      schemaName: "tf_news_seo_authority_summary_v1",
      schema: seoAuthorityAnalysisSchema,
      system: [
        "Você atua como analista técnico de autoridade editorial para uma empresa de logística.",
        "Use somente as métricas e amostras fornecidas pelo TF News.",
        "A nota qualitativa deve avaliar profundidade, clareza, coerência, diversidade, atualização, utilidade e consistência semântica.",
        "Não invente dados do Google, tráfego, CTR, backlinks, indexação ou audiência.",
        "Google Signals está não conectado e não deve influenciar sua nota.",
        "Se a amostra for pequena, reduza explicitamente a confiança.",
        "Retorne exclusivamente o JSON solicitado.",
      ].join(" "),
      user: JSON.stringify(input),
      maxOutputTokens: 2_000,
      diagnosticContext: { siteId, articleCount: input.metrics.articleCount },
    });
    const analysisId = await storeSuccessfulAnalysis(db, {
      siteId,
      competitorId: null,
      operation: "seo_authority_summary",
      inputHash,
      config,
      confidence: response.data.confidence,
      payload: response.data,
      dataRefs: input.dataRefs,
      usage: response.usage,
      requestId: response.requestId,
      validDays: 7,
    });
    return { analysisId, analysis: response.data, cached: false };
  } catch (error) {
    await storeFailedAnalysis(db, { siteId, competitorId: null, operation: "seo_authority_summary", inputHash, config, error });
    throw error;
  }
}

async function rankOpportunities(
  db: Database,
  config: AiConfig,
  siteId: number,
  inputHash: string,
  input: ReturnType<typeof opportunityRankingInput>,
  force: boolean,
) {
  const cached = await loadCachedAnalysis<ReturnType<typeof seoOpportunityRankingSchema.parse>>(db, "seo_opportunity_ranking", inputHash);
  if (cached && !force) return { analysisId: cached.id, ranking: cached.payload, cached: true };
  try {
    const response = await runStructuredAi({
      db,
      config,
      operation: "seo_opportunity_ranking",
      schemaName: "tf_news_seo_opportunity_ranking_v1",
      schema: seoOpportunityRankingSchema,
      system: [
        "Você prioriza oportunidades editoriais B2B de logística.",
        "Use somente os candidatos determinísticos fornecidos pelo TF News Engine.",
        "Não crie candidatos, métricas ou referências adicionais.",
        "Mantenha exatamente o candidateKey de cada item.",
        "Priorize, justifique e sugira um ângulo editorial factual.",
        "Retorne exclusivamente o JSON solicitado.",
      ].join(" "),
      user: JSON.stringify(input),
      maxOutputTokens: 2_400,
      diagnosticContext: { siteId, candidateCount: input.candidates.length },
    });
    const analysisId = await storeSuccessfulAnalysis(db, {
      siteId,
      competitorId: null,
      operation: "seo_opportunity_ranking",
      inputHash,
      config,
      confidence: response.data.confidence,
      payload: response.data,
      dataRefs: { candidateKeys: input.candidates.map((item) => item.candidateKey) },
      usage: response.usage,
      requestId: response.requestId,
      validDays: 7,
    });
    return { analysisId, ranking: response.data, cached: false };
  } catch (error) {
    await storeFailedAnalysis(db, { siteId, competitorId: null, operation: "seo_opportunity_ranking", inputHash, config, error });
    throw error;
  }
}

function mergeOpportunityRanking(candidates: OpportunityCandidate[], items: Array<{
  candidateKey: string;
  priority: "high" | "medium" | "low";
  seoPotential: "very_high" | "high" | "moderate";
  confidence: number;
  reasons: string[];
  suggestedAngle: string;
}>) {
  const ranking = new Map(items.map((item) => [item.candidateKey, item]));
  return candidates.map((candidate) => {
    const ranked = ranking.get(candidate.candidateKey);
    if (!ranked) return candidate;
    return {
      ...candidate,
      priority: ranked.priority,
      seoPotential: ranked.seoPotential,
      confidence: Math.round((candidate.confidence * .55) + (ranked.confidence * .45)),
      reasons: unique([...candidate.reasons, ...ranked.reasons]).slice(0, 6),
      suggestedAngle: ranked.suggestedAngle,
    };
  }).sort((a, b) => b.confidence - a.confidence);
}

function authorityAiInput(
  site: { id: number; name: string; domain: string; last_sync_at: string | null },
  metrics: SeoEngineMetrics,
  dataset: Awaited<ReturnType<typeof loadDataset>>,
  candidates: OpportunityCandidate[],
) {
  return {
    site,
    connectedSources: { googleSearchConsole: false, googleAnalytics4: false, transfastArchive: true, tfNewsEngine: true },
    metrics,
    representativeArticles: dataset.siteArticles.slice(0, 30).map((article) => ({
      id: article.id,
      title: article.title,
      excerpt: article.excerpt.slice(0, 700),
      publishedAt: article.published_at,
      modifiedAt: article.modified_at,
      topics: articleTerms(article),
    })),
    competitorSummary: {
      registeredCompetitors: uniqueNumbers(dataset.competitorArticles.map((item) => item.competitor_id)).length,
      collectedArticles: dataset.competitorArticles.length,
      dominantTopics: topTerms(dataset.competitorArticles.flatMap((article) => articleTerms(article)), 12),
    },
    monitoredNews: {
      count: dataset.news.length,
      dominantTopics: topTerms(dataset.news.flatMap((item) => parseList(item.topics)), 12),
    },
    opportunityCandidates: candidates.slice(0, 10).map((candidate) => ({
      candidateKey: candidate.candidateKey,
      topic: candidate.topic,
      icp: candidate.icp,
      confidence: candidate.confidence,
      reasons: candidate.reasons,
    })),
    dataRefs: {
      siteArticleIds: dataset.siteArticles.slice(0, 100).map((item) => item.id),
      competitorArticleIds: dataset.competitorArticles.slice(0, 100).map((item) => item.id),
      newsIds: dataset.news.slice(0, 100).map((item) => item.id),
      lastSyncAt: site.last_sync_at,
    },
  };
}

function opportunityRankingInput(candidates: OpportunityCandidate[]) {
  return {
    candidates: candidates.slice(0, 20).map((candidate) => ({
      candidateKey: candidate.candidateKey,
      title: candidate.title,
      topic: candidate.topic,
      icp: candidate.icp,
      deterministicPriority: candidate.priority,
      deterministicPotential: candidate.seoPotential,
      deterministicConfidence: candidate.confidence,
      reasons: candidate.reasons,
      signalOrigins: candidate.signalOrigins,
      relatedNewsCount: candidate.newsIds.length,
      relatedCompetitorCount: candidate.competitorIds.length,
      relatedTransfastArticleCount: candidate.siteArticleIds.length,
    })),
  };
}

async function loadLatestAuthorityAnalysis(db: Database, siteId: number) {
  const row = await db.prepare("SELECT payload FROM seo_ai_analyses WHERE site_id = ? AND operation = 'seo_authority_summary' AND status = 'success' ORDER BY created_at DESC, id DESC LIMIT 1")
    .bind(siteId).first<{ payload: string }>();
  if (!row) return null;
  const parsed = seoAuthorityAnalysisSchema.safeParse(parseJson(row.payload, {}));
  return parsed.success ? parsed.data : null;
}

async function loadCachedAnalysis<T>(db: Database, operation: string, inputHash: string) {
  const row = await db.prepare("SELECT id, payload, confidence, valid_until, input_hash, provider, model, created_at FROM seo_ai_analyses WHERE operation = ? AND input_hash = ? AND status = 'success' AND (valid_until IS NULL OR valid_until > ?) ORDER BY created_at DESC LIMIT 1")
    .bind(operation, inputHash, new Date().toISOString()).first<ExistingAnalysisRow>();
  if (!row) return null;
  return { id: row.id, payload: parseJson(row.payload, null) as T, confidence: row.confidence, createdAt: row.created_at };
}

async function storeSuccessfulAnalysis(db: Database, input: {
  siteId: number | null;
  competitorId: number | null;
  operation: string;
  inputHash: string;
  config: AiConfig;
  confidence: number;
  payload: unknown;
  dataRefs: unknown;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  requestId: string | null;
  validDays: number;
}) {
  const now = new Date().toISOString();
  const validUntil = new Date(Date.now() + input.validDays * 86_400_000).toISOString();
  const result = await db.prepare(`
    INSERT INTO seo_ai_analyses (
      site_id, competitor_id, operation, input_hash, version, provider, model, status, confidence,
      payload, data_refs, input_tokens, output_tokens, estimated_cost_usd, request_id, error_message,
      valid_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'v1', ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT (operation, input_hash) DO UPDATE SET
      site_id=excluded.site_id, competitor_id=excluded.competitor_id, provider=excluded.provider,
      model=excluded.model, status='success', confidence=excluded.confidence, payload=excluded.payload,
      data_refs=excluded.data_refs, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
      estimated_cost_usd=excluded.estimated_cost_usd, request_id=excluded.request_id, error_message=NULL,
      valid_until=excluded.valid_until, updated_at=excluded.updated_at
    RETURNING id
  `).bind(
    input.siteId, input.competitorId, input.operation, input.inputHash, input.config.provider, input.config.model,
    input.confidence, JSON.stringify(input.payload), JSON.stringify(input.dataRefs), input.usage.inputTokens,
    input.usage.outputTokens, input.usage.estimatedCostUsd, input.requestId, validUntil, now, now,
  ).run();
  return Number(result.meta.last_row_id);
}

async function storeFailedAnalysis(db: Database, input: {
  siteId: number | null;
  competitorId: number | null;
  operation: string;
  inputHash: string;
  config: AiConfig;
  error: unknown;
}) {
  const now = new Date().toISOString();
  const message = input.error instanceof Error ? input.error.message : "Falha na análise SEO.";
  await db.prepare(`
    INSERT INTO seo_ai_analyses (
      site_id, competitor_id, operation, input_hash, version, provider, model, status, payload,
      data_refs, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'v1', ?, ?, 'failed', '{}', '{}', ?, ?, ?)
    ON CONFLICT (operation, input_hash) DO UPDATE SET
      status='failed', error_message=excluded.error_message, updated_at=excluded.updated_at
  `).bind(input.siteId, input.competitorId, input.operation, input.inputHash, input.config.provider, input.config.model, message.slice(0, 800), now, now).run();
}

function buildPositiveFactors(metrics: SeoEngineMetrics) {
  return [
    ...(metrics.regularityScore >= 65 ? [`Regularidade editorial de ${metrics.regularityScore}% nos últimos 90 dias.`] : []),
    ...(metrics.recencyScore >= 70 ? ["O acervo possui publicação recente."] : []),
    ...(metrics.topicDiversity >= 8 ? [`Boa diversidade temática, com ${metrics.topicDiversity} temas identificados.`] : []),
    ...(metrics.analyzableArticleRatio >= .75 ? ["A maior parte do acervo possui profundidade suficiente para análise."] : []),
    ...(metrics.monitoredTopicCoverage >= .5 ? ["Cobertura relevante dos temas acompanhados pelo Monitoramento."] : []),
  ].slice(0, 6);
}

function buildNegativeFactors(metrics: SeoEngineMetrics) {
  return [
    ...(metrics.articleCount < 10 ? ["Amostra editorial ainda pequena para uma leitura de alta confiança."] : []),
    ...(metrics.regularityScore < 45 ? ["Baixa regularidade de publicação nos últimos 90 dias."] : []),
    ...(metrics.recencyScore < 50 ? ["O acervo não possui publicação suficientemente recente."] : []),
    ...(metrics.dominantTopicShare > .45 ? [`Concentração elevada no tema ${metrics.dominantTopic ?? "dominante"}.`] : []),
    ...(metrics.competitorGapCount > 0 ? [`Foram identificadas ${metrics.competitorGapCount} lacuna(s) frente aos concorrentes cadastrados.`] : []),
    ...(metrics.monitoredTopicCoverage < .35 ? ["Baixa cobertura dos temas atuais do Monitoramento."] : []),
  ].slice(0, 6);
}

function groupNewsByTopic(news: NewsRow[]) {
  const result = new Map<string, NewsRow[]>();
  for (const item of news) for (const topic of parseList(item.topics)) pushMap(result, normalizeTerm(topic), item);
  return result;
}

function groupCompetitorsByTopic(articles: CompetitorArticleRow[]) {
  const result = new Map<string, CompetitorArticleRow[]>();
  for (const item of articles) for (const topic of articleTerms(item)) pushMap(result, normalizeTerm(topic), item);
  return result;
}

function groupSiteByTopic(articles: SeoArticleRow[]) {
  const result = new Map<string, SeoArticleRow[]>();
  for (const item of articles) for (const topic of articleTerms(item)) pushMap(result, normalizeTerm(topic), item);
  return result;
}

function articleTerms(article: Pick<SeoArticleRow, "topics" | "categories" | "tags"> | Pick<CompetitorArticleRow, "topics" | "categories" | "tags">) {
  return unique([...parseList(article.topics), ...parseList(article.categories), ...parseList(article.tags)]).slice(0, 20);
}

function topTerms(values: string[], limit: number) {
  return [...countTerms(values).entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term, count]) => ({ term, count }));
}

function countTerms(values: string[]) {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeTerm(value);
    if (!normalized || normalized.length < 3) continue;
    labels.set(normalized, labels.get(normalized) ?? value.trim());
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return new Map([...counts.entries()].map(([normalized, count]) => [labels.get(normalized) ?? normalized, count]));
}

function latestByTopic(items: Array<{ publishedAt: string | null; topics: string[] }>) {
  const map = new Map<string, number>();
  for (const item of items) {
    const published = Date.parse(item.publishedAt ?? "");
    if (!Number.isFinite(published)) continue;
    for (const topic of item.topics) {
      const key = normalizeTerm(topic);
      map.set(key, Math.max(map.get(key) ?? 0, published));
    }
  }
  return map;
}

function preferredTopic(values: string[], fallback: string) {
  const candidates = values.filter((value) => normalizeTerm(value) === fallback);
  return candidates[0]?.trim() || fallback.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dominantValue(values: string[]) {
  const counts = countTerms(values);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function isoWeek(value: string) {
  const date = new Date(value);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-${Math.ceil(((date.getTime() - start.getTime()) / 86_400_000 + start.getUTCDay() + 1) / 7)}`;
}

function ratio(part: number, total: number) {
  return Number((part / Math.max(1, total)).toFixed(2));
}

function similarity(a: string, b: string) {
  const left = new Set(normalizeTerm(a).split(/\s+/).filter((token) => token.length >= 4));
  const right = new Set(normalizeTerm(b).split(/\s+/).filter((token) => token.length >= 4));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / Math.min(left.size, right.size);
}

function parseList(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJson(value: string, fallback: unknown) {
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

function normalizeTerm(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T) {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), value]);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
