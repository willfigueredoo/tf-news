import { ZodError } from "zod";
import { getRuntimeDb } from "../../../db/runtime";
import { AiProviderRequestError, aiConfigured } from "../../../lib/ai";
import { rateLimit } from "../../../lib/api-security";
import {
  ReelIdeaConflictError,
  discoverNextReelIdea,
  generateReelIdea,
  getReelIdea,
  listReelIdeas,
  reelIdeaActionSchema,
  reelIdeaUpdateSchema,
  updateReelIdeaWorkflow,
} from "../../../lib/reel-ideas";
import { getAiConfig } from "../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = positiveInteger(url.searchParams.get("id"));
    const db = await getRuntimeDb();
    if (id) {
      const idea = await getReelIdea(db, id);
      if (!idea) return Response.json({ error: "Ideia não encontrada." }, { status: 404 });
      return Response.json({ idea }, { headers: noStoreHeaders() });
    }
    const ideas = await listReelIdeas(db, url.searchParams.get("includeArchived") === "true");
    const config = getAiConfig();
    return Response.json({ ideas, aiConfigured: aiConfigured(config) }, { headers: noStoreHeaders() });
  } catch (error) {
    return reelIdeaError(error);
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "reel-ideas-generate", 12, 60_000);
  if (limited) return limited;
  try {
    const input = reelIdeaActionSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const config = getAiConfig();
    if (!aiConfigured(config)) return Response.json({ error: "A IA ainda não está configurada.", code: "ai_not_configured" }, { status: 503 });
    const idea = input.action === "discover"
      ? await discoverNextReelIdea(db, config)
      : await generateReelIdea(db, config, input.newsId, input.origin);
    return Response.json({ idea }, { status: 201 });
  } catch (error) {
    return reelIdeaError(error);
  }
}

export async function PATCH(request: Request) {
  const limited = rateLimit(request, "reel-ideas-update", 60, 60_000);
  if (limited) return limited;
  try {
    const input = reelIdeaUpdateSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const idea = await updateReelIdeaWorkflow(db, input);
    if (!idea) return Response.json({ error: "Ideia não encontrada." }, { status: 404 });
    return Response.json({ idea });
  } catch (error) {
    return reelIdeaError(error);
  }
}

function reelIdeaError(error: unknown) {
  if (error instanceof ReelIdeaConflictError) {
    return Response.json({ error: error.message, code: "idea_exists", ideaId: error.ideaId }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "A solicitação da ideia para Reels é inválida.", code: "validation_failed" }, { status: 400 });
  }
  if (error instanceof AiProviderRequestError) {
    console.error("[reel-ideas-ai]", JSON.stringify({
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
      providerStatus: error.providerStatus,
      message: error.message,
      details: error.details,
    }));
    return Response.json({
      error: "A IA não conseguiu preparar esta ideia agora. Nenhum conteúdo parcial foi salvo.",
      code: "ai_provider_error",
    }, { status: error.httpStatus === 429 ? 503 : 502 });
  }
  const message = safeError(error);
  const schemaPending = /relation\s+["']?(?:reel_ideas|reel_idea_sources)["']?\s+does not exist|undefined_table/i.test(message);
  console.error("[reel-ideas]", message);
  return Response.json({
    error: schemaPending ? "A migration aditiva do módulo Ideias para Reels ainda não foi aplicada." : message,
    code: schemaPending ? "schema_pending" : "request_failed",
  }, { status: schemaPending ? 503 : 500 });
}

function positiveInteger(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha no módulo Ideias para Reels.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
