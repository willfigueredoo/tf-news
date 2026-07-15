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

const channelContentSchema = z.object({
  title: z.string().min(5).max(220),
  content: z.string().min(20).max(30_000),
});

export const editorialKitPayloadSchema = z.object({
  strategicIntelligence: z.object({
    eventSummary: z.string().min(30).max(1800),
    whyItMatters: z.string().min(30).max(1800),
    commercialImpact: z.string().min(30).max(1800),
    logisticsImpact: z.string().min(30).max(1800),
    recommendedAngle: z.string().min(20).max(1000),
    audience: z.string().min(5).max(300),
    factualWarnings: z.array(z.string().min(5).max(500)).max(12),
  }),
  blogSeo: z.object({
    seoTitle: z.string().min(10).max(70),
    metaDescription: z.string().min(30).max(170),
    slug: z.string().min(3).max(140),
    introduction: z.string().min(80).max(3000),
    sections: z.array(z.object({
      heading: z.string().min(5).max(180),
      level: z.enum(["h2", "h3"]),
      content: z.string().min(60).max(8000),
    })).min(3).max(12),
    conclusion: z.string().min(60).max(3000),
    cta: z.string().min(10).max(600),
    faq: z.array(z.object({ question: z.string().min(10).max(240), answer: z.string().min(20).max(1200) })).min(2).max(8),
    faqSchema: z.string().min(20).max(15_000),
    category: z.string().min(2).max(100),
    tags: z.array(z.string().min(2).max(80)).min(1).max(15),
    html: z.string().min(300).max(100_000),
    markdown: z.string().min(300).max(100_000),
  }),
  whatsapp: channelContentSchema,
  linkedin: channelContentSchema,
  newsletter: channelContentSchema,
  reels: z.object({
    hook: z.string().min(10).max(300),
    scenes: z.array(z.string().min(10).max(700)).min(3).max(12),
    caption: z.string().min(20).max(2200),
  }),
  imagePrompt: z.string().min(30).max(2000),
  sources: z.array(z.object({ name: z.string().min(2).max(180), url: z.string().url() })).min(1).max(20),
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
