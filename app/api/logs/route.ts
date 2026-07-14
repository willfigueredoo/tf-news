import { getRuntimeDb, rowsOf } from "../../../db/runtime";

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const [jobs, ai] = await Promise.all([
      db.prepare("SELECT id, job_type, status, started_at, finished_at, processed_items, error_message, metadata FROM job_logs ORDER BY id DESC LIMIT 100").all<Record<string, unknown>>(),
      db.prepare("SELECT id, operation, provider, model, status, input_tokens, output_tokens, estimated_cost_usd, latency_ms, error_message, created_at FROM ai_usage_logs ORDER BY id DESC LIMIT 100").all<Record<string, unknown>>(),
    ]);
    return Response.json({ jobs: rowsOf(jobs), ai: rowsOf(ai) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao consultar logs." }, { status: 500 }); }
}
