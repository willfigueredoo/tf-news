import { getRuntimeDb, rowsOf, type Database } from "../../../db/runtime";
import { parseCsv, toCsv } from "../../../lib/csv";
import { isSafeHttpUrl, sourceImportSchema, sourceInputSchema, sourceUpdateSchema } from "../../../lib/editorial";
import { inspectFeed } from "../../../lib/ingestion";
import { rateLimit } from "../../../lib/api-security";

type SourceRow = {
  id: number; name: string; domain: string; feed_url: string; website_url: string | null;
  reliability_score: number; active: boolean; type: string; status: string; priority: number;
  collection_frequency_minutes: number; language: string; country: string; region: string;
  related_icps: string; notes: string; last_collected_at: string | null; last_success_at: string | null;
  last_failure_at: string | null; last_error: string | null; last_status: string; last_duration_ms: number | null;
  last_http_status: number | null; last_item_count: number; consecutive_failures: number;
  next_collection_at: string | null; archived_at: string | null; total_news_collected: number;
  average_response_ms: number; created_at: string; updated_at: string | null;
};

export async function GET(request: Request) {
  try {
    const db = await getRuntimeDb();
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const result = await db.prepare(`SELECT * FROM sources ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY active DESC, priority DESC, name ASC`).all<SourceRow>();
    const sources = rowsOf(result).map(mapSource);
    if (url.searchParams.get("format") === "csv") {
      return new Response(toCsv(sources as Array<Record<string, unknown>>, [
        { key: "name", label: "name" }, { key: "feedUrl", label: "feedUrl" }, { key: "websiteUrl", label: "websiteUrl" },
        { key: "reliabilityScore", label: "reliabilityScore" }, { key: "priority", label: "priority" },
        { key: "collectionFrequencyMinutes", label: "collectionFrequencyMinutes" }, { key: "language", label: "language" },
        { key: "country", label: "country" }, { key: "region", label: "region" }, { key: "relatedIcps", label: "relatedIcps" },
        { key: "notes", label: "notes" }, { key: "status", label: "status" },
      ]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=tf-news-fontes.csv" } });
    }
    return Response.json({ sources });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "sources-write", 20, 60_000); if (limited) return limited;
  try {
    const raw = await request.json();
    if (raw?.action === "import") return importSources(sourceImportSchema.parse(raw));
    const body = sourceInputSchema.parse(raw);
    if (!isSafeHttpUrl(body.feedUrl) || (body.websiteUrl && !isSafeHttpUrl(body.websiteUrl))) {
      return Response.json({ error: "A URL precisa ser pública e usar HTTP ou HTTPS." }, { status: 400 });
    }
    const test = await inspectFeed(body.feedUrl);
    if (body.action === "test") return Response.json({ test });
    if (!test.valid) return Response.json({ error: test.error ?? "O feed não pôde ser validado.", test }, { status: 422 });

    const db = await getRuntimeDb();
    const source = await saveSource(db, body, test);
    return Response.json({ source, test }, { status: 201 });
  } catch (error) { return routeError(error, 400); }
}

export async function PATCH(request: Request) {
  const limited = rateLimit(request, "sources-update", 60, 60_000); if (limited) return limited;
  try {
    const input = sourceUpdateSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const current = await db.prepare("SELECT * FROM sources WHERE id = ?").bind(input.id).first<SourceRow>();
    if (!current) return Response.json({ error: "Fonte não encontrada." }, { status: 404 });
    const now = new Date().toISOString();

    if (input.action === "activate") {
      await db.prepare("UPDATE sources SET active = TRUE, status = 'active', archived_at = NULL, updated_at = ? WHERE id = ?").bind(now, input.id).run();
    } else if (input.action === "pause") {
      await db.prepare("UPDATE sources SET active = FALSE, status = 'paused', updated_at = ? WHERE id = ?").bind(now, input.id).run();
    } else if (input.action === "archive") {
      await db.prepare("UPDATE sources SET active = FALSE, status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?").bind(now, now, input.id).run();
    } else {
      const merged = sourceInputSchema.parse({
        action: "save", name: input.name ?? current.name, feedUrl: input.feedUrl ?? current.feed_url,
        websiteUrl: input.websiteUrl ?? current.website_url ?? "", reliabilityScore: input.reliabilityScore ?? current.reliability_score,
        priority: input.priority ?? current.priority, collectionFrequencyMinutes: input.collectionFrequencyMinutes ?? current.collection_frequency_minutes,
        language: input.language ?? current.language, country: input.country ?? current.country, region: input.region ?? current.region,
        relatedIcps: input.relatedIcps ?? JSON.parse(current.related_icps), notes: input.notes ?? current.notes,
      });
      if (!isSafeHttpUrl(merged.feedUrl) || (merged.websiteUrl && !isSafeHttpUrl(merged.websiteUrl))) return Response.json({ error: "URL pública inválida." }, { status: 400 });
      if (merged.feedUrl !== current.feed_url) {
        const test = await inspectFeed(merged.feedUrl);
        if (!test.valid) return Response.json({ error: test.error ?? "O novo feed é inválido.", test }, { status: 422 });
      }
      await db.prepare("UPDATE sources SET name = ?, domain = ?, feed_url = ?, website_url = ?, reliability_score = ?, priority = ?, collection_frequency_minutes = ?, language = ?, country = ?, region = ?, related_icps = ?, notes = ?, updated_at = ? WHERE id = ?")
        .bind(merged.name, new URL(merged.feedUrl).hostname, merged.feedUrl, merged.websiteUrl || null, merged.reliabilityScore, merged.priority, merged.collectionFrequencyMinutes, merged.language, merged.country, merged.region, JSON.stringify(merged.relatedIcps), merged.notes, now, input.id).run();
    }
    const updated = await db.prepare("SELECT * FROM sources WHERE id = ?").bind(input.id).first<SourceRow>();
    return Response.json({ source: updated ? mapSource(updated) : null });
  } catch (error) { return routeError(error, 400); }
}

export async function DELETE(request: Request) {
  const limited = rateLimit(request, "sources-delete", 5, 60_000); if (limited) return limited;
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Fonte inválida." }, { status: 400 });
    const db = await getRuntimeDb();
    const source = await db.prepare("SELECT id, archived_at FROM sources WHERE id = ?").bind(id).first<{ id: number; archived_at: string | null }>();
    if (!source) return Response.json({ error: "Fonte não encontrada." }, { status: 404 });
    const references = await db.prepare("SELECT COUNT(*)::int AS total FROM news_items WHERE source_id = ?").bind(id).first<{ total: number }>();
    if ((references?.total ?? 0) > 0) return Response.json({ error: "A fonte possui notícias vinculadas e deve permanecer arquivada." }, { status: 409 });
    if (!source.archived_at) return Response.json({ error: "Arquive a fonte antes da exclusão definitiva." }, { status: 409 });
    await db.prepare("DELETE FROM sources WHERE id = ?").bind(id).run();
    return Response.json({ deleted: true });
  } catch (error) { return routeError(error, 400); }
}

async function saveSource(db: Database, body: ReturnType<typeof sourceInputSchema.parse>, test?: { httpStatus?: number; itemCount?: number; durationMs?: number }) {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO sources (name, domain, feed_url, website_url, reliability_score, active, type, status, priority, collection_frequency_minutes, language, country, region, related_icps, notes, last_status, last_http_status, last_item_count, last_duration_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, TRUE, 'rss', 'active', ?, ?, ?, ?, ?, ?, ?, 'tested', ?, ?, ?, ?, ?) ON CONFLICT(feed_url) DO UPDATE SET name=excluded.name, website_url=excluded.website_url, reliability_score=excluded.reliability_score, priority=excluded.priority, collection_frequency_minutes=excluded.collection_frequency_minutes, language=excluded.language, country=excluded.country, region=excluded.region, related_icps=excluded.related_icps, notes=excluded.notes, active=TRUE, status='active', archived_at=NULL, last_status='tested', last_error=NULL, last_http_status=excluded.last_http_status, last_item_count=excluded.last_item_count, last_duration_ms=excluded.last_duration_ms, updated_at=excluded.updated_at")
    .bind(body.name, new URL(body.feedUrl).hostname, body.feedUrl, body.websiteUrl || null, body.reliabilityScore, body.priority, body.collectionFrequencyMinutes, body.language, body.country, body.region, JSON.stringify(body.relatedIcps), body.notes, test?.httpStatus ?? null, test?.itemCount ?? 0, test?.durationMs ?? null, now, now).run();
  const result = await db.prepare("SELECT * FROM sources WHERE feed_url = ?").bind(body.feedUrl).first<SourceRow>();
  return result ? mapSource(result) : null;
}

async function importSources(input: ReturnType<typeof sourceImportSchema.parse>) {
  const rows = parseCsv(input.csv).slice(0, 20);
  if (!rows.length) return Response.json({ error: "O CSV não possui linhas de dados." }, { status: 400 });
  const db = await getRuntimeDb();
  const errors: Array<{ row: number; error: string }> = [];
  let imported = 0; let duplicates = 0;
  for (const [index, row] of rows.entries()) {
    try {
      const relatedIcps = String(row.relatedIcps ?? "").split(/[|;]/).map((value) => value.trim()).filter(Boolean);
      const parsed = sourceInputSchema.parse({
        action: "save", name: row.name, feedUrl: row.feedUrl, websiteUrl: row.websiteUrl || "",
        reliabilityScore: Number(row.reliabilityScore || 75), priority: Number(row.priority || 50),
        collectionFrequencyMinutes: Number(row.collectionFrequencyMinutes || 720), language: row.language || "pt-BR",
        country: row.country || "BR", region: row.region || "Brasil", relatedIcps, notes: row.notes || "",
      });
      if (!isSafeHttpUrl(parsed.feedUrl)) throw new Error("URL do feed não é pública.");
      const existing = await db.prepare("SELECT id FROM sources WHERE feed_url = ?").bind(parsed.feedUrl).first<{ id: number }>();
      if (existing) { duplicates += 1; continue; }
      const test = await inspectFeed(parsed.feedUrl);
      if (!test.valid) throw new Error(test.error ?? "Feed inválido.");
      await saveSource(db, parsed, test); imported += 1;
    } catch (error) { errors.push({ row: index + 2, error: error instanceof Error ? error.message : "Linha inválida." }); }
  }
  return Response.json({ imported, duplicates, errors, total: rows.length }, { status: errors.length && !imported ? 422 : 200 });
}

function mapSource(row: SourceRow) {
  const health = row.archived_at ? "archived" : !row.active ? "paused" : row.last_status === "never" || row.last_status === "tested" ? "never-tested" : row.consecutive_failures >= 3 ? "failed" : row.consecutive_failures > 0 || (row.last_duration_ms ?? 0) > 10_000 ? "attention" : "healthy";
  return {
    id: row.id, name: row.name, domain: row.domain, feedUrl: row.feed_url, websiteUrl: row.website_url,
    type: row.type, status: row.status, active: row.active, health, reliabilityScore: row.reliability_score,
    priority: row.priority, collectionFrequencyMinutes: row.collection_frequency_minutes, language: row.language,
    country: row.country, region: row.region, relatedIcps: JSON.parse(row.related_icps), notes: row.notes,
    lastCollectedAt: row.last_collected_at, lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at,
    lastError: row.last_error, lastStatus: row.last_status, lastDurationMs: row.last_duration_ms,
    lastHttpStatus: row.last_http_status, lastItemCount: row.last_item_count, consecutiveFailures: row.consecutive_failures,
    nextCollectionAt: row.next_collection_at, archivedAt: row.archived_at, totalNewsCollected: row.total_news_collected,
    averageResponseMs: row.average_response_ms, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function routeError(error: unknown, status = 500) { return Response.json({ error: error instanceof Error ? error.message : "Falha inesperada." }, { status }); }
