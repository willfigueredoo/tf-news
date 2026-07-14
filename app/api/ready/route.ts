import { getRuntimeDb } from "../../../db/runtime";

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const schema = await db.prepare("SELECT to_regclass('public.sources') AS sources, to_regclass('public.news_items') AS news_items, to_regclass('public.news_item_history') AS news_item_history, to_regclass('public.job_logs') AS job_logs").first<{ sources: string | null; news_items: string | null; news_item_history: string | null; job_logs: string | null }>();
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
