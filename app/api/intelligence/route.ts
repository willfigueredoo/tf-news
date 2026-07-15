import { getRuntimeDb, rowsOf, type Database } from "../../../db/runtime";
import { buildEditorialIntelligence, type IntelligenceNews } from "../../../lib/editorial-intelligence";

type NewsRow = {
  id: number; title: string; excerpt: string; content_text: string; source_name: string; original_url: string;
  published_at: string; collected_at: string; primary_icp: string; secondary_icps: string; topics: string;
  region: string; logistics_impact: "low" | "medium" | "high"; relevance_score: number; status: string; reliability_score: number;
};

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const news = await loadIntelligenceNews(db);
    return Response.json(buildEditorialIntelligence(news), { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao calcular a inteligência editorial." }, { status: 500 });
  }
}

export async function loadIntelligenceNews(db: Database, newsId?: number): Promise<IntelligenceNews[]> {
  const filter = newsId ? "WHERE n.id = ?" : "";
  const statement = db.prepare(`SELECT n.id, n.title, n.excerpt, n.content_text, n.source_name, n.original_url, n.published_at, n.collected_at, n.primary_icp, n.secondary_icps, n.topics, n.region, n.logistics_impact, n.relevance_score, n.status, COALESCE(s.reliability_score, 60) AS reliability_score FROM news_items n LEFT JOIN sources s ON s.id = n.source_id ${filter} ORDER BY n.published_at DESC LIMIT 500`);
  const result = await (newsId ? statement.bind(newsId) : statement).all<NewsRow>();
  return rowsOf(result).map((row) => ({
    id: row.id, title: row.title, excerpt: row.excerpt, content: row.content_text, sourceName: row.source_name,
    originalUrl: row.original_url, publishedAt: row.published_at, collectedAt: row.collected_at, primaryIcp: row.primary_icp,
    secondaryIcps: parseStringArray(row.secondary_icps), topics: parseStringArray(row.topics), region: row.region,
    logisticsImpact: row.logistics_impact, relevanceScore: row.relevance_score, status: row.status, sourceReliability: row.reliability_score,
  }));
}

function parseStringArray(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}
