import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { isSafeHttpUrl, sourceInputSchema } from "../../../lib/editorial";
import { testFeed } from "../../../lib/ingestion";

type SourceRow = {
  id: number; name: string; domain: string; feed_url: string; website_url: string | null;
  reliability_score: number; active: number; last_collected_at: string | null; last_success_at: string | null;
  last_failure_at: string | null; last_error: string | null; last_status: string; last_duration_ms: number | null;
  last_http_status: number | null; last_item_count: number; consecutive_failures: number;
};

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const result = await db.prepare("SELECT * FROM sources ORDER BY active DESC, name ASC").all<SourceRow>();
    return Response.json({ sources: rowsOf(result).map(mapSource) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const body = sourceInputSchema.parse(await request.json());
    if (!isSafeHttpUrl(body.feedUrl) || (body.websiteUrl && !isSafeHttpUrl(body.websiteUrl))) {
      return Response.json({ error: "A URL precisa ser pública e usar HTTP ou HTTPS." }, { status: 400 });
    }
    const test = await testFeed(body.feedUrl);
    if (body.action === "test") return Response.json({ test });
    const db = await getRuntimeDb();
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO sources (name, domain, feed_url, website_url, reliability_score, last_status, last_http_status, last_item_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'tested', ?, ?, ?, ?) ON CONFLICT(feed_url) DO UPDATE SET name=excluded.name, website_url=excluded.website_url, reliability_score=excluded.reliability_score, active=1, last_status='tested', last_error=NULL, last_http_status=excluded.last_http_status, last_item_count=excluded.last_item_count, updated_at=excluded.updated_at")
      .bind(body.name, new URL(body.feedUrl).hostname, body.feedUrl, body.websiteUrl || null, body.reliabilityScore, test.httpStatus, test.itemCount, now, now).run();
    const result = await db.prepare("SELECT * FROM sources WHERE feed_url = ?").bind(body.feedUrl).first<SourceRow>();
    return Response.json({ source: result ? mapSource(result) : null, test }, { status: 201 });
  } catch (error) { return routeError(error, 400); }
}

function mapSource(row: SourceRow) {
  return {
    id: row.id, name: row.name, domain: row.domain, feedUrl: row.feed_url, websiteUrl: row.website_url,
    reliabilityScore: row.reliability_score, active: Boolean(row.active), lastCollectedAt: row.last_collected_at,
    lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at, lastError: row.last_error,
    lastStatus: row.last_status, lastDurationMs: row.last_duration_ms, lastHttpStatus: row.last_http_status,
    lastItemCount: row.last_item_count, consecutiveFailures: row.consecutive_failures,
  };
}

function routeError(error: unknown, status = 500) { return Response.json({ error: error instanceof Error ? error.message : "Falha inesperada." }, { status }); }
