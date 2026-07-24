import { getRuntimeDb } from "../../../db/runtime";
import { rateLimit } from "../../../lib/api-security";
import { getAiConfig } from "../../../lib/runtime-config";
import { refreshSeoIntelligence } from "../../../lib/seo-engine";
import { processNextSeoSyncBatch } from "../../../lib/seo-sync-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const jobs = await db.prepare(`
      SELECT id, scope, target_id, status, processed_items, total_items, updated_at
      FROM seo_sync_jobs
      WHERE status IN ('queued', 'retry')
        OR (status = 'processing' AND lease_expires_at < ?)
      ORDER BY next_run_at, created_at, id
      LIMIT 20
    `).bind(new Date().toISOString()).all<{
      id: number;
      scope: string;
      target_id: number;
      status: string;
      processed_items: number;
      total_items: number | null;
      updated_at: string;
    }>();
    return Response.json({
      jobs: jobs.results.map((job) => ({
        id: job.id,
        scope: job.scope,
        targetId: job.target_id,
        status: job.status,
        processedItems: job.processed_items,
        totalItems: job.total_items,
        updatedAt: job.updated_at,
      })),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return syncWorkerError(error);
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "seo-sync-worker", 90, 60_000);
  if (limited) return limited;
  try {
    const body = await request.json().catch(() => ({})) as { jobId?: unknown };
    const jobId = body.jobId === undefined ? undefined : Number(body.jobId);
    if (jobId !== undefined && (!Number.isInteger(jobId) || jobId <= 0)) {
      return Response.json({ error: "Job de sincronização inválido." }, { status: 400 });
    }
    const db = await getRuntimeDb();
    const job = await processNextSeoSyncBatch(db, { jobId });
    let intelligence = null;
    if (job?.status === "completed" && (job.inserted > 0 || job.updated > 0 || job.unavailable > 0)) {
      intelligence = await refreshSeoIntelligence(db, getAiConfig(), { withAi: false });
    }
    return Response.json({ job, intelligence });
  } catch (error) {
    return syncWorkerError(error);
  }
}

function syncWorkerError(error: unknown) {
  const message = (error instanceof Error ? error.message : "Falha no worker de sincronização.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
  console.error("[seo-sync-worker]", message);
  return Response.json({
    error: "Não foi possível processar este lote agora. O job será retomado automaticamente.",
    code: "sync_batch_failed",
  }, { status: 500 });
}
