import { getRuntimeDb } from "../../../db/runtime";

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const schema = await db.prepare(`
      SELECT to_regclass('public.sources') AS sources,
        to_regclass('public.news_items') AS news_items,
        to_regclass('public.news_item_history') AS news_item_history,
        to_regclass('public.editorial_kits') AS editorial_kits,
        to_regclass('public.editorial_queue') AS editorial_queue,
        to_regclass('public.editorial_sources') AS editorial_sources,
        to_regclass('public.editorial_kit_sources') AS editorial_kit_sources,
        to_regclass('public.strategic_accounts') AS strategic_accounts,
        to_regclass('public.job_logs') AS job_logs,
        to_regclass('public.reel_ideas') AS reel_ideas,
        to_regclass('public.reel_idea_sources') AS reel_idea_sources,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'reel_ideas'
            AND column_name = 'relevance_breakdown'
        ) AS reel_ideas_automation
    `).first<Record<string, string | boolean | null>>();
    const missing = Object.entries(schema ?? {})
      .filter(([, value]) => !value)
      .map(([table]) => table);
    if (!schema || missing.length) {
      return Response.json({ status: "not_ready", database: "schema_pending", missing }, { status: 503 });
    }
    return Response.json({ status: "ready", database: "connected", schema: "current" });
  } catch (error) {
    return Response.json({ status: "not_ready", error: error instanceof Error ? error.message : "Database unavailable" }, { status: 503 });
  }
}
