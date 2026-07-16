import { z } from "zod";
import { aiConfigured, logAiPhase, runStructuredAi, type AiConfig, type AiPhaseLogger } from "./ai.ts";
import { editorialKitPayloadSchema, editorialKitRawPayloadSchema, type EditorialKitPayload, type EditorialKitRawPayload } from "./operational-schemas.ts";
import { applyPermanentEditorialPolicy, assertEditorialImpartiality, EDITORIAL_TECHNICAL_EDITOR_PROMPT } from "./editorial-policy.ts";
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

const preGutenbergKitSchema = z.object({
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
    sources: z.array(z.object({
      name: z.string(),
      url: z.string().url(),
      title: z.string().nullable().optional(),
      publisher: z.string().nullable().optional(),
      sourceId: z.number().int().positive().nullable().optional(),
      sourceType: z.string().nullable().optional(),
      primaryOrSecondary: z.enum(["primary", "secondary", "contextual"]).nullable().optional(),
      authorityLevel: z.enum(["high", "medium", "low"]).nullable().optional(),
      publishedAt: z.string().nullable().optional(),
    })).min(1),
  }).passthrough(),
  whatsapp: z.object({ text: z.string() }).passthrough(),
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
  const started = Date.now();
  const phaseLogger = options.phaseLogger ?? logAiPhase;
  const response = await runStructuredAi({
    db,
    config: {
      ...config,
      timeoutMs: EDITORIAL_KIT_TIMEOUT_MS,
      maxRetries: 2,
    },
    operation: "editorial-kit",
    schemaName: "tf_news_editorial_kit_gutenberg_v2",
    schema: editorialKitRawPayloadSchema,
    system: [
      EDITORIAL_TECHNICAL_EDITOR_PROMPT,
      "Você atua como Editor Técnico com a competência de um Redator SEO Sênior especializado em conteúdo B2B para logística.",
      "Gere somente os objetos blog e whatsapp definidos no schema, em português do Brasil.",
      "Não gere avaliações, explicações do processo, alternativas de título, FAQ, JSON-LD, metadados extras ou outros canais.",
      "Não invente dados, falas, datas ou relações causais. Use somente os fatos e a fonte fornecidos.",
      "Use exclusivamente a URL original fornecida. Não acrescente fontes ou links que não estejam na entrada.",
      "A seção rastreável de fontes e a nota de transparência serão anexadas pelo sistema; não as invente nem as duplique.",
      "O blog deve ter entre 450 e 550 palavras, com profundidade suficiente para explicar contexto, causas, consequências e impactos sem repetir informações.",
      "Crie uma arquitetura editorial única para esta notícia. Não reutilize uma estrutura fixa.",
      "A introdução deve ter entre 70 e 110 palavras, contextualizar o assunto e não possuir subtítulo.",
      "Crie entre 4 e 6 blocos do tipo section. Cada bloco deve ter um heading H2 próprio, orientado por intenção de busca, e um conteúdo factual com parágrafos curtos.",
      "Não use headings genéricos como Impacto Logístico, Impacto no Mercado, Oportunidades ou Próximos Passos. Os headings devem nascer dos fatos desta notícia.",
      "Quando uma lista melhorar a leitura, represente cada item em uma linha iniciada por hífen. Não inclua HTML nos campos de introdução, blocos ou conclusão.",
      "A conclusão é um campo separado, resume o conteúdo sem repetir a introdução e será renderizada pelo sistema sob o H2 Conclusão.",
      "O título é destinado ao campo nativo do WordPress e nunca deve ser repetido na introdução, nos blocos ou na conclusão.",
      "O campo seoTitle deve ter no máximo 65 caracteres, deixando margem para validação.",
      "A metaDescription deve ter de 120 a 160 caracteres e incluir a palavra-chave principal naturalmente.",
      "O WhatsApp deve ter de 450 a 650 caracteres, linguagem simples e humana, resumo do fato, impacto no segmento, conexão logística natural e CTA discreto, sem tom promocional excessivo.",
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
        logisticsImpactClassification: decision.logisticsImpact,
      },
    }),
    maxOutputTokens: EDITORIAL_KIT_MAX_OUTPUT_TOKENS,
    fetchImpl: options.fetchImpl,
    phaseLogger: options.phaseLogger,
    retryPolicy: "high-demand",
    retryDelaysMs: [5_000, 10_000],
    delayImpl: options.delayImpl,
    diagnosticContext: {
      newsId: decision.id,
      newsTitle: decision.title,
      sourceName: decision.sourceName,
      editorialScore: decision.editorialScore,
    },
  });

  phaseLogger({ phase: "normalization_start", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started });
  const normalized = normalizeGeneratedEditorialKitPayload(response.data);
  normalized.blog.sources = [traceableDecisionSource(decision)];
  normalized.blog.html = applyPermanentEditorialPolicy(normalized.blog.html, normalized.blog.sources);
  assertEditorialImpartiality({ html: normalized.blog.html, whatsapp: normalized.whatsapp.text });
  phaseLogger({ phase: "normalization_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "success" });
  phaseLogger({ phase: "zod_final_validation_start", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started });
  let payload: EditorialKitPayload;
  try {
    payload = editorialKitPayloadSchema.parse(normalized);
    phaseLogger({ phase: "zod_final_validation_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "success" });
  } catch (error) {
    phaseLogger({ phase: "zod_final_validation_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "failed" });
    throw error;
  }

  const sourceIsTraceable = payload.blog.sources.some((source) => source.url === decision.originalUrl);
  if (!sourceIsTraceable) throw new Error("O Kit Editorial não preservou a fonte original rastreável.");
  return payload;
}

export function normalizeGeneratedEditorialKitPayload(payload: EditorialKitRawPayload): EditorialKitPayload {
  const introduction = truncateWordCount(normalizeStructuredText(payload.blog.introduction), 110);
  const blocks = payload.blog.blocks.map((block) => ({
    type: "section" as const,
    heading: truncateWords(block.heading, 120),
    content: normalizeStructuredText(block.content),
  }));
  const conclusion = normalizeStructuredText(payload.blog.conclusion);
  return {
    blog: {
      title: truncateWords(payload.blog.title, 180),
      seoTitle: truncateSeoTitle(payload.blog.seoTitle, 70),
      slug: normalizeSlug(payload.blog.slug, 140),
      metaDescription: truncateProse(payload.blog.metaDescription, 170, 80, payload.blog.primaryKeyword),
      primaryKeyword: truncateWords(payload.blog.primaryKeyword, 120),
      secondaryKeywords: normalizeStringArray(payload.blog.secondaryKeywords, 8, 80),
      excerpt: truncateProse(payload.blog.excerpt, 500, 80),
      introduction,
      blocks,
      conclusion,
      html: buildGutenbergHtml({ introduction, blocks, conclusion }),
      category: truncateWords(payload.blog.category, 100),
      tags: normalizeStringArray(payload.blog.tags, 8, 80),
      sources: uniqueSources(payload.blog.sources, 6),
    },
    whatsapp: {
      text: truncateProse(payload.whatsapp.text, 700, 400),
    },
  };
}

export async function createEditorialKit(db: Database, config: AiConfig, decision: EditorialDecision, options: GenerationOptions = {}) {
  const started = Date.now();
  const phaseLogger = options.phaseLogger ?? logAiPhase;
  const payload = await generateEditorialKit(db, config, decision, options);
  const now = (options.now ?? new Date()).toISOString();
  phaseLogger({ phase: "persistence_start", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started });
  try {
    const source = payload.blog.sources[0];
    const insert = await db.prepare("WITH inserted_kit AS (INSERT INTO editorial_kits (news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?) RETURNING id) INSERT INTO editorial_kit_sources (editorial_kit_id, editorial_source_id, title, url, publisher, primary_or_secondary, authority_level, published_at, created_at) SELECT id, ?, ?, ?, ?, ?, ?, ?, ? FROM inserted_kit RETURNING editorial_kit_id AS id")
      .bind(decision.id, payload.blog.seoTitle, decision.primaryIcp, decision.editorialScore, config.provider, config.model, JSON.stringify(payload), now, now, source.sourceId ?? null, source.title ?? decision.title, source.url, source.publisher ?? source.name, source.primaryOrSecondary ?? "contextual", source.authorityLevel ?? "medium", source.publishedAt ?? decision.publishedAt, now).run();
    const id = Number(insert.meta.last_row_id);
    if (!id) throw new Error("O Kit Editorial foi gerado, mas não pôde ser salvo na Biblioteca.");
    phaseLogger({ phase: "persistence_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "success" });
    return { id, newsItemId: decision.id, title: payload.blog.seoTitle, primaryIcp: decision.primaryIcp, editorialScore: decision.editorialScore, provider: config.provider, model: config.model, payload, status: "draft", archivedAt: null, createdAt: now, updatedAt: now };
  } catch (error) {
    phaseLogger({ phase: "persistence_end", operation: "editorial-kit", provider: config.provider, model: config.model, elapsedMs: Date.now() - started, status: "failed" });
    throw error;
  }
}

export function enforcePermanentEditorialPolicy(payload: EditorialKitPayload): EditorialKitPayload {
  const governed = {
    ...payload,
    blog: {
      ...payload.blog,
      html: applyPermanentEditorialPolicy(buildGutenbergHtml(payload.blog), payload.blog.sources),
    },
  };
  assertEditorialImpartiality({ html: governed.blog.html, whatsapp: governed.whatsapp.text });
  return editorialKitPayloadSchema.parse(governed);
}

export function normalizeEditorialKitPayload(payload: unknown, context: CompatibilityContext): EditorialKitPayload {
  const current = editorialKitPayloadSchema.safeParse(payload);
  if (current.success) return current.data;

  const preGutenberg = preGutenbergKitSchema.safeParse(payload);
  if (preGutenberg.success) return upgradePreGutenbergPayload(preGutenberg.data);

  const previousV1 = previousV1KitSchema.safeParse(payload);
  if (previousV1.success) {
    return upgradePreGutenbergPayload({
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
    });
  }

  const legacy = legacyKitSchema.parse(payload);
  const tags = uniqueTerms(legacy.blogSeo.tags, context.primaryIcp, "logística");
  return upgradePreGutenbergPayload({
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
  });
}

export function buildGutenbergHtml(blog: Pick<EditorialKitPayload["blog"], "introduction" | "blocks" | "conclusion">) {
  const sections = blog.blocks.map((block) => [
    `<h2>${escapeHtml(block.heading)}</h2>`,
    structuredTextToHtml(block.content),
  ].join(""));
  return [
    `<p>${escapeHtml(blog.introduction)}</p>`,
    ...sections,
    "<h2>Conclusão</h2>",
    `<p>${escapeHtml(blog.conclusion)}</p>`,
  ].join("");
}

function upgradePreGutenbergPayload(payload: z.infer<typeof preGutenbergKitSchema>): EditorialKitPayload {
  const structure = deriveGutenbergStructure(payload.blog.html, payload.blog.excerpt);
  return {
    blog: {
      ...payload.blog,
      ...structure,
    },
    whatsapp: { text: payload.whatsapp.text },
  };
}

function deriveGutenbergStructure(html: string, fallback: string) {
  const editorialBody = html
    .replace(/<section\b[^>]*data-tf-news-sources[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<aside\b[^>]*data-tf-news-transparency[^>]*>[\s\S]*?<\/aside>/gi, "")
    .trim();
  const headingPattern = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  const headings = [...editorialBody.matchAll(headingPattern)];
  const introductionEnd = headings[0]?.index ?? editorialBody.length;
  const introduction = htmlFragmentToStructuredText(editorialBody.slice(0, introductionEnd)) || fallback;
  const blocks: EditorialKitPayload["blog"]["blocks"] = [];
  let conclusion = "";

  for (const [index, match] of headings.entries()) {
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = headings[index + 1]?.index ?? editorialBody.length;
    const heading = htmlFragmentToStructuredText(match[1]);
    const content = htmlFragmentToStructuredText(editorialBody.slice(contentStart, contentEnd));
    if (!heading || !content) continue;
    if (normalizeHeading(heading) === "conclusao") conclusion = content;
    else blocks.push({ type: "section", heading, content });
  }

  if (!blocks.length) {
    const content = htmlFragmentToStructuredText(editorialBody) || fallback;
    blocks.push({ type: "section", heading: "Conteúdo principal da notícia", content });
  }

  return {
    introduction,
    blocks: blocks.slice(0, 8),
    conclusion: conclusion || fallback,
  };
}

function structuredTextToHtml(value: string) {
  const chunks = value.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length && lines.every((line) => /^[-•]\s+/.test(line))) {
      const items = lines.map((line) => `<li>${escapeHtml(line.replace(/^[-•]\s+/, ""))}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${escapeHtml(lines.join(" "))}</p>`;
  }).join("");
}

function htmlFragmentToStructuredText(value: string) {
  return value
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/(?:p|ul|ol|h3)>/gi, "\n\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeStructuredText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateWordCount(value: string, maxWords: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return finishSentence(words.slice(0, maxWords).join(" "), Number.MAX_SAFE_INTEGER);
}

function normalizeHeading(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function uniqueTerms(values: string[], ...fallbacks: string[]) {
  return [...new Set([...values, ...fallbacks].map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateWords(value: string, maxLength: number) {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  const words = compact.split(" ");
  const kept: string[] = [];
  for (const word of words) {
    const next = [...kept, word].join(" ");
    if (next.length > maxLength) break;
    kept.push(word);
  }
  return kept.join(" ").trim();
}

function truncateSeoTitle(value: string, maxLength: number) {
  return truncateWords(value, maxLength).replace(/[\s,;:!?./\\|()\[\]{}–—-]+$/gu, "").trim();
}

function truncateProse(value: string, maxLength: number, minLength: number, preferredTerm?: string) {
  const compact = compactText(value);
  if (compact.length <= maxLength) return compact;
  const limited = truncateWords(compact, maxLength);
  const sentence = lastBoundary(limited, /[.!?](?=\s|$)/gu, minLength, true);
  let result = sentence || lastBoundary(limited, /[;,](?=\s|$)/gu, minLength, false) || limited;
  result = finishSentence(result, maxLength);

  const term = compactText(preferredTerm ?? "");
  if (term && compact.toLocaleLowerCase("pt-BR").includes(term.toLocaleLowerCase("pt-BR")) && !result.toLocaleLowerCase("pt-BR").includes(term.toLocaleLowerCase("pt-BR"))) {
    const separator = " — ";
    const available = maxLength - separator.length - term.length;
    if (available >= minLength) result = `${finishSentence(truncateWords(result, available), available).replace(/[.]$/u, "")}${separator}${term}`;
  }
  return result;
}

function lastBoundary(value: string, pattern: RegExp, minLength: number, includeBoundary: boolean) {
  const matches = [...value.matchAll(pattern)];
  const last = matches.at(-1);
  if (!last || last.index === undefined || last.index + 1 < minLength) return "";
  return value.slice(0, last.index + (includeBoundary ? 1 : 0)).trim();
}

function finishSentence(value: string, maxLength: number) {
  const cleaned = value.replace(/[\s,;:–—-]+$/gu, "").trim();
  if (!cleaned || /[.!?]$/u.test(cleaned)) return cleaned;
  if (cleaned.length < maxLength) return `${cleaned}.`;
  const withoutLastWord = cleaned.replace(/\s+\S+$/u, "").trim();
  return withoutLastWord ? `${withoutLastWord}.` : cleaned;
}

function normalizeSlug(value: string, maxLength: number) {
  const words = value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug.replace(/-+$/g, "");
}

function normalizeStringArray(values: string[], maxItems: number, maxItemLength: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = truncateWords(value, maxItemLength);
    const key = normalized.toLocaleLowerCase("pt-BR");
    if (!normalized || seen.has(key)) continue;
    result.push(normalized);
    seen.add(key);
    if (result.length === maxItems) break;
  }
  return result;
}

function uniqueSources(sources: EditorialKitRawPayload["blog"]["sources"], maxItems: number) {
  const result: EditorialKitRawPayload["blog"]["sources"] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    result.push({ ...source, name: truncateWords(source.name, 180), url: source.url });
    seen.add(source.url);
    if (result.length === maxItems) break;
  }
  return result;
}

function traceableDecisionSource(decision: EditorialDecision): EditorialKitPayload["blog"]["sources"][number] {
  return {
    name: decision.sourceName,
    title: decision.title,
    url: decision.originalUrl,
    publisher: decision.sourceName,
    sourceId: decision.editorialSourceId ?? null,
    sourceType: decision.sourceType ?? "not_classified",
    primaryOrSecondary: decision.sourcePrimaryOrSecondary ?? "contextual",
    authorityLevel: decision.sourceAuthorityLevel ?? (decision.sourceReliability >= 85 ? "high" : decision.sourceReliability >= 60 ? "medium" : "low"),
    publishedAt: decision.publishedAt,
  };
}
