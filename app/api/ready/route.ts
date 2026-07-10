import { getRuntimeDb } from "../../../db/runtime";

export async function GET() {
  try {
    const db = await getRuntimeDb();
    await db.prepare("SELECT 1").first();
    return Response.json({ status: "ready", database: "connected" });
  } catch (error) {
    return Response.json({ status: "not_ready", error: error instanceof Error ? error.message : "Database unavailable" }, { status: 503 });
  }
}

