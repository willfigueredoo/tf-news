import { z } from "zod";

export const SOURCE_TYPES = [
  "official", "regulator", "statistical", "research", "institutional", "association", "corporate",
  "press", "sector_press", "international", "market_data", "academic", "operator",
] as const;

export const MONITORING_MODES = ["rss", "atom", "api", "reference", "manual"] as const;
export const AUTHORITY_LEVELS = ["high", "medium", "low"] as const;
export const EDITORIAL_ROLES = ["confirmation", "regulation", "statistics", "research", "context", "operational_alert"] as const;
export const PRIMARY_OR_SECONDARY = ["primary", "secondary", "contextual"] as const;
export const AUTHORITY_PROFILES = ["automatic", "news_agency", "economic_outlet"] as const;

const capabilitiesSchema = z.object({
  regulation: z.boolean().default(false),
  statistics: z.boolean().default(false),
  companyEvents: z.boolean().default(false),
  operationalDisruption: z.boolean().default(false),
  prices: z.boolean().default(false),
  weather: z.boolean().default(false),
  internationalTrade: z.boolean().default(false),
});

const EMPTY_CAPABILITIES = {
  regulation: false,
  statistics: false,
  companyEvents: false,
  operationalDisruption: false,
  prices: false,
  weather: false,
  internationalTrade: false,
};

export const editorialSourceSeedSchema = z.object({
  sourceKey: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  name: z.string().trim().min(2).max(180),
  domain: z.string().trim().toLowerCase().min(4).max(255),
  baseUrl: z.string().url().max(1000),
  feedCandidates: z.array(z.string().url().max(1000)).max(5).default([]),
  category: z.string().trim().min(2).max(120),
  subcategories: z.array(z.string().trim().min(2).max(100)).max(20).default([]),
  authorityLevel: z.enum(AUTHORITY_LEVELS).default("high"),
  authorityProfile: z.enum(AUTHORITY_PROFILES).default("automatic"),
  sourceType: z.enum(SOURCE_TYPES),
  editorialRole: z.enum(EDITORIAL_ROLES),
  primaryOrSecondary: z.enum(PRIMARY_OR_SECONDARY),
  officialEntity: z.boolean().default(false),
  country: z.string().trim().min(2).max(3).default("BR"),
  language: z.string().trim().min(2).max(10).default("pt-BR"),
  preferredMonitoringMode: z.enum(MONITORING_MODES).default("reference"),
  reliability: z.number().int().min(0).max(100).default(85),
  priority: z.number().int().min(0).max(100).default(80),
  updateFrequencyMinutes: z.number().int().min(30).max(43_200).default(720),
  topicsAllowed: z.array(z.string().trim().min(2).max(100)).min(1).max(30),
  topicsRestricted: z.array(z.string().trim().min(2).max(100)).max(20).default([]),
  geographicScope: z.string().trim().min(2).max(120).default("Brasil"),
  relatedIcps: z.array(z.string().trim().min(2).max(100)).max(8).default([]),
  requiresCrossCheck: z.boolean().default(false),
  preferredOriginalSource: z.boolean().default(false),
  paywall: z.enum(["none", "partial", "full"]).default("none"),
  requiresJavascript: z.boolean().default(false),
  sitemapUrl: z.string().url().max(1000).nullable().default(null),
  editorialNotes: z.string().max(2000).default(""),
  biasOrInterestDisclosure: z.string().max(2000).default(""),
  minimumConfirmationSources: z.number().int().min(1).max(5).default(1),
  capabilities: capabilitiesSchema.default(EMPTY_CAPABILITIES),
});

export type EditorialSourceSeed = z.infer<typeof editorialSourceSeedSchema>;
export type SourceType = EditorialSourceSeed["sourceType"];

const BASE_POINTS: Record<SourceType, number> = {
  official: 40,
  regulator: 35,
  statistical: 35,
  research: 25,
  institutional: 25,
  academic: 25,
  international: 25,
  press: 20,
  market_data: 18,
  association: 12,
  corporate: 10,
  sector_press: 10,
  operator: 10,
};

export const SOURCE_AUTHORITY_BASELINE = 50;

export function calculateSourceAuthorityScore(input: {
  sourceType: SourceType;
  authorityProfile?: (typeof AUTHORITY_PROFILES)[number];
  publicationAgeDays?: number;
  hasReferenceDate?: boolean;
  hasAuthor?: boolean;
  opinion?: boolean;
  republishedReleaseWithoutOrigin?: boolean;
  contradictsOfficialSource?: boolean;
}) {
  const basePoints = input.authorityProfile === "economic_outlet"
    ? 18
    : input.authorityProfile === "news_agency"
      ? 20
      : BASE_POINTS[input.sourceType];
  let score = SOURCE_AUTHORITY_BASELINE + basePoints;
  if ((input.publicationAgeDays ?? 0) > 30) score -= 5;
  if (input.hasReferenceDate === false) score -= 15;
  if (input.hasAuthor === false) score -= 20;
  if (input.opinion) score -= 20;
  if (input.republishedReleaseWithoutOrigin) score -= 25;
  if (input.contradictsOfficialSource) score -= 40;
  return Math.max(0, Math.min(100, score));
}

export function isRecentFeedItem(value: string | null | undefined, now = new Date(), maxAgeDays = 180) {
  if (!value) return false;
  const publishedAt = new Date(value);
  if (Number.isNaN(publishedAt.getTime())) return false;
  const ageMs = now.getTime() - publishedAt.getTime();
  return ageMs >= -2 * 86_400_000 && ageMs <= maxAgeDays * 86_400_000;
}

export function sourceEditorialDisposition(score: number) {
  if (score >= 70) return "eligible" as const;
  if (score >= 50) return "cross_check" as const;
  if (score >= 30) return "human_review" as const;
  return "not_recommended" as const;
}

export function defineEditorialSource(input: z.input<typeof editorialSourceSeedSchema>) {
  return editorialSourceSeedSchema.parse(input);
}

export function mergeSeedManagedFields<T extends Record<string, unknown>>(current: T, seed: EditorialSourceSeed) {
  return {
    ...current,
    sourceKey: seed.sourceKey,
    name: seed.name,
    category: seed.category,
    subcategories: seed.subcategories,
    authorityLevel: seed.authorityLevel,
    sourceType: seed.sourceType,
    editorialRole: seed.editorialRole,
    primaryOrSecondary: seed.primaryOrSecondary,
    officialEntity: seed.officialEntity,
    country: seed.country,
    language: seed.language,
    reliability: seed.reliability,
    priority: seed.priority,
    topicsAllowed: seed.topicsAllowed,
    topicsRestricted: seed.topicsRestricted,
    geographicScope: seed.geographicScope,
    relatedIcps: seed.relatedIcps,
    requiresCrossCheck: seed.requiresCrossCheck,
    preferredOriginalSource: seed.preferredOriginalSource,
    biasOrInterestDisclosure: seed.biasOrInterestDisclosure,
    minimumConfirmationSources: seed.minimumConfirmationSources,
    capabilities: seed.capabilities,
  };
}
