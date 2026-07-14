import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { ICP_CATALOG, newsUpdateSchema } from "../../../lib/editorial";

type NewsRow = {
  id: number; title: string; original_url: string; source_id: number; source_name: string; published_at: string; collected_at: string;
  excerpt: string; content_text: string; region: string; logistics_impact: "low" | "medium" | "high"; relevance_score: number;
  status: string; topics: string; icps: string; primary_icp: string; secondary_icps: string; classification_reason: string; classification_method: string;
};

export async function GET(request: Request) {
  try {
    const db = await getRuntimeDb();
    const url = new URL(request.url);
    const includeDiscarded = url.searchParams.get("includeDiscarded") === "true";
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 300)));
    const result = await db.prepare(`SELECT id, title, original_url, source_id, source_name, published_at, collected_at, excerpt, content_text, region, logistics_impact, relevance_score, status, topics, icps, primary_icp, secondary_icps, classification_reason, classification_method FROM news_items ${includeDiscarded ? "" : "WHERE status <> 'discarded'"} ORDER BY relevance_score DESC, published_at DESC LIMIT ?`).bind(limit).all<NewsRow>();
    return Response.json({ news: rowsOf(result).map(mapNews) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao carregar notícias." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  try {
    const input = newsUpdateSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const placeholders = input.newsIds.map(() => "?").join(",");
    const now = new Date().toISOString();
    if (input.action === "setIcp") {
      if (!input.primaryIcp || !ICP_CATALOG.some((icp) => icp.name === input.primaryIcp)) return Response.json({ error: "ICP inválido." }, { status: 400 });
      await db.prepare(`UPDATE news_items SET primary_icp = ?, icps = ?, secondary_icps = '[]', classification_reason = classification_reason || ' Ajuste manual de ICP.', manually_edited_at = ? WHERE id IN (${placeholders})`).bind(input.primaryIcp, JSON.stringify([input.primaryIcp]), now, ...input.newsIds).run();
    } else {
      const status = input.action === "relevant" ? "relevant" : input.action === "discard" ? "discarded" : "new";
      await db.prepare(`UPDATE news_items SET status = ?, manually_edited_at = ? WHERE id IN (${placeholders})`).bind(status, now, ...input.newsIds).run();
    }
    return Response.json({ updated: input.newsIds.length });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao atualizar notícia." }, { status: 400 }); }
}

function mapNews(row: NewsRow) {
  return { id: row.id, title: row.title, originalUrl: row.original_url, sourceId: row.source_id, sourceName: row.source_name, publishedAt: row.published_at, collectedAt: row.collected_at, excerpt: row.excerpt, content: row.content_text, region: row.region, logisticsImpact: row.logistics_impact, relevanceScore: row.relevance_score, status: row.status, topics: JSON.parse(row.topics), icps: JSON.parse(row.icps), primaryIcp: row.primary_icp, secondaryIcps: JSON.parse(row.secondary_icps), classificationReason: row.classification_reason, classificationMethod: row.classification_method };
}
