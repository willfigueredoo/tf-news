import { z } from "zod";
import { aiConfigured, logAiPhase, runStructuredAi, type AiConfig, type AiPhaseLogger } from "./ai.ts";
import { editorialKitPayloadSchema, type EditorialKitPayload } from "./operational-schemas.ts";
import type { Database } from "../db/runtime.ts";
import type { EditorialDecision } from "./editorial-intelligence.ts";

export const EDITORIAL_KIT_TIMEOUT_MS = 54_000;
export const EDITORIAL_KIT_MAX_OUTPUT_TOKENS = 1_800;

type GenerationOptions = { fetchImpl?: typeof fetch; now?: Date; phaseLogger?: AiPhaseLogger; delayImpl?: (ms: number) => Promise<void> };
type CompatibilityContext = {
  newsId: number;
  title: string;
  primaryIcp: string;
  editorialScore: number;
  createdAt: string;
};

const previousV1KitSchema = z.object({
  blog: z.object({
    title: z.string(),
    seoTitle: z.string(),
    slug: z.string(),
    metaDescription: z.string(),
    primaryKeyword: z.string(),
    secondaryKeywords: z.array(z.string()),
    excerpt: z.string(),
    html: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    sources: z.array(z.object({ name: z.string(), url: z.string().url() })).min(1),
  }).passthrough(),
  whatsapp: z.object({ content: z.string() }).passthrough(),
}).passthrough();

const legacyKitSchema = z.object({
  strategicIntelligence: z.object({ eventSummary: z.string().optional() }).passthrough().optional(),
  blogSeo: z.object({
    seoTitle: z.string(),
    metaDescription: z.string(),
    slug: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    html: z.string(),
  }).passthrough(),
  whatsapp: z.object({ content: z.string() }).passthrough(),
  sources: z.array(z.object({ name: z.string(), url: z.string().url() })).min(1),
}).passthrough();

export async function generateEditorialKit(db: Database, config: AiConfig, decision: EditorialDecision, options: GenerationOptions = {}): Promise<EditorialKitPayload> {
  if (!aiConfigured(config)) throw new Error("Configure o Gemini antes de gerar um Kit Editorial.");
  const response = await runStructuredAi({
    db,
    config: {
      ...config,
      timeoutMs: EDITORIAL_KIT_TIMEOUT_MS,
      maxRetries: 2,
    },
    operation: "editorial-kit",
    schemaName: "tf_news_editorial_kit_minimal_v1",
    schema: editorialKitPayloadSchema,
    system: [
      "Você é o editor do TF News, especializado em logística B2B e inteligência de mercado.",
      "Gere somente os objetos blog e whatsapp definidos no schema, em português do Brasil.",
      "Não gere avaliações, explicações do processo, alternativas de título, FAQ, JSON-LD, metadados extras ou outros canais.",
      "Não invente dados, falas, datas ou relações causais. Use somente os fatos e a fonte fornecidos.",
      "O blog deve ter de 500 a 700 palavras, linguagem jornalística objetiva e HTML semântico compatível com WordPress.",
      "Use introdução, H2 e H3 naturais, contexto, impacto setorial, impacto logístico quando aplicável, pontos de acompanhamento, conclusão e uma seção de fontes.",
      "O WhatsApp deve ter de 400 a 700 caracteres, linguagem humana, resumo do fato, impacto no segmento, conexão logística e CTA comercial discreto.",
      "Não use jargões internos como score, ICP selecionado ou impacto moderado no conteúdo público.",
      "Retorne somente JSON válido que obedeça ao schema solicitado.",
    ].join(" "),
    user: JSON.stringify({
      source: {
        title: decision.title,
        name: decision.sourceName,
        url: decision.originalUrl,
        publishedAt: decision.publishedAt,
        excerpt: decision.excerpt,
        availableContent: decision.content.slice(0, 4_500),
      },
      context: {
        segment: decision.primaryIcp,
        secondarySegments: decision.secondaryIcps,
        topics: decision.topics,
        region: decision.region,
        commercialImpact: decision.commercialImpact,
        logisticsImpact: decision.logisticsReason,
      },
    }),
    maxOutputTokens: EDITORIAL_KIT_MAX_OUTPUT_TOKENS,
    fetchImpl: options.fetchImpl,
    phaseLogger: options.phaseLogger,
    retryPolicy: "high-demand",
    retryDelaysMs: [5_000, 10_000],
    delayImpl: options.delayImpl,
  });

  const sourceIsTraceable = response.data.blog.sources.some((source) => source.url === decision.originalUrl);
  if (!sourceIsTraceable) throw new Error("O Kit Editorial não preservou a fonte original rastreável.");
  return response.data;
}

export async function createEditorialKit(db: Database, config: AiConfig, decision: EditorialDecision, options: GenerationOptions = {}) {
  const started = Date.now();
  const phaseLogger = options.phaseLogger ?? logAiPhase;
  const payload = await generateEditorialKit(db, config, decision, options);
  const now = (options.now ?? new Date()).toISOString();
  phaseLogger({ phase: "persistence_start", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started });
  try {
    const insert = await db.prepare("INSERT INTO editorial_kits (news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?) RETURNING id")
      .bind(decision.id, payload.blog.seoTitle, decision.primaryIcp, decision.editorialScore, config.provider, config.model, JSON.stringify(payload), now, now).run();
    const id = Number(insert.meta.last_row_id);
    if (!id) throw new Error("O Kit Editorial foi gerado, mas não pôde ser salvo na Biblioteca.");
    phaseLogger({ phase: "persistence_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "success" });
    return { id, newsItemId: decision.id, title: payload.blog.seoTitle, primaryIcp: decision.primaryIcp, editorialScore: decision.editorialScore, provider: config.provider, model: config.model, payload, status: "draft", archivedAt: null, createdAt: now, updatedAt: now };
  } catch (error) {
    phaseLogger({ phase: "persistence_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "failed" });
    throw error;
  }
}

export function normalizeEditorialKitPayload(payload: unknown, context: CompatibilityContext): EditorialKitPayload {
  const current = editorialKitPayloadSchema.safeParse(payload);
  if (current.success) return current.data;

  const previousV1 = previousV1KitSchema.safeParse(payload);
  if (previousV1.success) {
    return {
      blog: {
        title: previousV1.data.blog.title,
        seoTitle: previousV1.data.blog.seoTitle,
        slug: previousV1.data.blog.slug,
        metaDescription: previousV1.data.blog.metaDescription,
        primaryKeyword: previousV1.data.blog.primaryKeyword,
        secondaryKeywords: previousV1.data.blog.secondaryKeywords,
        excerpt: previousV1.data.blog.excerpt,
        html: previousV1.data.blog.html,
        category: previousV1.data.blog.category,
        tags: previousV1.data.blog.tags,
        sources: previousV1.data.blog.sources,
      },
      whatsapp: { text: previousV1.data.whatsapp.content },
    };
  }

  const legacy = legacyKitSchema.parse(payload);
  const tags = uniqueTerms(legacy.blogSeo.tags, context.primaryIcp, "logística");
  return {
    blog: {
      title: context.title,
      seoTitle: legacy.blogSeo.seoTitle,
      slug: legacy.blogSeo.slug,
      metaDescription: legacy.blogSeo.metaDescription,
      primaryKeyword: tags[0],
      secondaryKeywords: tags.slice(1),
      excerpt: legacy.strategicIntelligence?.eventSummary || legacy.blogSeo.metaDescription,
      html: legacy.blogSeo.html,
      category: legacy.blogSeo.category,
      tags,
      sources: legacy.sources,
    },
    whatsapp: { text: legacy.whatsapp.content },
  };
}

function uniqueTerms(values: string[], ...fallbacks: string[]) {
  return [...new Set([...values, ...fallbacks].map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}
