import { createHash } from "node:crypto";
import type { Database } from "../db/runtime.ts";
import { runStructuredAi, type AiConfig } from "./ai.ts";
import {
  evergreenOpportunityBatchSchema,
  type EvergreenCandidateAnalysis,
} from "./content-opportunity-schemas.ts";

export type OpportunitySignal = {
  type: "news" | "competitor_article";
  id: number;
  title: string;
  excerpt: string;
  content: string;
  publishedAt: string | null;
  topics: string[];
  icps: string[];
  relevance: number;
  publisher: string;
};

export type EvergreenCandidate = {
  candidateKey: string;
  normalizedTopic: string;
  suggestedTitle: string;
  category: string;
  description: string;
  relatedIcps: string[];
  signals: OpportunitySignal[];
  siteMatches: Array<{ id: number; title: string; url: string }>;
  factors: {
    evergreenScore: number;
    icpScore: number;
    recurrenceScore: number;
    contentGapScore: number;
    competitorScore: number;
    googleSignalsScore: null;
    strategicScore: number;
  };
};

type NewsRow = {
  id: number;
  title: string;
  excerpt: string;
  content_text: string;
  published_at: string;
  topics: string;
  primary_icp: string;
  secondary_icps: string;
  relevance_score: number;
  source_name: string;
};

type CompetitorRow = {
  id: number;
  title: string;
  excerpt: string;
  content_text: string;
  published_at: string | null;
  topics: string;
  competitor_name: string;
};

type SiteArticleRow = {
  id: number;
  title: string;
  url: string;
  topics: string;
};

export async function buildEvergreenCandidates(
  db: Database,
  options: { now?: Date; limit?: number } = {},
): Promise<EvergreenCandidate[]> {
  const now = options.now ?? new Date();
  const sinceNews = new Date(now.getTime() - 120 * 86_400_000).toISOString();
  const sinceCompetitors = new Date(now.getTime() - 240 * 86_400_000).toISOString();
  const limit = Math.max(20, Math.min(options.limit ?? 300, 600));
  const [newsResult, competitorResult, siteResult] = await Promise.all([
    db.prepare(`
      SELECT n.id, n.title, n.excerpt, n.content_text, n.published_at, n.topics,
        n.primary_icp, n.secondary_icps, n.relevance_score, s.name AS source_name
      FROM news_items n
      JOIN sources s ON s.id = n.source_id
      WHERE n.archived_at IS NULL AND n.status <> 'discarded'
        AND n.published_at >= ? AND n.relevance_score >= 45
      ORDER BY n.relevance_score DESC, n.published_at DESC, n.id DESC
      LIMIT ?
    `).bind(sinceNews, limit).all<NewsRow>(),
    db.prepare(`
      SELECT article.id, article.title, article.excerpt, article.content_text, article.published_at,
        article.topics, competitor.name AS competitor_name
      FROM seo_competitor_articles article
      JOIN seo_competitors competitor ON competitor.id = article.competitor_id
      WHERE article.status = 'published' AND article.unavailable_at IS NULL
        AND competitor.active = TRUE AND competitor.archived_at IS NULL
        AND COALESCE(article.published_at, article.last_collected_at) >= ?
      ORDER BY COALESCE(article.published_at, article.last_collected_at) DESC, article.id DESC
      LIMIT ?
    `).bind(sinceCompetitors, limit).all<CompetitorRow>(),
    db.prepare(`
      SELECT id, title, url, topics
      FROM seo_articles
      WHERE status = 'published' AND unavailable_at IS NULL
      ORDER BY COALESCE(modified_at, published_at, last_collected_at) DESC
      LIMIT 500
    `).all<SiteArticleRow>(),
  ]);

  const signals: OpportunitySignal[] = [
    ...newsResult.results.map((row) => ({
      type: "news" as const,
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
      content: row.content_text,
      publishedAt: row.published_at,
      topics: parseStringArray(row.topics),
      icps: uniqueStrings([row.primary_icp, ...parseStringArray(row.secondary_icps)]),
      relevance: row.relevance_score,
      publisher: row.source_name,
    })),
    ...competitorResult.results.map((row) => ({
      type: "competitor_article" as const,
      id: row.id,
      title: row.title,
      excerpt: row.excerpt,
      content: row.content_text,
      publishedAt: row.published_at,
      topics: parseStringArray(row.topics),
      icps: [] as string[],
      relevance: 70,
      publisher: row.competitor_name,
    })),
  ];
  return groupEvergreenSignals(signals, siteResult.results);
}

export function groupEvergreenSignals(
  signals: OpportunitySignal[],
  siteArticles: SiteArticleRow[] = [],
): EvergreenCandidate[] {
  const groups = new Map<string, OpportunitySignal[]>();
  for (const signal of signals) {
    const topic = inferEvergreenTopic(signal);
    if (!topic) continue;
    const current = groups.get(topic.key) ?? [];
    current.push(signal);
    groups.set(topic.key, current);
  }

  const candidates: EvergreenCandidate[] = [];
  for (const [key, groupedSignals] of groups) {
    const newsSignals = groupedSignals.filter((signal) => signal.type === "news");
    const competitorSignals = groupedSignals.filter((signal) => signal.type === "competitor_article");
    if (!newsSignals.length) continue;
    if (groupedSignals.length < 2 && Math.max(...newsSignals.map((signal) => signal.relevance)) < 82) continue;
    const blueprint = TOPIC_BLUEPRINTS[key] ?? genericBlueprint(groupedSignals[0]);
    const siteMatches = siteArticles
      .filter((article) => semanticSimilarity(`${blueprint.title} ${key}`, `${article.title} ${parseStringArray(article.topics).join(" ")}`) >= .42)
      .slice(0, 5)
      .map(({ id, title, url }) => ({ id, title, url }));
    const relatedIcps = uniqueStrings(groupedSignals.flatMap((signal) => signal.icps)).slice(0, 8);
    const factors = calculateStrategicScore({
      signalCount: groupedSignals.length,
      competitorCount: competitorSignals.length,
      averageRelevance: average(newsSignals.map((signal) => signal.relevance)),
      hasIcp: relatedIcps.length > 0,
      siteMatchCount: siteMatches.length,
      evergreenStrength: blueprint.evergreenStrength,
    });
    if (factors.strategicScore < 50) continue;
    candidates.push({
      candidateKey: key,
      normalizedTopic: key,
      suggestedTitle: blueprint.title,
      category: blueprint.category,
      description: blueprint.description,
      relatedIcps: relatedIcps.length ? relatedIcps : ["Logística"],
      signals: groupedSignals
        .sort((left, right) => right.relevance - left.relevance)
        .slice(0, 12),
      siteMatches,
      factors,
    });
  }
  return candidates
    .sort((left, right) => right.factors.strategicScore - left.factors.strategicScore || left.normalizedTopic.localeCompare(right.normalizedTopic))
    .slice(0, 40);
}

export function calculateStrategicScore(input: {
  signalCount: number;
  competitorCount: number;
  averageRelevance: number;
  hasIcp: boolean;
  siteMatchCount: number;
  evergreenStrength: number;
}) {
  const evergreenScore = clamp(Math.round(input.evergreenStrength));
  const icpScore = clamp(Math.round((input.hasIcp ? 70 : 35) + input.averageRelevance * .25));
  const recurrenceScore = clamp(Math.round(30 + input.signalCount * 14));
  const contentGapScore = input.siteMatchCount === 0 ? 96 : input.siteMatchCount === 1 ? 58 : 25;
  const competitorScore = clamp(Math.round(35 + input.competitorCount * 24));
  const weighted = evergreenScore * .30
    + icpScore * .25
    + recurrenceScore * .15
    + contentGapScore * .15
    + competitorScore * .10;
  const strategicScore = clamp(Math.round(weighted / .95));
  return {
    evergreenScore,
    icpScore,
    recurrenceScore,
    contentGapScore,
    competitorScore,
    googleSignalsScore: null,
    strategicScore,
  };
}

export async function analyzeEvergreenBatch(
  db: Database,
  config: AiConfig,
  candidates: EvergreenCandidate[],
  options: { fetchImpl?: typeof fetch } = {},
) {
  const input = {
    candidates: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      suggestedTitle: candidate.suggestedTitle,
      category: candidate.category,
      relatedIcps: candidate.relatedIcps,
      deterministicFactors: candidate.factors,
      recurringSignals: candidate.signals.map((signal) => ({
        type: signal.type,
        title: signal.title,
        publisher: signal.publisher,
        excerpt: compact(signal.excerpt || signal.content).slice(0, 700),
        publishedAt: signal.publishedAt,
      })),
      possibleExistingContent: candidate.siteMatches,
    })),
  };
  const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const cached = await db.prepare(`
    SELECT id, payload, input_tokens, output_tokens, estimated_cost_usd
    FROM seo_ai_analyses
    WHERE operation = 'content_evergreen_opportunity_analysis' AND input_hash = ?
      AND status = 'success' AND (valid_until IS NULL OR valid_until > ?)
    LIMIT 1
  `).bind(inputHash, new Date().toISOString()).first<{
    id: number;
    payload: string;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
  }>();
  if (cached) {
    return {
      analysisId: cached.id,
      data: evergreenOpportunityBatchSchema.parse(JSON.parse(cached.payload)),
      usage: {
        inputTokens: cached.input_tokens,
        outputTokens: cached.output_tokens,
        estimatedCostUsd: cached.estimated_cost_usd,
      },
      cached: true,
    };
  }

  const response = await runStructuredAi({
    db,
    config,
    operation: "content_evergreen_opportunity_analysis",
    schemaName: "tf_news_evergreen_opportunity_batch_v1",
    schema: evergreenOpportunityBatchSchema,
    system: [
      "Você atua como estrategista editorial técnico da TransFAST.",
      "Avalie oportunidades de conteúdo evergreen sem inventar demanda, dados ou sinais.",
      "Um tema evergreen precisa continuar útil por meses ou anos, responder a uma dúvida recorrente, aderir aos serviços e ICPs da TransFAST e não depender exclusivamente de um evento atual.",
      "Diferencie uma oportunidade de criação de uma sugestão de atualizar ou expandir conteúdo já existente.",
      "Preserve o candidateKey recebido exatamente.",
      "O score deve refletir os fatores fornecidos; não atribua valor ao Google Signals, pois ele não está conectado.",
      "Retorne somente o JSON estruturado solicitado.",
    ].join(" "),
    user: JSON.stringify(input),
    maxOutputTokens: 1_500,
    retryPolicy: "high-demand",
    retryDelaysMs: [5_000, 10_000],
    fetchImpl: options.fetchImpl,
    diagnosticContext: {
      candidateCount: candidates.length,
      operationVersion: "content-evergreen-v1",
    },
  });
  const now = new Date();
  const validUntil = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const inserted = await db.prepare(`
    INSERT INTO seo_ai_analyses (
      operation, input_hash, version, provider, model, status, confidence, payload, data_refs,
      input_tokens, output_tokens, estimated_cost_usd, request_id, valid_until, created_at, updated_at
    ) VALUES ('content_evergreen_opportunity_analysis', ?, 'v1', ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (operation, input_hash) DO UPDATE SET
      provider = excluded.provider, model = excluded.model, status = excluded.status,
      confidence = excluded.confidence, payload = excluded.payload, data_refs = excluded.data_refs,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd, request_id = excluded.request_id,
      error_message = NULL, valid_until = excluded.valid_until, updated_at = excluded.updated_at
    RETURNING id
  `).bind(
    inputHash,
    config.provider,
    config.model,
    average(response.data.items.map((item) => item.strategicScore)) / 100,
    JSON.stringify(response.data),
    JSON.stringify({ candidateKeys: candidates.map((candidate) => candidate.candidateKey) }),
    response.usage.inputTokens,
    response.usage.outputTokens,
    response.usage.estimatedCostUsd,
    response.requestId,
    validUntil,
    now.toISOString(),
    now.toISOString(),
  ).first<{ id: number }>();
  if (!inserted) throw new Error("Não foi possível registrar a análise evergreen.");
  return { analysisId: inserted.id, data: response.data, usage: response.usage, cached: false };
}

export async function persistEvergreenBatch(
  db: Database,
  candidates: EvergreenCandidate[],
  analyses: EvergreenCandidateAnalysis[],
  analysisId: number,
) {
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const statements = [];
  let ignored = 0;
  for (const analysis of analyses) {
    const candidate = candidateByKey.get(analysis.candidateKey);
    if (!candidate || !analysis.evergreenPotential || analysis.recommendation === "skip" || analysis.cannibalization === "skip") {
      ignored += 1;
      continue;
    }
    const strategicScore = clamp(Math.round(candidate.factors.strategicScore * .7 + analysis.strategicScore * .3));
    if (strategicScore < 50) {
      ignored += 1;
      continue;
    }
    const now = new Date().toISOString();
    const originType = candidate.signals.some((signal) => signal.type === "competitor_article") ? "mixed" : "monitoring";
    const priority = priorityFromScore(strategicScore);
    const values: unknown[] = [
      analysis.suggestedTitle,
      candidate.normalizedTopic,
      analysis.category,
      candidate.description,
      analysis.rationale,
      strategicScore,
      priority,
      candidate.factors.evergreenScore,
      candidate.factors.icpScore,
      candidate.factors.recurrenceScore,
      candidate.factors.contentGapScore,
      candidate.factors.competitorScore,
      JSON.stringify({ ...candidate.factors, aiScore: analysis.strategicScore, recommendation: analysis.recommendation, cannibalization: analysis.cannibalization }),
      analysis.primaryKeyword,
      analysis.searchIntent,
      JSON.stringify(uniqueStrings([...candidate.relatedIcps, ...analysis.relatedIcps]).slice(0, 8)),
      originType,
      candidate.signals.length,
      analysisId,
      now,
      now,
    ];
    const sourceCtes: string[] = [];
    candidate.signals.forEach((signal, index) => {
      if (signal.type === "news") {
        sourceCtes.push(`news_source_${index} AS (
          INSERT INTO content_opportunity_sources (opportunity_id, source_type, news_item_id, relevance_score, created_at)
          SELECT id, 'news', ?, ?, ? FROM upserted
          ON CONFLICT (opportunity_id, news_item_id) DO UPDATE SET relevance_score = excluded.relevance_score
          RETURNING opportunity_id
        )`);
      } else {
        sourceCtes.push(`competitor_source_${index} AS (
          INSERT INTO content_opportunity_sources (opportunity_id, source_type, competitor_article_id, relevance_score, created_at)
          SELECT id, 'competitor_article', ?, ?, ? FROM upserted
          ON CONFLICT (opportunity_id, competitor_article_id) DO UPDATE SET relevance_score = excluded.relevance_score
          RETURNING opportunity_id
        )`);
      }
      values.push(signal.id, signal.relevance, now);
    });
    candidate.siteMatches.forEach((article, index) => {
      sourceCtes.push(`site_source_${index} AS (
        INSERT INTO content_opportunity_sources (opportunity_id, source_type, seo_article_id, relevance_score, created_at)
        SELECT id, 'site_article', ?, ?, ? FROM upserted
        ON CONFLICT (opportunity_id, seo_article_id) DO UPDATE SET relevance_score = excluded.relevance_score
        RETURNING opportunity_id
      )`);
      values.push(article.id, 70, now);
    });
    statements.push(db.prepare(`
      WITH upserted AS (
        INSERT INTO content_opportunities (
          suggested_title, normalized_topic, category, description, rationale, strategic_score, priority,
          evergreen_score, icp_score, recurrence_score, content_gap_score, competitor_score,
          google_signals_score, score_factors, primary_keyword, search_intent, related_icps, status,
          origin_type, source_count, ai_analysis_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'opportunity', ?, ?, ?, ?, ?)
        ON CONFLICT (normalized_topic) DO UPDATE SET
          suggested_title = excluded.suggested_title,
          category = excluded.category,
          description = excluded.description,
          rationale = excluded.rationale,
          strategic_score = excluded.strategic_score,
          priority = excluded.priority,
          evergreen_score = excluded.evergreen_score,
          icp_score = excluded.icp_score,
          recurrence_score = excluded.recurrence_score,
          content_gap_score = excluded.content_gap_score,
          competitor_score = excluded.competitor_score,
          score_factors = excluded.score_factors,
          primary_keyword = excluded.primary_keyword,
          search_intent = excluded.search_intent,
          related_icps = excluded.related_icps,
          origin_type = excluded.origin_type,
          source_count = excluded.source_count,
          ai_analysis_id = excluded.ai_analysis_id,
          updated_at = excluded.updated_at
        WHERE content_opportunities.generated_kit_id IS NULL
          AND content_opportunities.status <> 'published'
        RETURNING id, (xmax = 0) AS inserted
      )
      ${sourceCtes.length ? `, ${sourceCtes.join(", ")}` : ""}
      SELECT id, inserted FROM upserted
    `).bind(...values));
  }
  if (!statements.length) return { created: 0, updated: 0, ignored };
  const results = await db.batch(statements);
  let created = 0;
  let updated = 0;
  for (const result of results) {
    const row = result.results[0] as { inserted?: boolean } | undefined;
    if (!row) {
      ignored += 1;
    } else if (row.inserted) {
      created += 1;
    } else {
      updated += 1;
    }
  }
  return { created, updated, ignored };
}

export async function listContentOpportunities(db: Database) {
  const result = await db.prepare(`
    SELECT opportunity.*,
      kit.title AS kit_title,
      kit.status AS kit_status,
      CASE
        WHEN kit.status = 'published' THEN 'published'
        ELSE opportunity.status
      END AS effective_status,
      COALESCE((
        SELECT json_agg(json_build_object(
          'type', source.source_type,
          'newsId', source.news_item_id,
          'competitorArticleId', source.competitor_article_id,
          'seoArticleId', source.seo_article_id,
          'title', COALESCE(news.title, competitor_article.title, site_article.title),
          'publisher', COALESCE(news_source.name, competitor.name, 'TransFAST'),
          'url', COALESCE(news.original_url, competitor_article.url, site_article.url),
          'relevanceScore', source.relevance_score
        ) ORDER BY source.relevance_score DESC, source.id)
        FROM content_opportunity_sources source
        LEFT JOIN news_items news ON news.id = source.news_item_id
        LEFT JOIN sources news_source ON news_source.id = news.source_id
        LEFT JOIN seo_competitor_articles competitor_article ON competitor_article.id = source.competitor_article_id
        LEFT JOIN seo_competitors competitor ON competitor.id = competitor_article.competitor_id
        LEFT JOIN seo_articles site_article ON site_article.id = source.seo_article_id
        WHERE source.opportunity_id = opportunity.id
      ), '[]'::json) AS sources
    FROM content_opportunities opportunity
    LEFT JOIN editorial_kits kit ON kit.id = opportunity.generated_kit_id
    ORDER BY opportunity.strategic_score DESC, opportunity.updated_at DESC, opportunity.id DESC
    LIMIT 200
  `).all<Record<string, unknown>>();
  return result.results.map(mapOpportunity);
}

export async function getContentOpportunity(db: Database, id: number) {
  const row = await db.prepare("SELECT * FROM content_opportunities WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? mapOpportunity(row) : null;
}

export async function updateContentOpportunityStatus(
  db: Database,
  id: number,
  status: "opportunity" | "postponed",
  reason: string | null = null,
) {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE content_opportunities
    SET status = ?, postponed_reason = ?, last_error = NULL, updated_at = ?
    WHERE id = ? AND generated_kit_id IS NULL
    RETURNING *
  `).bind(status, status === "postponed" ? reason : null, now, id).first<Record<string, unknown>>();
  return result ? mapOpportunity(result) : null;
}

export function priorityFromScore(score: number) {
  if (score >= 85) return "high";
  if (score >= 70) return "good";
  if (score >= 50) return "secondary";
  return "hidden";
}

export function semanticSimilarity(left: string, right: string) {
  const leftTokens = new Set(searchTokens(left));
  const rightTokens = new Set(searchTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / new Set([...leftTokens, ...rightTokens]).size;
}

function inferEvergreenTopic(signal: OpportunitySignal) {
  const text = normalize(`${signal.title} ${signal.topics.join(" ")} ${signal.excerpt}`);
  for (const [key, blueprint] of Object.entries(TOPIC_BLUEPRINTS)) {
    if (blueprint.terms.some((term) => text.includes(term))) return { key, blueprint };
  }
  const meaningfulTopic = signal.topics.map(normalizeTopicKey).find((topic) => topic.length >= 4);
  if (!meaningfulTopic) return null;
  return { key: meaningfulTopic, blueprint: genericBlueprint(signal) };
}

function genericBlueprint(signal: OpportunitySignal) {
  const topic = signal.topics[0] || signal.title;
  const cleanTopic = compact(topic).replace(/[.:;!?]+$/g, "");
  return {
    title: `Guia prático sobre ${cleanTopic.toLocaleLowerCase("pt-BR")}`,
    category: "Logística",
    description: `Conteúdo duradouro para explicar ${cleanTopic.toLocaleLowerCase("pt-BR")} e suas implicações logísticas.`,
    evergreenStrength: 66,
    terms: [] as string[],
  };
}

const TOPIC_BLUEPRINTS: Record<string, {
  title: string;
  category: string;
  description: string;
  evergreenStrength: number;
  terms: string[];
}> = {
  "custos-logisticos": {
    title: "Como reduzir custos logísticos sem comprometer o nível de serviço",
    category: "Gestão Logística",
    description: "Guia sobre os fatores que formam os custos logísticos e as alavancas operacionais para controlá-los.",
    evergreenStrength: 94,
    terms: ["custo logistic", "custos logistic", "preco do frete", "preço do frete", "diesel", "despesa operacional", "despesas operacionais"],
  },
  "transporte-rodoviario": {
    title: "Como funciona o transporte rodoviário de cargas no Brasil",
    category: "Transporte Rodoviário",
    description: "Conteúdo de referência sobre planejamento, contratação, riscos e desempenho no transporte rodoviário.",
    evergreenStrength: 91,
    terms: ["transporte rodovi", "frete rodovi", "rodovia", "caminhao", "caminhão"],
  },
  "logistica-agro": {
    title: "Como planejar a logística do agronegócio do campo ao destino",
    category: "Agronegócio",
    description: "Guia sobre armazenagem, transporte, sazonalidade e escoamento da produção agrícola.",
    evergreenStrength: 93,
    terms: ["safra", "graos", "grãos", "agronegocio", "agronegócio", "fertilizante", "defensivo"],
  },
  "produtos-quimicos": {
    title: "Transporte de produtos químicos: requisitos, riscos e boas práticas",
    category: "Indústria Química",
    description: "Referência técnica sobre segurança, conformidade e planejamento do transporte de produtos químicos.",
    evergreenStrength: 95,
    terms: ["produto quim", "indústria química", "industria quimica", "agroquim", "carga perigosa"],
  },
  "armazenagem": {
    title: "Armazenagem logística: como planejar capacidade, segurança e eficiência",
    category: "Armazenagem",
    description: "Conteúdo sobre decisões de armazenagem, capacidade, movimentação e integração com o transporte.",
    evergreenStrength: 88,
    terms: ["armazen", "estoque", "centro de distribu", "warehouse"],
  },
  "tecnologia-logistica": {
    title: "Tecnologia logística: como aumentar visibilidade e controle operacional",
    category: "Tecnologia",
    description: "Guia sobre rastreamento, integração de dados, automação e torre de controle.",
    evergreenStrength: 87,
    terms: ["torre de controle", "rastreamento", "tecnologia logistic", "automacao", "automação", "inteligencia artificial", "inteligência artificial"],
  },
  "indicadores-logisticos": {
    title: "Indicadores logísticos: quais KPIs acompanhar e como interpretar",
    category: "Gestão Logística",
    description: "Referência prática sobre OTIF, SLA, lead time e indicadores de transporte.",
    evergreenStrength: 96,
    terms: ["otif", "lead time", "sla", "kpi", "indicador logistic", "nivel de servico", "nível de serviço"],
  },
  "logistica-internacional": {
    title: "Logística internacional: modais, riscos e planejamento de cargas",
    category: "Logística Internacional",
    description: "Guia para compreender rotas, modais, custos e riscos nas operações internacionais.",
    evergreenStrength: 83,
    terms: ["porto", "maritimo", "marítimo", "estreito", "exporta", "importa", "aduana", "cabotagem"],
  },
};

function mapOpportunity(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    suggestedTitle: String(row.suggested_title),
    normalizedTopic: String(row.normalized_topic),
    category: String(row.category),
    description: String(row.description ?? ""),
    rationale: String(row.rationale),
    strategicScore: Number(row.strategic_score),
    priority: String(row.priority),
    evergreenScore: Number(row.evergreen_score),
    icpScore: Number(row.icp_score),
    recurrenceScore: Number(row.recurrence_score),
    contentGapScore: Number(row.content_gap_score),
    competitorScore: Number(row.competitor_score),
    googleSignalsScore: row.google_signals_score === null || row.google_signals_score === undefined ? null : Number(row.google_signals_score),
    scoreFactors: parseObject(String(row.score_factors ?? "{}")),
    primaryKeyword: String(row.primary_keyword),
    searchIntent: String(row.search_intent),
    relatedIcps: parseStringArray(String(row.related_icps ?? "[]")),
    status: String(row.effective_status ?? row.status),
    originType: String(row.origin_type),
    sourceCount: Number(row.source_count),
    generatedKitId: row.generated_kit_id === null || row.generated_kit_id === undefined ? null : Number(row.generated_kit_id),
    publishedArticleId: row.published_article_id === null || row.published_article_id === undefined ? null : Number(row.published_article_id),
    postponedReason: row.postponed_reason ? String(row.postponed_reason) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    sources: Array.isArray(row.sources) ? row.sources : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function searchTokens(value: string) {
  return normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
}

function normalizeTopicKey(value: string) {
  return searchTokens(value).slice(0, 5).join("-");
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).map(compact).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const cleaned = compact(value);
    const key = normalize(cleaned);
    if (!cleaned || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(compact);
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

const STOPWORDS = new Set([
  "a", "as", "ao", "aos", "de", "da", "das", "do", "dos", "e", "em", "no", "nos", "na", "nas",
  "o", "os", "para", "por", "que", "com", "como", "uma", "um", "sobre", "mais", "seu", "sua",
]);
