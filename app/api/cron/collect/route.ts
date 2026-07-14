import { getRuntimeDb } from "../../../../db/runtime";
import { collectAllSources } from "../../../../lib/ingestion";
import { getAiConfig, getCronSecret } from "../../../../lib/runtime-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const db = await getRuntimeDb();
    const result = await collectAllSources(db, getAiConfig());
    return Response.json(result, { status: result.locked ? 409 : 200 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha no agendamento." }, { status: 500 }); }
}
