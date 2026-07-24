import { getRuntimeDb } from "../../../../db/runtime";
import { getAiConfig, getCronSecret } from "../../../../lib/runtime-config";
import { refreshSeoIntelligence } from "../../../../lib/seo-engine";
import { syncAllSeoSources } from "../../../../lib/seo-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const db = await getRuntimeDb();
    const sync = await syncAllSeoSources(db, {
      trigger: "automatic",
      maxArticles: 500,
    });
    if (sync.locked) {
      return Response.json({ sync, intelligence: null }, { status: 409 });
    }
    const intelligence = await refreshSeoIntelligence(db, getAiConfig(), {
      withAi: sync.changed,
      forceAi: false,
    });
    return Response.json({ sync, intelligence });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na atualização agendada da Inteligência SEO.";
    console.error("[seo-cron]", message.replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]"));
    return Response.json({ error: "A atualização agendada da Inteligência SEO não foi concluída." }, { status: 500 });
  }
}
