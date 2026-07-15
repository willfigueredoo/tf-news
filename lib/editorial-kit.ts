import { z } from "zod";
import { aiConfigured, runStructuredAi, type AiConfig } from "./ai.ts";
import { editorialKitPayloadSchema, type EditorialKitPayload } from "./operational-schemas.ts";
import type { Database } from "../db/runtime.ts";
import type { EditorialDecision } from "./editorial-intelligence.ts";

export const EDITORIAL_KIT_TIMEOUT_MS = 42_000;
export const EDITORIAL_KIT_MAX_OUTPUT_TOKENS = 3_600;

type GenerationOptions = { fetchImpl?: typeof fetch; now?: Date };
type CompatibilityContext = {
  newsId: number;
  title: string;
  primaryIcp: string;
  editorialScore: number;
  createdAt: string;
};

const legacyKitSchema = z.object({
  strategicIntelligence: z.object({ eventSummary: z.string().optional() }).passthrough().optional(),
  blogSeo: z.object({
    seoTitle: z.string(),
    metaDescription: z.string(),
    slug: z.string(),
    cta: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    html: z.string(),
  }).passthrough(),
  whatsapp: z.object({ content: z.string() }).passthrough(),
  sources: z.array(z.object({ name: z.string(), url: z.string().url() })).min(1),
}).passthrough();

export async function generateEditorialKit(db: Database, config: AiConfig, decision: EditorialDecision, options: GenerationOptions = {}): Promise<EditorialKitPayload> {
  if (!aiConfigured(config)) throw new Error("Configure o Gemini antes de gerar um Kit Editorial.");
  const generatedAt = (options.now ?? new Date()).toISOString();
  const response = await runStructuredAi({
    db,
    config: {
      ...config,
      timeoutMs: Math.min(config.timeoutMs, EDITORIAL_KIT_TIMEOUT_MS),
      maxRetries: 0,
    },
    operation: "editorial-kit",
    schemaName: "tf_news_editorial_kit_v1",
    schema: editorialKitPayloadSchema,
    system: [
      "Você é o editor-chefe digital do TF News, especializado em logística B2B e inteligência de mercado.",
      "Produza somente um Blog SEO e uma mensagem de WhatsApp Comercial em português do Brasil.",
      "Não gere LinkedIn, newsletter, roteiro de Reels, prompt de imagem nem qualquer outro canal.",
      "Não invente dados, falas, datas ou relações causais. Diferencie fatos, análises e hipóteses.",
      "O artigo deve ter aproximadamente 700 a 1.000 palavras, linguagem jornalística objetiva e HTML semântico compatível com WordPress.",
      "Use introdução, H2 e H3 naturais, contexto, impacto setorial, impacto logístico quando aplicável, pontos de acompanhamento, conclusão, CTA discreto e fontes.",
      "A mensagem de WhatsApp deve ter de 500 a 900 caracteres, soar humana, resumir o fato, explicar o impacto e conectar o tema à logística com CTA comercial discreto.",
      "Não use jargões internos como score, ICP selecionado ou impacto moderado no conteúdo público.",
      "Copie os metadados fornecidos sem alterá-los e retorne somente o JSON que obedece ao schema solicitado.",
    ].join(" "),
    user: JSON.stringify({
      metadata: {
        version: "v1",
        generatedAt,
        newsId: decision.id,
        sourceTitle: decision.title,
        sourceName: decision.sourceName,
        sourceUrl: decision.originalUrl,
        primaryIcp: decision.primaryIcp,
        editorialScore: decision.editorialScore,
      },
      source: {
        title: decision.title,
        name: decision.sourceName,
        url: decision.originalUrl,
        publishedAt: decision.publishedAt,
        excerpt: decision.excerpt,
        availableContent: decision.content.slice(0, 6_000),
      },
      editorialContext: {
        primaryIcp: decision.primaryIcp,
        secondaryIcps: decision.secondaryIcps,
        topics: decision.topics,
        region: decision.region,
        opportunity: decision.opportunity,
        commercialImpact: decision.commercialImpact,
        logisticsReason: decision.logisticsReason,
      },
      requiredChannels: ["blog", "whatsapp"],
    }),
    maxOutputTokens: EDITORIAL_KIT_MAX_OUTPUT_TOKENS,
    fetchImpl: options.fetchImpl,
  });

  const payload = editorialKitPayloadSchema.parse({
    ...response.data,
    metadata: {
      version: "v1",
      generatedAt,
      newsId: decision.id,
      sourceTitle: decision.title,
      sourceName: decision.sourceName,
      sourceUrl: decision.originalUrl,
      primaryIcp: decision.primaryIcp,
      editorialScore: decision.editorialScore,
    },
  });
  const sourceIsTraceable = payload.blog.sources.some((source) => source.url === decision.originalUrl);
  if (!sourceIsTraceable) throw new Error("O Kit Editorial não preservou a fonte original rastreável.");
  return payload;
}

export async function createEditorialKit(db: Database, config: AiConfig, decision: EditorialDecision, options: GenerationOptions = {}) {
  const payload = await generateEditorialKit(db, config, decision, options);
  const now = (options.now ?? new Date()).toISOString();
  const insert = await db.prepare("INSERT INTO editorial_kits (news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?) RETURNING id")
    .bind(decision.id, payload.blog.seoTitle, decision.primaryIcp, decision.editorialScore, config.provider, config.model, JSON.stringify(payload), now, now).run();
  const id = Number(insert.meta.last_row_id);
  if (!id) throw new Error("O Kit Editorial foi gerado, mas não pôde ser salvo na Biblioteca.");
  return { id, newsItemId: decision.id, title: payload.blog.seoTitle, primaryIcp: decision.primaryIcp, editorialScore: decision.editorialScore, provider: config.provider, model: config.model, payload, status: "draft", archivedAt: null, createdAt: now, updatedAt: now };
}

export function normalizeEditorialKitPayload(payload: unknown, context: CompatibilityContext): EditorialKitPayload {
  const current = editorialKitPayloadSchema.safeParse(payload);
  if (current.success) return current.data;

  const legacy = legacyKitSchema.parse(payload);
  const source = legacy.sources[0];
  const tags = uniqueAtLeastTwo(legacy.blogSeo.tags, context.primaryIcp, "logística");
  return {
    metadata: {
      version: "v1",
      generatedAt: context.createdAt,
      newsId: context.newsId,
      sourceTitle: context.title,
      sourceName: source.name,
      sourceUrl: source.url,
      primaryIcp: context.primaryIcp,
      editorialScore: context.editorialScore,
    },
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
      cta: legacy.blogSeo.cta,
      sources: legacy.sources,
    },
    whatsapp: { content: legacy.whatsapp.content },
  };
}

function uniqueAtLeastTwo(values: string[], ...fallbacks: string[]) {
  const unique = [...new Set([...values, ...fallbacks].map((value) => value.trim()).filter(Boolean))];
  return unique.slice(0, Math.max(2, unique.length));
}
