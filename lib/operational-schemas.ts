import { z } from "zod";

export const classificationSchema = z.object({
  primaryIcp: z.string().min(2).max(100),
  secondaryIcps: z.array(z.string().min(2).max(100)).max(4),
  topics: z.array(z.string().min(2).max(80)).min(1).max(8),
  region: z.string().min(2).max(80),
  logisticsImpact: z.enum(["low", "medium", "high"]),
  relevanceScore: z.number().int().min(0).max(100),
  reason: z.string().min(20).max(800),
});

export const classificationBatchSchema = z.object({
  items: z.array(z.object({
    externalId: z.string().min(1).max(1000),
    classification: classificationSchema,
  })).min(1).max(30),
});

export const coherenceSchema = z.object({
  coherent: z.boolean(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(20).max(1000),
  sharedEventOrTheme: z.string().min(2).max(300),
  suggestedGroups: z.array(z.object({
    label: z.string().min(2).max(180),
    newsIds: z.array(z.number().int().positive()).min(1),
  })).max(8),
});

export const confirmedFactSchema = z.object({
  fact: z.string().min(10).max(1000),
  sourceName: z.string().min(2).max(160),
  sourceUrl: z.string().url(),
  publishedAt: z.string().min(10).max(40),
});

export const briefPayloadSchema = z.object({
  mainEvent: z.string().min(20).max(1200),
  confirmedFacts: z.array(confirmedFactSchema).min(1).max(20),
  sourceRelationship: z.string().min(20).max(1200),
  primaryIcp: z.string().min(2).max(100),
  secondaryIcps: z.array(z.string().min(2).max(100)).max(4),
  topics: z.array(z.string().min(2).max(80)).min(1).max(10),
  regions: z.array(z.string().min(2).max(80)).min(1).max(8),
  editorialAngle: z.string().min(20).max(1200),
  sectorImpact: z.string().min(20).max(1200),
  logisticsImpact: z.string().min(20).max(1200),
  suggestedTitle: z.string().min(10).max(180),
  alternativeTitles: z.array(z.string().min(10).max(180)).min(2).max(5),
  primaryKeyword: z.string().min(2).max(120),
  structure: z.array(z.string().min(3).max(180)).min(4).max(12),
  cta: z.string().min(10).max(500),
  warnings: z.array(z.string().min(5).max(500)).max(10),
});

export const articlePayloadSchema = z.object({
  title: z.string().min(10).max(180),
  excerpt: z.string().min(30).max(500),
  contentHtml: z.string().min(800).max(100_000),
  metaTitle: z.string().min(10).max(70),
  metaDescription: z.string().min(30).max(170),
  secondaryKeywords: z.array(z.string().min(2).max(80)).max(10),
  category: z.string().min(2).max(100),
  tags: z.array(z.string().min(2).max(80)).max(12),
  qualityScore: z.number().int().min(0).max(100),
  factualConfidence: z.number().min(0).max(1),
});

const editorialSourceSchema = z.object({
  name: z.string().min(2).max(180),
  url: z.string().url(),
  title: z.string().min(2).max(300).nullable().optional(),
  publisher: z.string().min(2).max(180).nullable().optional(),
  sourceId: z.number().int().positive().nullable().optional(),
  sourceType: z.string().min(2).max(80).nullable().optional(),
  primaryOrSecondary: z.enum(["primary", "secondary", "contextual"]).nullable().optional(),
  authorityLevel: z.enum(["high", "medium", "low"]).nullable().optional(),
  publishedAt: z.string().min(10).max(40).nullable().optional(),
});

const editorialSectionRawSchema = z.object({
  type: z.literal("section"),
  heading: z.string().min(1).max(500).refine(isSpecificEditorialHeading, "O H2 deve ser específico para a notícia."),
  content: z.string().min(1).max(10_000).refine(isPlainEditorialText, "O conteúdo do bloco deve ser texto, sem HTML."),
});

const editorialSectionSchema = z.object({
  type: z.literal("section"),
  heading: z.string().min(8).max(120).refine(isSpecificEditorialHeading, "O H2 deve ser específico para a notícia."),
  content: z.string().min(80).max(4_000).refine(isPlainEditorialText, "O conteúdo do bloco deve ser texto, sem HTML."),
});

export const editorialKitRawPayloadSchema = z.object({
  blog: z.object({
    title: z.string().min(1).max(2_000),
    seoTitle: z.string().min(1).max(2_000),
    slug: z.string().min(1).max(2_000),
    metaDescription: z.string().min(1).max(10_000),
    primaryKeyword: z.string().min(1).max(2_000),
    secondaryKeywords: z.array(z.string()).max(100),
    excerpt: z.string().min(1).max(10_000),
    introduction: z.string().min(1).max(10_000).refine(isPlainEditorialText, "A introdução deve ser texto, sem HTML."),
    blocks: z.array(editorialSectionRawSchema).min(4).max(6).refine(hasUniqueHeadings, "Os H2 do artigo não podem ser repetidos."),
    conclusion: z.string().min(1).max(10_000).refine(isPlainEditorialText, "A conclusão deve ser texto, sem HTML."),
    category: z.string().min(1).max(2_000),
    tags: z.array(z.string()).max(100),
    sources: z.array(editorialSourceSchema).min(1).max(20),
  }),
  whatsapp: z.object({
    text: z.string().min(1).max(10_000),
  }),
});

export const editorialKitPayloadSchema = z.object({
  blog: z.object({
    title: z.string().min(10).max(180),
    seoTitle: z.string().min(10).max(70),
    slug: z.string().min(3).max(140),
    metaDescription: z.string().min(80).max(170),
    primaryKeyword: z.string().min(2).max(120),
    secondaryKeywords: z.array(z.string().min(2).max(80)).min(1).max(8),
    excerpt: z.string().min(80).max(500),
    introduction: z.string().min(180).max(1_200).refine((value) => wordCount(value) >= 70 && wordCount(value) <= 110, "A introdução deve ter entre 70 e 110 palavras.").refine(isPlainEditorialText, "A introdução deve ser texto, sem HTML."),
    blocks: z.array(editorialSectionSchema).min(1).max(8).refine(hasUniqueHeadings, "Os H2 do artigo não podem ser repetidos."),
    conclusion: z.string().min(120).max(1_200).refine(isPlainEditorialText, "A conclusão deve ser texto, sem HTML."),
    html: z.string().min(1800).max(20_000).refine(isValidEditorialHtml, "HTML editorial inválido ou inseguro."),
    category: z.string().min(2).max(100),
    tags: z.array(z.string().min(2).max(80)).min(1).max(8),
    sources: z.array(editorialSourceSchema).min(1).max(6),
  }),
  whatsapp: z.object({
    text: z.string().min(400).max(700),
  }),
});

export const editorialKitRequestSchema = z.object({
  newsId: z.number().int().positive(),
});

export const editorialKitDeleteSchema = z.object({
  id: z.number().int().positive(),
  confirmation: z.literal("delete_permanently"),
});

export const editorialKitUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    id: z.number().int().positive(),
    action: z.enum(["archive", "restore", "duplicate"]),
  }),
  z.object({
    id: z.number().int().positive(),
    action: z.literal("save"),
    payload: editorialKitPayloadSchema,
  }),
]);

export type ClassificationPayload = z.infer<typeof classificationSchema>;
export type CoherencePayload = z.infer<typeof coherenceSchema>;
export type BriefPayload = z.infer<typeof briefPayloadSchema>;
export type ArticlePayload = z.infer<typeof articlePayloadSchema>;
export type EditorialKitRawPayload = z.infer<typeof editorialKitRawPayloadSchema>;
export type EditorialKitPayload = z.infer<typeof editorialKitPayloadSchema>;

function isValidEditorialHtml(html: string) {
  return /<p(?:\s|>)/i.test(html)
    && /<\/p>/i.test(html)
    && /<h2(?:\s|>)/i.test(html)
    && /<\/h2>/i.test(html)
    && !/<(?:script|iframe|object|embed|form)\b/i.test(html);
}

function isPlainEditorialText(value: string) {
  return !/<\/?[a-z][^>]*>/i.test(value);
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function isSpecificEditorialHeading(value: string) {
  const normalized = normalizeHeading(value);
  return !["impacto logistico", "impacto no mercado", "oportunidades", "proximos passos"].includes(normalized);
}

function hasUniqueHeadings(blocks: Array<{ heading: string }>) {
  const headings = blocks.map((block) => normalizeHeading(block.heading));
  return new Set(headings).size === headings.length;
}

function normalizeHeading(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}
