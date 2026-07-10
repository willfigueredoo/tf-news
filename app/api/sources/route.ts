import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { isSafeHttpUrl, sourceInputSchema } from "../../../lib/editorial";

type SourceRow = {
  id: number; name: string; domain: string; feed_url: string; website_url: string | null;
  reliability_score: number; active: number; last_collected_at: string | null; last_error: string | null;
};

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const result = await db.prepare("SELECT * FROM sources ORDER BY active DESC, name ASC").all<SourceRow>();
    return Response.json({ sources: rowsOf(result).map(mapSource) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = sourceInputSchema.parse(await request.json());
    if (!isSafeHttpUrl(body.feedUrl) || (body.websiteUrl && !isSafeHttpUrl(body.websiteUrl))) {
      return Response.json({ error: "A URL precisa ser pública e usar HTTP ou HTTPS." }, { status: 400 });
    }
    const db = await getRuntimeDb();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO sources (name, domain, feed_url, website_url, reliability_score, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(feed_url) DO UPDATE SET name=excluded.name, website_url=excluded.website_url, reliability_score=excluded.reliability_score, active=1")
      .bind(body.name, new URL(body.feedUrl).hostname, body.feedUrl, body.websiteUrl || null, body.reliabilityScore, now).run();
    const result = await db.prepare("SELECT * FROM sources WHERE feed_url = ?").bind(body.feedUrl).first<SourceRow>();
    return Response.json({ source: result ? mapSource(result) : null }, { status: 201 });
  } catch (error) {
    return routeError(error, 400);
  }
}

function mapSource(row: SourceRow) {
  return { id: row.id, name: row.name, domain: row.domain, feedUrl: row.feed_url, websiteUrl: row.website_url, reliabilityScore: row.reliability_score, active: Boolean(row.active), lastCollectedAt: row.last_collected_at, lastError: row.last_error };
}

function routeError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Falha inesperada.";
  return Response.json({ error: message }, { status });
}

