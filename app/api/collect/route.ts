import { getRuntimeDb } from "../../../db/runtime";
import { collectInputSchema } from "../../../lib/editorial";
import { collectSource } from "../../../lib/ingestion";
import { getAiConfig } from "../../../lib/runtime-config";

type SourceRow = { id: number; name: string; feed_url: string; reliability_score: number };

export async function POST(request: Request) {
  try {
    const input = collectInputSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const source = await db.prepare("SELECT id, name, feed_url, reliability_score FROM sources WHERE id = ? AND active = 1").bind(input.sourceId).first<SourceRow>();
    if (!source) return Response.json({ error: "Fonte não encontrada ou inativa." }, { status: 404 });
    return Response.json(await collectSource(db, source, getAiConfig()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha na coleta." }, { status: 400 });
  }
}
