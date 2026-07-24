export type SeoModuleState =
  | "not_configured"
  | "awaiting_first_sync"
  | "syncing"
  | "analysis_pending"
  | "sync_error"
  | "gemini_unavailable"
  | "ready";

export interface SeoSource {
  id: number;
  sourceType: "wordpress_rest" | "sitemap" | "rss" | string;
  url: string;
  status: string;
  priority: number;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

export interface SeoSite {
  id: number;
  name: string;
  domain: string;
  blogUrl: string;
  wordpressApiUrl: string | null;
  sitemapUrl: string | null;
  rssUrl: string | null;
  status: string;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  articlesFound: number;
  articlesSynced: number;
  discoveryMethod: string;
  sources: SeoSource[];
}

export interface AuthorityContribution {
  id: "google-signals" | "gemini-ai" | "tf-news-engine";
  label: string;
  status: "available" | "not_connected" | "pending";
  score: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  description: string;
}

export interface SeoAiAnalysis {
  id: number;
  operation: string;
  provider: string;
  model: string;
  status: string;
  confidence: number | null;
  payload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorityScore {
  value: number;
  previousValue: number | null;
  evolution: number | null;
  confidence: number;
  updatedAt: string;
  contributions: AuthorityContribution[];
  positiveFactors: string[];
  negativeFactors: string[];
  metrics: Record<string, number | string | null>;
  sourceStates: Record<string, string>;
  summary: string | null;
  analysis: SeoAiAnalysis | null;
  history: Array<{ score: number; calculatedAt: string }>;
  methodology: string;
}

export interface Competitor {
  id: number;
  name: string;
  domain: string;
  contentUrl: string | null;
  sitemapUrl: string | null;
  rssUrl: string | null;
  active: boolean;
  notes: string;
  lastSyncAt: string | null;
  syncStatus: string;
  lastError: string | null;
  discoveredAt: string | null;
  articleCount: number;
  articlesLast30Days: number;
  lastPublishedAt: string | null;
  sources: SeoSource[];
  analysis: SeoAiAnalysis | null;
}

export interface CompetitorArticle {
  id: number;
  competitorId: number;
  title: string;
  url: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  excerpt: string;
  topics: string[];
  collectionMethod: string;
}

export type SeoPriority = "high" | "medium" | "low";
export type SeoPotential = "very_high" | "high" | "moderate";
export type SeoOpportunityStatus =
  | "new"
  | "reviewed"
  | "accepted"
  | "discarded"
  | "in_production"
  | "converted_to_kit"
  | "expired";

export interface SeoOpportunity {
  id: number;
  title: string;
  topic: string;
  icp: string;
  priority: SeoPriority;
  seoPotential: SeoPotential;
  confidence: number;
  reasons: string[];
  signalOrigins: string[];
  competitorIds: number[];
  newsIds: number[];
  siteArticleIds: number[];
  suggestedAngle: string | null;
  status: SeoOpportunityStatus;
  validUntil: string;
  editorialQueueId: number | null;
  editorialKitId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeoSyncRun {
  id: number;
  scope: string;
  targetId: number | null;
  trigger: string;
  status: string;
  method: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  found: number;
  inserted: number;
  updated: number;
  ignored: number;
  unavailable: number;
  errors: number;
  errorMessage: string | null;
}

export interface SeoIntelligenceSnapshot {
  state: SeoModuleState;
  site: SeoSite | null;
  authority: AuthorityScore | null;
  competitors: Competitor[];
  competitorArticles: CompetitorArticle[];
  opportunities: SeoOpportunity[];
  syncRuns: SeoSyncRun[];
  ai: { configured: boolean; provider: string; model: string };
  google: { searchConsole: "not_connected"; analytics4: "not_connected" };
}

export interface DiscoveredSeoSource {
  sourceType: "wordpress_rest" | "sitemap" | "rss";
  url: string;
  valid: boolean;
  itemCount: number;
  detail: string;
}

export type SeoApiAction =
  | { action: "sync_site" }
  | { action: "refresh_intelligence"; forceAi: boolean }
  | { action: "update_site"; name: string; domain: string; blogUrl: string; wordpressApiUrl?: string | null; sitemapUrl?: string | null; rssUrl?: string | null }
  | { action: "discover_competitor"; name: string; domain: string; contentUrl?: string | null; sitemapUrl?: string | null; rssUrl?: string | null }
  | { action: "save_competitor"; name: string; domain: string; contentUrl?: string | null; notes: string; sources: Array<{ sourceType: "wordpress_rest" | "sitemap" | "rss"; url: string }> }
  | { action: "sync_competitor"; competitorId: number }
  | { action: "analyze_competitor"; competitorId: number; force: boolean }
  | { action: "update_competitor"; competitorId: number; name?: string; notes?: string; active?: boolean }
  | { action: "delete_competitor"; competitorId: number; confirmation: "delete_competitor" }
  | { action: "opportunity"; opportunityId: number; operation: "review" | "discard" | "reanalyze" | "create_queue" | "generate_kit" };
