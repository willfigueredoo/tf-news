import { getRuntimeDb } from "../../../db/runtime";
import { collectInputSchema } from "../../../lib/editorial";
import { collectSource } from "../../../lib/ingestion";
import { getAiConfig } from "../../../lib/runtime-config";
import { rateLimit } from "../../../lib/api-security";
import { enqueueContentOpportunityAnalysis } from "../../../lib/content-opportunity-jobs";

type SourceRow = { id: number; name: string; feed_url: string; reliability_score: number; collection_frequency_minutes: number };

export async function POST(request: Request) {
  const limited = rateLimit(request, "collect-manual", 10, 300_000); if (limited) return limited;
  try {
    const input = collectInputSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const source = await db.prepare("SELECT id, name, feed_url, reliability_score, collection_frequency_minutes FROM sources WHERE id = ? AND active = TRUE AND archived_at IS NULL").bind(input.sourceId).first<SourceRow>();
    if (!source) return Response.json({ error: "Fonte não encontrada ou inativa." }, { status: 404 });
    const result = await collectSource(db, source, getAiConfig(), { trigger: "manual" });
    if (result.created > 0) {
      try {
        await enqueueContentOpportunityAnalysis(db, "news_sync");
      } catch (error) {
        console.warn("[content-opportunity-enqueue]", error instanceof Error ? error.message : "Falha ao enfileirar análise.");
      }
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha na coleta." }, { status: 400 });
  }
}
