import { getRuntimeDb } from "../../../../db/runtime";
import { processNextReadyResearchJob } from "../../../../lib/reel-idea-research";
import { getAiConfig, getCronSecret } from "../../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const result = await processNextReadyResearchJob(await getRuntimeDb(), getAiConfig());
    return Response.json(result);
  } catch (error) {
    console.error("[manus-reel-ideas-worker]", safeError(error));
    return Response.json({ error: "A finalização da pesquisa editorial não foi concluída." }, { status: 500 });
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha no worker de pesquisa editorial.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
