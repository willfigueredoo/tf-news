export interface AuthoritySignal {
  id: "google-signals" | "gemini-ai" | "tf-news-engine";
  label: string;
  score: number;
  weight: number;
  description: string;
}

export interface AuthorityInsight {
  id: string;
  type: "strength" | "opportunity";
  title: string;
  description: string;
}

export interface AuthorityScore {
  value: number;
  weeklyEvolution: number;
  updatedAt: string;
  signals: AuthoritySignal[];
  summary: string;
  insights: AuthorityInsight[];
}

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  articlesLast30Days: number;
  lastPublishedAt: string;
  mainTopics: string[];
  editorialSummary: string;
}

export interface CompetitorArticle {
  id: string;
  competitorId: string;
  title: string;
  url: string;
  publishedAt: string;
  topics: string[];
  excerpt: string;
}

export type SeoPriority = "Alta" | "Média" | "Baixa";
export type SeoPotential = "Muito alto" | "Alto" | "Moderado";

export interface SeoOpportunity {
  id: string;
  title: string;
  icp: string;
  priority: SeoPriority;
  seoPotential: SeoPotential;
  confidence: number;
  detectedAt: string;
  reasons: string[];
  relatedNews: number;
  competitorCoverage: "baixa" | "média" | "alta";
}

export interface SeoIntelligenceSnapshot {
  authority: AuthorityScore;
  competitors: Competitor[];
  competitorArticles: CompetitorArticle[];
  opportunities: SeoOpportunity[];
  unexploredTopics: string[];
}
