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

export const editorialKitPayloadSchema = z.object({
  metadata: z.object({
    version: z.enum(["v1"]),
    generatedAt: z.string().min(20).max(40),
    newsId: z.number().int().positive(),
    sourceTitle: z.string().min(10).max(500),
    sourceName: z.string().min(2).max(180),
    sourceUrl: z.string().url(),
    primaryIcp: z.string().min(2).max(100),
    editorialScore: z.number().int().min(0).max(100),
  }),
  blog: z.object({
    title: z.string().min(10).max(180),
    seoTitle: z.string().min(10).max(70),
    slug: z.string().min(3).max(140),
    metaDescription: z.string().min(80).max(170),
    primaryKeyword: z.string().min(2).max(120),
    secondaryKeywords: z.array(z.string().min(2).max(80)).min(2).max(10),
    excerpt: z.string().min(80).max(500),
    html: z.string().min(2500).max(30_000),
    category: z.string().min(2).max(100),
    tags: z.array(z.string().min(2).max(80)).min(2).max(12),
    cta: z.string().min(20).max(500),
    sources: z.array(z.object({ name: z.string().min(2).max(180), url: z.string().url() })).min(1).max(10),
  }),
  whatsapp: z.object({
    content: z.string().min(500).max(900),
  }),
});

export const editorialKitRequestSchema = z.object({
  newsId: z.number().int().positive(),
});

export const editorialKitUpdateSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["archive", "restore", "duplicate"]),
});

export type ClassificationPayload = z.infer<typeof classificationSchema>;
export type CoherencePayload = z.infer<typeof coherenceSchema>;
export type BriefPayload = z.infer<typeof briefPayloadSchema>;
export type ArticlePayload = z.infer<typeof articlePayloadSchema>;
export type EditorialKitPayload = z.infer<typeof editorialKitPayloadSchema>;
