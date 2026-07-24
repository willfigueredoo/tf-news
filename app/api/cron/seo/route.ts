import { getRuntimeDb } from "../../../../db/runtime";
import { getAiConfig, getCronSecret } from "../../../../lib/runtime-config";
import { refreshSeoIntelligence } from "../../../../lib/seo-engine";
import {
  drainSeoSyncJobs,
  enqueueAllSeoSyncJobs,
} from "../../../../lib/seo-sync-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const db = await getRuntimeDb();
    const queued = await enqueueAllSeoSyncJobs(db, "automatic");
    const sync = await drainSeoSyncJobs(db, {
      maxBatches: 12,
      deadlineMs: 45_000,
    });
    const intelligence = sync.completedJobs > 0
      ? await refreshSeoIntelligence(db, getAiConfig(), {
        withAi: sync.changed,
        forceAi: false,
      })
      : null;
    return Response.json({ queued, sync, intelligence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na atualização agendada da Inteligência SEO.";
    console.error("[seo-cron]", message.replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]"));
    return Response.json({ error: "A atualização agendada da Inteligência SEO não foi concluída." }, { status: 500 });
  }
}
