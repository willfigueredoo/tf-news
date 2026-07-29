import { ZodError } from "zod";
import { getRuntimeDb } from "../../../db/runtime";
import { AiProviderRequestError, aiConfigured } from "../../../lib/ai";
import { rateLimit } from "../../../lib/api-security";
import {
  getLatestContentOpportunityJob,
  enqueueContentOpportunityAnalysis,
  processNextContentOpportunityBatch,
} from "../../../lib/content-opportunity-jobs";
import { contentOpportunityActionSchema } from "../../../lib/content-opportunity-schemas";
import {
  getContentOpportunity,
  listContentOpportunities,
  updateContentOpportunityStatus,
} from "../../../lib/content-opportunities";
import {
  ContentOpportunityConflictError,
  generateKitForContentOpportunity,
} from "../../../lib/content-opportunity-workflow";
import { getAiConfig } from "../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const [opportunities, job] = await Promise.all([
      listContentOpportunities(db),
      getLatestContentOpportunityJob(db),
    ]);
    const config = getAiConfig();
    return Response.json({
      opportunities,
      job,
      aiConfigured: aiConfigured(config),
      googleSignalsConnected: false,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return contentOpportunityError(error);
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "content-opportunities", 30, 60_000);
  if (limited) return limited;
  try {
    const input = contentOpportunityActionSchema.parse(await request.json());
    const db = await getRuntimeDb();
    if (input.action === "start_analysis") {
      const job = await enqueueContentOpportunityAnalysis(db, "manual");
      return Response.json({ job }, { status: job.status === "completed" ? 200 : 202 });
    }
    if (input.action === "process_job") {
      const job = await processNextContentOpportunityBatch(db, getAiConfig(), {
        jobId: input.jobId,
      });
      return Response.json({ job });
    }
    if (input.action === "postpone") {
      const opportunity = await updateContentOpportunityStatus(
        db,
        input.opportunityId,
        "postponed",
        input.reason ?? null,
      );
      if (!opportunity) {
        return Response.json({ error: "Oportunidade não encontrada ou já vinculada a um Kit." }, { status: 404 });
      }
      return Response.json({ opportunity });
    }
    if (input.action === "restore") {
      const opportunity = await updateContentOpportunityStatus(
        db,
        input.opportunityId,
        "opportunity",
      );
      if (!opportunity) {
        return Response.json({ error: "Oportunidade não encontrada ou já vinculada a um Kit." }, { status: 404 });
      }
      return Response.json({ opportunity });
    }
    const existing = await getContentOpportunity(db, input.opportunityId);
    if (!existing) return Response.json({ error: "Oportunidade não encontrada." }, { status: 404 });
    const generated = await generateKitForContentOpportunity(db, input.opportunityId);
    return Response.json(generated, { status: 201 });
  } catch (error) {
    return contentOpportunityError(error);
  }
}

function contentOpportunityError(error: unknown) {
  if (error instanceof ContentOpportunityConflictError) {
    return Response.json({
      error: error.message,
      code: error.code,
      opportunityId: error.opportunityId,
      kitId: error.kitId,
    }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "A solicitação da Central de Conteúdos é inválida.", code: "validation_failed" }, { status: 400 });
  }
  if (error instanceof AiProviderRequestError) {
    console.error("[content-opportunities-ai]", JSON.stringify({
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
      providerStatus: error.providerStatus,
      message: error.message,
      details: error.details,
    }));
    return Response.json({
      error: "O Gemini não conseguiu concluir esta etapa agora. Nenhuma informação parcial foi salva.",
      code: "ai_provider_error",
    }, { status: error.httpStatus === 429 ? 503 : 502 });
  }
  const message = safeError(error);
  const schemaPending = /relation\s+["']?(?:content_opportunities|content_opportunity_jobs|content_opportunity_sources)["']?\s+does not exist|undefined_table/i.test(message);
  const timeout = /Timeout interno da IA|aborted/i.test(message);
  console.error("[content-opportunities]", message);
  return Response.json({
    error: schemaPending
      ? "A migration aditiva da Central de Conteúdos ainda não foi aplicada."
      : timeout
        ? "A análise levou mais tempo que o permitido e será retomada do último lote."
        : message,
    code: schemaPending ? "schema_pending" : timeout ? "ai_timeout" : "request_failed",
  }, { status: schemaPending ? 503 : timeout ? 504 : 500 });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na Central de Conteúdos.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
