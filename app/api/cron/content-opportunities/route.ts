import { getRuntimeDb } from "../../../../db/runtime";
import {
  drainContentOpportunityJobs,
  enqueueContentOpportunityAnalysis,
} from "../../../../lib/content-opportunity-jobs";
import { getAiConfig, getCronSecret } from "../../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const db = await getRuntimeDb();
    const queued = await enqueueContentOpportunityAnalysis(db, "cron");
    const processed = await drainContentOpportunityJobs(db, getAiConfig(), {
      maxBatches: 2,
      deadlineMs: 52_000,
    });
    return Response.json({ queued, processed });
  } catch (error) {
    const message = safeError(error);
    console.error("[content-opportunity-cron]", message);
    return Response.json({
      error: "A atualização agendada da Central de Conteúdos não foi concluída.",
    }, { status: 500 });
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na análise evergreen.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
