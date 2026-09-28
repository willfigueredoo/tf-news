import { getRuntimeDb } from "../../../../db/runtime";
import { runReelIdeaAutomation } from "../../../../lib/reel-idea-automation";
import { getAiConfig, getCronSecret, getManusConfig, getReelIdeaAutomationConfig } from "../../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const mode = new URL(request.url).searchParams.get("mode") === "evergreen" ? "evergreen" : "news";
    const result = await runReelIdeaAutomation(
      await getRuntimeDb(),
      getAiConfig(),
      getReelIdeaAutomationConfig(),
      mode,
      { manus: getManusConfig() },
    );
    return Response.json(result, { status: result.status === "locked" ? 409 : 200 });
  } catch (error) {
    const technical = safeError(error);
    console.error("[reel-ideas-cron]", technical);
    return Response.json({
      error: "A atualização automática do Banco de Ideias não foi concluída.",
    }, { status: 500 });
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na automação do Banco de Ideias.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
