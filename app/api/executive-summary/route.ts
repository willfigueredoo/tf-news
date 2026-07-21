import { getRuntimeDb, rowsOf, type Database } from "../../../db/runtime";
import { ICP_CATALOG } from "../../../lib/editorial";
import {
  ALL_ICP_SCOPE,
  EXECUTIVE_HIGH_PRIORITY_THRESHOLD,
  EXECUTIVE_RELEVANT_THRESHOLD,
  evaluateDominance,
  executiveWindows,
  rankExecutiveNews,
  tieBreakApplied,
  type TrendSignal,
} from "../../../lib/executive-summary";
import type { IntelligenceNews } from "../../../lib/editorial-intelligence";

type MetricRow = { analyzed: number; relevant: number; high_priority: number };
type FrequencyRow = { label: string; count: number; total: number };
type TrendRow = { dimension: "icp" | "topic"; label: string; current_count: number; previous_count: number };
type KitRow = { id: number; title: string; status: string; created_at: string; updated_at: string; archived_at: string | null };
type NewsRow = {
  id: number; title: string; excerpt: string; content_text: string; source_name: string; original_url: string;
  published_at: string; collected_at: string; primary_icp: string; secondary_icps: string; topics: string;
  region: string; logistics_impact: "low" | "medium" | "high"; relevance_score: number; status: string; reliability_score: number;
  editorial_source_id: number | null; source_type: string | null; authority_level: "high" | "medium" | "low" | null;
  primary_or_secondary: "primary" | "secondary" | "contextual" | null; official_entity: boolean | null;
  requires_cross_check: boolean | null; minimum_confirmation_sources: number | null;
};

export async function GET(request: Request) {
  const calculatedAt = new Date();
  const requestedIcp = new URL(request.url).searchParams.get("icp")?.trim() || ALL_ICP_SCOPE;
  const validIcp = requestedIcp === ALL_ICP_SCOPE || ICP_CATALOG.some((item) => item.name === requestedIcp);
  if (!validIcp) return Response.json({ error: "O filtro de ICP informado não é válido." }, { status: 400 });

  try {
    const db = await getRuntimeDb();
    const windows = executiveWindows(calculatedAt);
    const [metrics, icps, topics, sources, trends, candidates, lastKit] = await Promise.all([
      loadMetrics(db, requestedIcp, windows.metrics24h),
      loadFrequency(db, "icp", requestedIcp, windows.dominance7d),
      loadFrequency(db, "topic", requestedIcp, windows.dominance7d),
      loadFrequency(db, "source", requestedIcp, windows.dominance7d),
      loadTrendSignals(db, requestedIcp, windows.trendPrevious7d, windows.trendCurrent7d),
      loadCandidates(db, requestedIcp, windows.newsCandidates72h),
      loadLastKit(db),
    ]);
    const ranked = rankExecutiveNews(candidates, trends, calculatedAt);
    const winner = ranked[0] ?? null;
    const dominantIcp = evaluateDominance(icps, icps[0]?.total ?? 0);
    const dominantTopic = evaluateDominance(topics, topics[0]?.total ?? 0);
    const recurringSource = evaluateDominance(sources, sources[0]?.total ?? 0);
    const ageHours = winner ? Math.max(0, (calculatedAt.getTime() - Date.parse(winner.publishedAt)) / 3_600_000) : null;

    return Response.json({
      calculatedAt: calculatedAt.toISOString(),
      scope: { icp: requestedIcp, filtered: requestedIcp !== ALL_ICP_SCOPE },
      periods: {
        analyzed: "últimas 24 horas",
        relevant: "últimas 24 horas",
        highPriority: "últimas 24 horas",
        dominance: "últimos 7 dias",
        trend: "últimos 7 dias comparados aos 7 dias anteriores",
        newsOfTheDay: "candidatas publicadas nas últimas 72 horas",
      },
      kpis: {
        analyzed: Number(metrics?.analyzed ?? 0),
        relevant: Number(metrics?.relevant ?? 0),
        highPriority: Number(metrics?.high_priority ?? 0),
        dominantIcp,
        dominantTopic,
        recurringSource,
      },
      newsOfTheDay: winner ? {
        id: winner.id,
        title: winner.title,
        excerpt: winner.excerpt,
        sourceName: winner.sourceName,
        originalUrl: winner.originalUrl,
        publishedAt: winner.publishedAt,
        primaryIcp: winner.primaryIcp,
        region: winner.region,
        finalScore: winner.finalScore,
        decisionReason: winner.decisionReason,
        opportunity: winner.opportunity,
        commercialImpact: winner.commercialImpact,
        logisticsReason: winner.logisticsReason,
        ranking: winner.ranking,
        readingTimeMinutes: readingTime(winner.content || winner.excerpt),
        displayLabel: ageHours !== null && ageHours > 24 ? "Melhor sinal recente" : "Notícia do Dia",
      } : null,
      topFive: ranked.slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        sourceName: item.sourceName,
        primaryIcp: item.primaryIcp,
        finalScore: item.finalScore,
        opportunity: item.opportunity,
      })),
      decisionMetadata: {
        deterministic: true,
        calculatedAt: calculatedAt.toISOString(),
        universeConsidered: candidates.length,
        temporalWindow: "72 horas",
        scopeIcp: requestedIcp,
        excludedStatuses: ["discarded", "archived"],
        tieBreakApplied: tieBreakApplied(ranked),
      },
      lastKit: lastKit ? {
        id: lastKit.id,
        title: lastKit.title,
        status: lastKit.status,
        createdAt: lastKit.created_at,
        updatedAt: lastKit.updated_at,
        archivedAt: lastKit.archived_at,
        label: "Último Kit gerado no sistema",
      } : null,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao calcular o Painel Executivo." }, { status: 500 });
  }
}

async function loadMetrics(db: Database, icp: string, since: string) {
  return db.prepare(`
    SELECT COUNT(*)::int AS analyzed,
      COUNT(*) FILTER (WHERE n.relevance_score >= ${EXECUTIVE_RELEVANT_THRESHOLD})::int AS relevant,
      COUNT(*) FILTER (WHERE n.relevance_score >= ${EXECUTIVE_HIGH_PRIORITY_THRESHOLD})::int AS high_priority
    FROM news_items n
    WHERE ${activeScope("n")}
  `).bind(since, icp, icp, icp).first<MetricRow>();
}

async function loadFrequency(db: Database, dimension: "icp" | "topic" | "source", icp: string, since: string) {
  const expression = dimension === "icp" ? "n.primary_icp" : dimension === "source" ? "n.source_name" : "topic.value";
  const topicJoin = dimension === "topic" ? "CROSS JOIN LATERAL jsonb_array_elements_text(n.topics::jsonb) AS topic(value)" : "";
  const result = await db.prepare(`
    WITH scoped AS (
      SELECT n.*, COUNT(*) OVER ()::int AS universe_total
      FROM news_items n
      WHERE ${activeScope("n")}
    )
    SELECT ${expression.replaceAll("n.", "scoped.")} AS label, COUNT(*)::int AS count,
      MAX(scoped.universe_total)::int AS total
    FROM scoped
    ${topicJoin.replaceAll("n.", "scoped.")}
    WHERE NULLIF(TRIM(${expression.replaceAll("n.", "scoped.")}), '') IS NOT NULL
    GROUP BY ${expression.replaceAll("n.", "scoped.")}
    ORDER BY count DESC, label ASC
    LIMIT 2
  `).bind(since, icp, icp, icp).all<FrequencyRow>();
  return rowsOf(result).map((row) => ({ label: row.label, count: Number(row.count), total: Number(row.total) }));
}

async function loadTrendSignals(db: Database, icp: string, since: string, currentStart: string): Promise<TrendSignal[]> {
  const result = await db.prepare(`
    WITH scoped AS (
      SELECT n.primary_icp, n.topics, n.published_at
      FROM news_items n
      WHERE ${activeScope("n")}
    ), signals AS (
      SELECT 'icp'::text AS dimension, primary_icp AS label, published_at FROM scoped
      UNION ALL
      SELECT 'topic'::text, topic.value, scoped.published_at
      FROM scoped CROSS JOIN LATERAL jsonb_array_elements_text(scoped.topics::jsonb) AS topic(value)
    )
    SELECT dimension, label,
      COUNT(*) FILTER (WHERE published_at >= ?)::int AS current_count,
      COUNT(*) FILTER (WHERE published_at >= ? AND published_at < ?)::int AS previous_count
    FROM signals
    WHERE NULLIF(TRIM(label), '') IS NOT NULL
    GROUP BY dimension, label
  `).bind(since, icp, icp, icp, currentStart, since, currentStart).all<TrendRow>();
  return rowsOf(result).map((row) => ({
    dimension: row.dimension,
    label: row.label,
    currentCount: Number(row.current_count),
    previousCount: Number(row.previous_count),
  }));
}

async function loadCandidates(db: Database, icp: string, since: string): Promise<IntelligenceNews[]> {
  const result = await db.prepare(`
    SELECT n.id, n.title, n.excerpt, n.content_text, n.source_name, n.original_url,
      n.published_at, n.collected_at, n.primary_icp, n.secondary_icps, n.topics, n.region,
      n.logistics_impact, n.relevance_score, n.status, COALESCE(s.reliability_score, 60) AS reliability_score,
      e.id AS editorial_source_id, e.source_type, e.authority_level, e.primary_or_secondary,
      e.official_entity, e.requires_cross_check, e.minimum_confirmation_sources
    FROM news_items n
    LEFT JOIN sources s ON s.id = n.source_id
    LEFT JOIN LATERAL (
      SELECT source.id, source.source_type, source.authority_level, source.primary_or_secondary,
        source.official_entity, source.requires_cross_check, source.minimum_confirmation_sources
      FROM editorial_sources source
      WHERE source.operational_source_id = s.id
      ORDER BY source.active_for_collection DESC, source.id ASC
      LIMIT 1
    ) e ON TRUE
    WHERE ${activeScope("n")}
    ORDER BY n.published_at DESC, n.id DESC
  `).bind(since, icp, icp, icp).all<NewsRow>();
  return rowsOf(result).map(toIntelligenceNews);
}

async function loadLastKit(db: Database) {
  return db.prepare(`
    SELECT id, title, status, created_at, updated_at, archived_at
    FROM editorial_kits
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).first<KitRow>();
}

function activeScope(alias: string) {
  return `${alias}.published_at >= ?
    AND ${alias}.archived_at IS NULL
    AND ${alias}.status NOT IN ('discarded', 'archived')
    AND (? = '${ALL_ICP_SCOPE}' OR ${alias}.primary_icp = ? OR ${alias}.icps::jsonb @> jsonb_build_array(?::text))`;
}

function toIntelligenceNews(row: NewsRow): IntelligenceNews {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content_text,
    sourceName: row.source_name,
    originalUrl: row.original_url,
    publishedAt: row.published_at,
    collectedAt: row.collected_at,
    primaryIcp: row.primary_icp,
    secondaryIcps: parseArray(row.secondary_icps),
    topics: parseArray(row.topics),
    region: row.region,
    logisticsImpact: row.logistics_impact,
    relevanceScore: row.relevance_score,
    status: row.status,
    sourceReliability: row.reliability_score,
    editorialSourceId: row.editorial_source_id,
    sourceType: row.source_type,
    sourceAuthorityLevel: row.authority_level,
    sourcePrimaryOrSecondary: row.primary_or_secondary,
    sourceOfficial: Boolean(row.official_entity),
    sourceRequiresCrossCheck: Boolean(row.requires_cross_check),
    sourceMinimumConfirmationSources: row.minimum_confirmation_sources ?? 1,
  };
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readingTime(value: string) {
  return Math.max(1, Math.round(value.trim().split(/\s+/).filter(Boolean).length / 210));
}
