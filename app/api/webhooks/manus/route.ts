import { getRuntimeDb } from "../../../../db/runtime";
import { ingestManusWebhook } from "../../../../lib/reel-idea-research";
import { manusConfigured, verifyManusWebhook } from "../../../../lib/manus";
import { getManusConfig } from "../../../../lib/runtime-config";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(request: Request) {
  const config = getManusConfig();
  if (!manusConfigured(config)) return Response.json({ error: "Manus não configurado." }, { status: 503 });
  const rawBody = await request.text();
  try {
    const valid = await verifyManusWebhook(config, request.url, rawBody, request.headers);
    if (!valid) return Response.json({ error: "Assinatura inválida." }, { status: 401 });
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const result = await ingestManusWebhook(await getRuntimeDb(), payload);
    return Response.json(result);
  } catch (error) {
    console.error("[manus-webhook]", safeError(error));
    return Response.json({ error: "Evento Manus rejeitado." }, { status: 400 });
  }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha no webhook Manus.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
