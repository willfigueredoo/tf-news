import { z } from "zod";

export const seoAuthorityAnalysisSchema = z.object({
  qualitativeScore: z.number().int().min(0).max(100),
  summary: z.string().min(80).max(1_500),
  strengths: z.array(z.object({
    title: z.string().min(4).max(120),
    description: z.string().min(20).max(500),
  })).min(1).max(6),
  attentionPoints: z.array(z.object({
    title: z.string().min(4).max(120),
    description: z.string().min(20).max(500),
  })).min(1).max(6),
  recommendations: z.array(z.string().min(15).max(300)).min(1).max(6),
  scoreExplanation: z.string().min(40).max(800),
  confidence: z.number().min(0).max(1),
});

export const seoCompetitorAnalysisSchema = z.object({
  summary: z.string().min(60).max(1_200),
  dominantTopics: z.array(z.string().min(2).max(100)).max(10),
  editorialFrequency: z.string().min(10).max(300),
  contentPatterns: z.array(z.string().min(8).max(300)).max(8),
  apparentPositioning: z.string().min(20).max(600),
  gapsAgainstTransfast: z.array(z.string().min(5).max(200)).max(10),
  unexploredTopics: z.array(z.string().min(2).max(120)).max(10),
  confidence: z.number().min(0).max(1),
});

export const seoOpportunityRankingSchema = z.object({
  items: z.array(z.object({
    candidateKey: z.string().min(2).max(200),
    priority: z.enum(["high", "medium", "low"]),
    seoPotential: z.enum(["very_high", "high", "moderate"]),
    confidence: z.number().int().min(0).max(100),
    reasons: z.array(z.string().min(8).max(300)).min(1).max(6),
    suggestedAngle: z.string().min(15).max(500),
  })).min(1).max(20),
  confidence: z.number().min(0).max(1),
});

export const seoTopicClassificationSchema = z.object({
  items: z.array(z.object({
    externalId: z.string().min(1).max(500),
    topics: z.array(z.string().min(2).max(100)).min(1).max(8),
    icps: z.array(z.string().min(2).max(100)).min(1).max(5),
  })).min(1).max(30),
});

const discoveredSourceSchema = z.object({
  sourceType: z.enum(["wordpress_rest", "sitemap", "rss"]),
  url: z.string().url(),
});

export const seoSiteUpdateSchema = z.object({
  action: z.literal("update_site"),
  name: z.string().trim().min(2).max(120),
  domain: z.string().trim().min(4).max(500),
  blogUrl: z.string().url(),
  wordpressApiUrl: z.string().url().nullable().optional(),
  sitemapUrl: z.string().url().nullable().optional(),
  rssUrl: z.string().url().nullable().optional(),
});

export const seoActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync_site") }),
  z.object({ action: z.literal("refresh_intelligence"), forceAi: z.boolean().default(false) }),
  z.object({
    action: z.literal("discover_competitor"),
    name: z.string().trim().min(2).max(160),
    domain: z.string().trim().min(4).max(500),
    contentUrl: z.string().url().nullable().optional(),
    sitemapUrl: z.string().url().nullable().optional(),
    rssUrl: z.string().url().nullable().optional(),
  }),
  z.object({
    action: z.literal("save_competitor"),
    name: z.string().trim().min(2).max(160),
    domain: z.string().trim().min(4).max(500),
    contentUrl: z.string().url().nullable().optional(),
    notes: z.string().trim().max(2_000).default(""),
    sources: z.array(discoveredSourceSchema).min(1).max(10),
  }),
  z.object({ action: z.literal("sync_competitor"), competitorId: z.number().int().positive() }),
  z.object({ action: z.literal("process_sync_job"), jobId: z.number().int().positive().optional() }),
  z.object({ action: z.literal("analyze_competitor"), competitorId: z.number().int().positive(), force: z.boolean().default(false) }),
  z.object({
    action: z.literal("update_competitor"),
    competitorId: z.number().int().positive(),
    name: z.string().trim().min(2).max(160).optional(),
    notes: z.string().trim().max(2_000).optional(),
    active: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("delete_competitor"),
    competitorId: z.number().int().positive(),
    confirmation: z.literal("delete_competitor"),
  }),
  z.object({
    action: z.literal("opportunity"),
    opportunityId: z.number().int().positive(),
    operation: z.enum(["review", "discard", "reanalyze", "create_queue", "generate_kit"]),
  }),
]);

export type SeoAuthorityAnalysis = z.infer<typeof seoAuthorityAnalysisSchema>;
export type SeoCompetitorAnalysis = z.infer<typeof seoCompetitorAnalysisSchema>;
export type SeoOpportunityRanking = z.infer<typeof seoOpportunityRankingSchema>;
