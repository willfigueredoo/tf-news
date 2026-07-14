import { getRuntimeDb, rowsOf } from "../../../db/runtime";

type JobRow = { id: number; job_type: string; status: string; started_at: string; finished_at: string | null; processed_items: number; error_message: string | null; metadata: string | null };

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const today = new Date().toISOString().slice(0, 10);
    const [jobs, ai, sourceMetrics, newsMetrics, daily, byIcp, bySource] = await Promise.all([
      db.prepare("SELECT id, job_type, status, started_at, finished_at, processed_items, error_message, metadata FROM job_logs ORDER BY id DESC LIMIT 200").all<JobRow>(),
      db.prepare("SELECT id, operation, provider, model, status, input_tokens, output_tokens, estimated_cost_usd, latency_ms, error_message, created_at FROM ai_usage_logs ORDER BY id DESC LIMIT 100").all<Record<string, unknown>>(),
      db.prepare("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active = TRUE AND archived_at IS NULL)::int AS active, COUNT(*) FILTER (WHERE active = TRUE AND consecutive_failures = 0 AND last_status = 'success')::int AS healthy, COUNT(*) FILTER (WHERE consecutive_failures >= 3)::int AS failed, COALESCE(ROUND(AVG(last_duration_ms))::int, 0) AS average_duration_ms, MAX(last_collected_at) AS last_collection, MIN(next_collection_at) FILTER (WHERE active = TRUE) AS next_collection FROM sources").first<Record<string, unknown>>(),
      db.prepare("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE collected_at >= ?)::int AS collected_today, COUNT(*) FILTER (WHERE status = 'new')::int AS new_items, COUNT(*) FILTER (WHERE relevance_score >= 80)::int AS high_relevance, COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived FROM news_items").bind(today).first<Record<string, unknown>>(),
      db.prepare("SELECT LEFT(collected_at, 10) AS day, COUNT(*)::int AS total FROM news_items GROUP BY LEFT(collected_at, 10) ORDER BY day DESC LIMIT 14").all<Record<string, unknown>>(),
      db.prepare("SELECT primary_icp AS label, COUNT(*)::int AS total FROM news_items GROUP BY primary_icp ORDER BY total DESC LIMIT 12").all<Record<string, unknown>>(),
      db.prepare("SELECT source_name AS label, COUNT(*)::int AS total FROM news_items GROUP BY source_name ORDER BY total DESC LIMIT 12").all<Record<string, unknown>>(),
    ]);
    const collectionRuns = rowsOf(jobs).filter((job) => job.job_type === "collect" || job.job_type === "collect-all").map(mapRun);
    const completed = collectionRuns.filter((run) => run.status === "success");
    const duplicates = collectionRuns.reduce((total, run) => total + run.duplicates, 0);
    return Response.json({
      jobs: rowsOf(jobs), ai: rowsOf(ai), collectionRuns,
      dashboard: {
        sources: sourceMetrics ?? {}, news: newsMetrics ?? {}, duplicates,
        successRate: collectionRuns.length ? Math.round((completed.length / collectionRuns.length) * 100) : 0,
        daily: rowsOf(daily).reverse(), byIcp: rowsOf(byIcp), bySource: rowsOf(bySource),
      },
    });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao consultar logs." }, { status: 500 }); }
}

function mapRun(job: JobRow) {
  const metadata = parseMetadata(job.metadata);
  return {
    id: job.id, type: job.job_type, origin: metadata.trigger ?? (job.job_type === "collect-all" ? "automatic" : "manual"),
    sourceId: metadata.sourceId ?? null, sourceName: metadata.sourceName ?? "Todas as fontes", startedAt: job.started_at,
    finishedAt: job.finished_at, durationMs: Number(metadata.durationMs ?? duration(job.started_at, job.finished_at)), status: job.status,
    found: Number(metadata.found ?? metadata.fetched ?? 0), newItems: Number(metadata.newItems ?? job.processed_items ?? 0),
    duplicates: Number(metadata.duplicates ?? 0), ignored: Number(metadata.ignored ?? 0), errors: job.status === "failed" ? 1 : Number(metadata.failures ?? 0),
    errorMessage: job.error_message, runId: metadata.runId ?? null, details: metadata.results ?? null,
  };
}

function parseMetadata(value: string | null) { try { return value ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; } }
function duration(start: string, finish: string | null) { return finish ? Math.max(0, new Date(finish).getTime() - new Date(start).getTime()) : 0; }
