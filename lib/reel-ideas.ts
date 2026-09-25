import { z } from "zod";
import type { Database } from "../db/runtime.ts";
import { runStructuredAi, type AiConfig } from "./ai.ts";
import { buildEditorialIntelligence, isValidEditorialInput, type IntelligenceNews } from "./editorial-intelligence.ts";
import { loadIntelligenceNews } from "./intelligence-news.ts";

export const REEL_IDEA_PILLARS = [
  "Inteligência de mercado industrial",
  "Produtividade e eficiência",
  "Tecnologia e futuro da indústria",
  "Supply Chain e gestão de fornecedores",
  "Gestão, liderança e negócios",
  "Logística sob a perspectiva da indústria",
] as const;

export const REEL_IDEA_STATUSES = ["new", "scripting", "review", "approved", "recorded", "archived"] as const;
export const REEL_IDEA_PRIORITIES = ["high", "medium", "low"] as const;

export const reelIdeaPayloadSchema = z.object({
  title: z.string().min(12).max(150),
  summary: z.string().min(80).max(700),
  industryRelevance: z.string().min(60).max(700),
  suggestedAngle: z.string().min(50).max(600),
  suggestedCopy: z.string().min(180).max(1_000),
  primaryPillar: z.enum(REEL_IDEA_PILLARS),
  secondaryPillar: z.enum(REEL_IDEA_PILLARS).nullable(),
  priority: z.enum(REEL_IDEA_PRIORITIES),
});

export const reelIdeaActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), newsId: z.number().int().positive(), origin: z.enum(["monitoring", "executive"]).default("monitoring") }),
  z.object({ action: z.literal("discover") }),
]);

export const reelIdeaUpdateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(REEL_IDEA_STATUSES).optional(),
  priority: z.enum(REEL_IDEA_PRIORITIES).optional(),
  responsible: z.string().trim().max(120).nullable().optional(),
}).strict().refine((value) => value.status !== undefined || value.priority !== undefined || value.responsible !== undefined, "Nenhuma alteração informada.");

export class ReelIdeaConflictError extends Error {
  readonly ideaId: number;

  constructor(ideaId: number) {
    super("Esta notícia já possui uma ideia para Reels.");
    this.name = "ReelIdeaConflictError";
    this.ideaId = ideaId;
  }
}

export async function generateReelIdea(
  db: Database,
  config: AiConfig,
  newsId: number,
  originType: "monitoring" | "executive",
  options: { fetchImpl?: typeof fetch } = {},
) {
  const existing = await db.prepare("SELECT id FROM reel_ideas WHERE news_item_id = ? LIMIT 1").bind(newsId).first<{ id: number }>();
  if (existing) throw new ReelIdeaConflictError(existing.id);
  const news = (await loadIntelligenceNews(db, newsId))[0];
  if (!news || !isValidEditorialInput(news)) throw new Error("A notícia não possui conteúdo e fonte suficientes para criar uma ideia.");
  const decision = buildEditorialIntelligence([news]).newsOfTheDay;
  if (!decision?.produceContent) throw new Error("A notícia não está elegível para uso editorial.");

  const response = await runStructuredAi({
    db,
    config,
    operation: "reel_idea_generation",
    schemaName: "tf_news_reel_idea_v1",
    schema: reelIdeaPayloadSchema,
    system: [
      "Você atua como editor técnico de conteúdo executivo para o CEO da TransFAST.",
      "Transforme a notícia em um insumo informativo para uma social media criar um Reel dirigido à indústria.",
      "Não escreva roteiro, cenas, takes, instruções audiovisuais, legenda final ou orientação de câmera.",
      "A sugestão de copy deve ser um texto-base factual, natural e conciso, não uma fala pronta.",
      "Não invente fatos, números, fontes, projeções ou opiniões políticas.",
      "Atribua dados e afirmações à fonte quando necessário e preserve neutralidade editorial.",
      "Escolha exatamente um dos seis pilares permitidos como principal e, apenas se útil, um pilar secundário diferente.",
      "A abordagem deve explicar qual recorte executivo torna o tema relevante para gestores industriais.",
      "Retorne exclusivamente o JSON solicitado.",
    ].join(" "),
    user: JSON.stringify({
      source: sourceSnapshot(news),
      editorialContext: {
        score: decision.editorialScore,
        reason: decision.decisionReason,
        logisticsImpact: decision.logisticsReason,
        governance: decision.sourceGovernance,
      },
      pillars: REEL_IDEA_PILLARS,
    }),
    maxOutputTokens: 1_000,
    retryPolicy: "high-demand",
    retryDelaysMs: [5_000, 10_000],
    fetchImpl: options.fetchImpl,
    diagnosticContext: { newsId, originType, editorialScore: decision.editorialScore },
  });
  const now = new Date().toISOString();
  const inserted = await db.prepare(`
    WITH inserted_idea AS (
      INSERT INTO reel_ideas (
        news_item_id, title, summary, industry_relevance, suggested_angle, suggested_copy,
        primary_pillar, secondary_pillar, priority, status, origin_type, editorial_score,
        provider, model, request_id, source_snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (news_item_id) DO NOTHING
      RETURNING id
    ), inserted_source AS (
      INSERT INTO reel_idea_sources (reel_idea_id, news_item_id, is_primary, created_at)
      SELECT id, ?, TRUE, ? FROM inserted_idea
      RETURNING reel_idea_id
    )
    SELECT id FROM inserted_idea
  `).bind(
    news.id,
    response.data.title,
    response.data.summary,
    response.data.industryRelevance,
    response.data.suggestedAngle,
    response.data.suggestedCopy,
    response.data.primaryPillar,
    response.data.secondaryPillar,
    response.data.priority,
    originType,
    decision.editorialScore,
    config.provider,
    config.model,
    response.requestId,
    JSON.stringify(sourceSnapshot(news)),
    now,
    now,
    news.id,
    now,
  ).first<{ id: number }>();
  if (!inserted) {
    const conflict = await db.prepare("SELECT id FROM reel_ideas WHERE news_item_id = ? LIMIT 1").bind(news.id).first<{ id: number }>();
    throw new ReelIdeaConflictError(conflict?.id ?? 0);
  }
  return getReelIdea(db, inserted.id);
}

export async function discoverNextReelIdea(db: Database, config: AiConfig, options: { fetchImpl?: typeof fetch } = {}) {
  const [news, existing] = await Promise.all([
    loadIntelligenceNews(db),
    db.prepare("SELECT news_item_id FROM reel_ideas").all<{ news_item_id: number }>(),
  ]);
  const used = new Set(existing.results.map((row) => row.news_item_id));
  const candidate = buildEditorialIntelligence(news).all.find((item) => item.produceContent && item.editorialScore >= 60 && !used.has(item.id));
  if (!candidate) throw new Error("Nenhuma nova notícia elegível foi encontrada para criar uma ideia.");
  return generateReelIdea(db, config, candidate.id, "executive", options);
}

export async function listReelIdeas(db: Database, includeArchived = false) {
  const result = await db.prepare(`${reelIdeaSelect()} ${includeArchived ? "" : "WHERE idea.archived_at IS NULL"} ORDER BY idea.updated_at DESC, idea.id DESC LIMIT 300`).all<Record<string, unknown>>();
  return result.results.map(mapReelIdea);
}

export async function getReelIdea(db: Database, id: number) {
  const row = await db.prepare(`${reelIdeaSelect()} WHERE idea.id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  return row ? mapReelIdea(row) : null;
}

export async function updateReelIdeaWorkflow(
  db: Database,
  input: z.infer<typeof reelIdeaUpdateSchema>,
) {
  const current = await db.prepare("SELECT id, status, priority, responsible FROM reel_ideas WHERE id = ?").bind(input.id).first<{ id: number; status: string; priority: string; responsible: string | null }>();
  if (!current) return null;
  const status = input.status ?? current.status;
  const archivedAt = status === "archived" ? new Date().toISOString() : null;
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE reel_ideas SET status = ?, priority = ?, responsible = ?, archived_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, input.priority ?? current.priority, input.responsible === undefined ? current.responsible : input.responsible, archivedAt, now, input.id).run();
  return getReelIdea(db, input.id);
}

function reelIdeaSelect() {
  return `
    SELECT idea.*, news.title AS news_title, news.original_url, news.source_name,
      news.published_at, news.collected_at, news.excerpt AS news_excerpt,
      news.primary_icp, news.secondary_icps, news.topics, news.region,
      news.logistics_impact, news.relevance_score,
      COALESCE((
        SELECT json_agg(json_build_object(
          'newsId', source_news.id,
          'title', source_news.title,
          'sourceName', source_news.source_name,
          'originalUrl', source_news.original_url,
          'publishedAt', source_news.published_at,
          'isPrimary', relation.is_primary
        ) ORDER BY relation.is_primary DESC, relation.id)
        FROM reel_idea_sources relation
        JOIN news_items source_news ON source_news.id = relation.news_item_id
        WHERE relation.reel_idea_id = idea.id
      ), '[]'::json) AS sources
    FROM reel_ideas idea
    JOIN news_items news ON news.id = idea.news_item_id
  `;
}

function mapReelIdea(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    newsItemId: Number(row.news_item_id),
    title: String(row.title),
    summary: String(row.summary),
    industryRelevance: String(row.industry_relevance),
    suggestedAngle: String(row.suggested_angle),
    suggestedCopy: String(row.suggested_copy),
    primaryPillar: String(row.primary_pillar),
    secondaryPillar: row.secondary_pillar ? String(row.secondary_pillar) : null,
    priority: String(row.priority),
    status: String(row.status),
    originType: String(row.origin_type),
    editorialScore: Number(row.editorial_score),
    responsible: row.responsible ? String(row.responsible) : null,
    provider: String(row.provider),
    model: String(row.model),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    news: {
      title: String(row.news_title),
      originalUrl: String(row.original_url),
      sourceName: String(row.source_name),
      publishedAt: String(row.published_at),
      collectedAt: String(row.collected_at),
      excerpt: String(row.news_excerpt),
      primaryIcp: String(row.primary_icp),
      secondaryIcps: parseList(row.secondary_icps),
      topics: parseList(row.topics),
      region: String(row.region),
      logisticsImpact: String(row.logistics_impact),
      relevanceScore: Number(row.relevance_score),
    },
    sources: Array.isArray(row.sources) ? row.sources : [],
  };
}

function sourceSnapshot(news: IntelligenceNews) {
  return {
    id: news.id,
    title: news.title,
    sourceName: news.sourceName,
    originalUrl: news.originalUrl,
    publishedAt: news.publishedAt,
    excerpt: news.excerpt,
    content: news.content.slice(0, 7_000),
    primaryIcp: news.primaryIcp,
    secondaryIcps: news.secondaryIcps,
    topics: news.topics,
    region: news.region,
    logisticsImpact: news.logisticsImpact,
    relevanceScore: news.relevanceScore,
  };
}

function parseList(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
