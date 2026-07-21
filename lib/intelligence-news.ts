import { rowsOf, type Database } from "../db/runtime.ts";
import type { IntelligenceNews } from "./editorial-intelligence.ts";

type NewsRow = {
  id: number; title: string; excerpt: string; content_text: string; source_name: string; original_url: string;
  published_at: string; collected_at: string; primary_icp: string; secondary_icps: string; topics: string;
  region: string; logistics_impact: "low" | "medium" | "high"; relevance_score: number; status: string; reliability_score: number;
  editorial_source_id?: number | null; source_type?: string | null; authority_level?: "high" | "medium" | "low" | null;
  primary_or_secondary?: "primary" | "secondary" | "contextual" | null; official_entity?: boolean | null;
  requires_cross_check?: boolean | null; minimum_confirmation_sources?: number | null;
};

export async function loadIntelligenceNews(db: Database, newsId?: number): Promise<IntelligenceNews[]> {
  const filter = newsId ? "WHERE n.id = ?" : "";
  const schema = await db.prepare("SELECT to_regclass('public.editorial_sources') AS editorial_sources").first<{ editorial_sources: string | null }>();
  const governanceFields = schema?.editorial_sources
    ? ", e.id AS editorial_source_id, e.source_type, e.authority_level, e.primary_or_secondary, e.official_entity, e.requires_cross_check, e.minimum_confirmation_sources"
    : ", NULL::integer AS editorial_source_id, NULL::text AS source_type, NULL::text AS authority_level, NULL::text AS primary_or_secondary, FALSE AS official_entity, FALSE AS requires_cross_check, 1 AS minimum_confirmation_sources";
  const governanceJoin = schema?.editorial_sources ? "LEFT JOIN editorial_sources e ON e.operational_source_id = s.id" : "";
  const statement = db.prepare(`SELECT n.id, n.title, n.excerpt, n.content_text, n.source_name, n.original_url, n.published_at, n.collected_at, n.primary_icp, n.secondary_icps, n.topics, n.region, n.logistics_impact, n.relevance_score, n.status, COALESCE(s.reliability_score, 60) AS reliability_score ${governanceFields} FROM news_items n LEFT JOIN sources s ON s.id = n.source_id ${governanceJoin} ${filter} ORDER BY n.published_at DESC LIMIT 500`);
  const result = await (newsId ? statement.bind(newsId) : statement).all<NewsRow>();
  return rowsOf(result).map((row) => ({
    id: row.id, title: row.title, excerpt: row.excerpt, content: row.content_text, sourceName: row.source_name,
    originalUrl: row.original_url, publishedAt: row.published_at, collectedAt: row.collected_at, primaryIcp: row.primary_icp,
    secondaryIcps: parseStringArray(row.secondary_icps), topics: parseStringArray(row.topics), region: row.region,
    logisticsImpact: row.logistics_impact, relevanceScore: row.relevance_score, status: row.status, sourceReliability: row.reliability_score,
    editorialSourceId: row.editorial_source_id ?? null, sourceType: row.source_type ?? null,
    sourceAuthorityLevel: row.authority_level ?? null, sourcePrimaryOrSecondary: row.primary_or_secondary ?? null,
    sourceOfficial: Boolean(row.official_entity), sourceRequiresCrossCheck: Boolean(row.requires_cross_check),
    sourceMinimumConfirmationSources: row.minimum_confirmation_sources ?? 1,
  }));
}

function parseStringArray(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}
