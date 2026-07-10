import { getRuntimeDb, rowsOf } from "../../../db/runtime";

type NewsRow = {
  id: number; title: string; original_url: string; source_name: string; published_at: string; collected_at: string;
  excerpt: string; region: string; logistics_impact: "low" | "medium" | "high"; relevance_score: number;
  status: string; topics: string; icps: string; classification_reason: string;
};

export async function GET(request: Request) {
  try {
    const db = await getRuntimeDb();
    const url = new URL(request.url);
    const icp = url.searchParams.get("icp")?.trim();
    const search = url.searchParams.get("q")?.trim();
    const conditions: string[] = [];
    const values: string[] = [];
    if (icp && icp !== "Todos os ICPs") { conditions.push("icps LIKE ?"); values.push(`%${icp}%`); }
    if (search) { conditions.push("(title LIKE ? OR excerpt LIKE ? OR topics LIKE ?)"); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const statement = db.prepare(`SELECT * FROM news_items${where} ORDER BY relevance_score DESC, published_at DESC LIMIT 200`).bind(...values);
    const result = await statement.all<NewsRow>();
    return Response.json({ news: rowsOf(result).map((row: NewsRow) => ({
      id: row.id, title: row.title, originalUrl: row.original_url, sourceName: row.source_name, publishedAt: row.published_at,
      collectedAt: row.collected_at, excerpt: row.excerpt, region: row.region, logisticsImpact: row.logistics_impact,
      relevanceScore: row.relevance_score, status: row.status, topics: JSON.parse(row.topics) as string[], icps: JSON.parse(row.icps) as string[], classificationReason: row.classification_reason,
    })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar notícias.";
    return Response.json({ error: message }, { status: 500 });
  }
}
