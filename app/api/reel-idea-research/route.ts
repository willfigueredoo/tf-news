import { getRuntimeDb } from "../../../db/runtime";
import { rateLimit } from "../../../lib/api-security";
import { getResearchJob } from "../../../lib/reel-idea-research";
import { processNextReadyResearchJob } from "../../../lib/reel-idea-research";
import { getAiConfig } from "../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const limited = rateLimit(request, "reel-idea-research-status", 120, 60_000);
  if (limited) return limited;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Pesquisa inválida." }, { status: 400 });
  try {
    const researchJob = await getResearchJob(await getRuntimeDb(), id);
    if (!researchJob) return Response.json({ error: "Pesquisa não encontrada." }, { status: 404 });
    return Response.json({ researchJob }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("[reel-idea-research-status]", safeError(error));
    return Response.json({ error: "Não foi possível consultar a pesquisa editorial." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "reel-idea-research-finalize", 12, 60_000);
  if (limited) return limited;
  try {
    const body = await request.json() as { id?: unknown };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Pesquisa inválida." }, { status: 400 });
    const result = await processNextReadyResearchJob(await getRuntimeDb(), getAiConfig(), { jobId: id });
    return Response.json(result, { status: result.status === "idle" ? 202 : 200 });
  } catch (error) {
    console.error("[reel-idea-research-finalize]", safeError(error));
    return Response.json({ error: "Não foi possível finalizar a ideia pesquisada." }, { status: 500 });
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha ao consultar pesquisa editorial.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
