import { getRuntimeDb } from "../../../db/runtime";
import { buildEditorialIntelligence } from "../../../lib/editorial-intelligence";
import { loadIntelligenceNews } from "../../../lib/intelligence-news";

export { loadIntelligenceNews } from "../../../lib/intelligence-news";

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const news = await loadIntelligenceNews(db);
    return Response.json(buildEditorialIntelligence(news), { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao calcular a inteligência editorial." }, { status: 500 });
  }
}
