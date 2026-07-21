import { ZodError } from "zod";
import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { editorialQueueRequestSchema } from "../../../lib/operational-schemas";
import {
  EditorialWorkflowConflictError,
  enqueueEditorialNews,
  generateEditorialKitForNews,
  inspectEditorialConflict,
  transitionEditorialQueue,
  type QueueRow,
} from "../../../lib/editorial-workflow";
import { AiProviderRequestError } from "../../../lib/ai";

type QueueListRow = QueueRow & { source_name?: string; primary_icp?: string; relevance_score?: number; published_at?: string };

export async function GET(request: Request) {
  try {
    const db = await getRuntimeDb();
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const result = await db.prepare(`
      SELECT q.id, q.news_item_id, q.editorial_kit_id, q.title, q.status, q.origin, q.version,
        q.last_error, q.started_at, q.completed_at, q.archived_at, q.created_at, q.updated_at,
        n.source_name, n.primary_icp, n.relevance_score, n.published_at
      FROM editorial_queue q JOIN news_items n ON n.id = q.news_item_id
      WHERE (? = TRUE OR q.archived_at IS NULL)
      ORDER BY CASE q.status WHEN 'generating' THEN 0 WHEN 'approved' THEN 1 WHEN 'analysis' THEN 2
        WHEN 'new' THEN 3 WHEN 'ready' THEN 4 WHEN 'published' THEN 5 ELSE 6 END,
        q.updated_at DESC, q.id DESC LIMIT 300
    `).bind(includeArchived).all<QueueListRow>();
    return Response.json({ queue: rowsOf(result).map(toClientQueue) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return workflowError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = editorialQueueRequestSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const schema = await db.prepare("SELECT to_regclass('public.editorial_queue') AS editorial_queue").first<{ editorial_queue: string | null }>();
    if (!schema?.editorial_queue) return Response.json({ error: "A migration aditiva da Fila Editorial ainda nÃ£o foi aplicada.", code: "schema_pending" }, { status: 503 });

    if (input.action === "prepare") {
      const items = [];
      for (const newsId of input.newsIds) items.push({ newsId, conflict: await inspectEditorialConflict(db, newsId) });
      return Response.json({ items });
    }
    if (input.action === "enqueue") {
      const created = []; const conflicts = [];
      for (const newsId of input.newsIds) {
        try { created.push(await enqueueEditorialNews(db, newsId)); }
        catch (error) {
          if (error instanceof EditorialWorkflowConflictError) conflicts.push(error.conflict);
          else throw error;
        }
      }
      return Response.json({ created: created.filter((item): item is QueueRow => Boolean(item)).map(toClientQueue), conflicts }, { status: conflicts.length ? 207 : 201 });
    }
    if (input.action === "generate") {
      const generated = await generateEditorialKitForNews(db, input.newsId, {
        mode: input.mode,
        queueId: input.queueId,
        origin: "monitoring",
      });
      return Response.json({ ...generated, queue: generated.queue ? toClientQueue(generated.queue) : null }, { status: 201 });
    }
    const updated = await transitionEditorialQueue(db, input.id, input.target);
    return Response.json({ queue: updated ? toClientQueue(updated) : null });
  } catch (error) {
    return workflowError(error);
  }
}

function toClientQueue(row: QueueListRow) {
  return {
    id: row.id,
    newsItemId: row.news_item_id,
    kitId: row.editorial_kit_id,
    title: row.title,
    status: row.status,
    origin: row.origin,
    version: row.version,
    lastError: row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceName: row.source_name,
    primaryIcp: row.primary_icp,
    relevanceScore: row.relevance_score,
    publishedAt: row.published_at,
  };
}

function workflowError(error: unknown) {
  if (error instanceof EditorialWorkflowConflictError) {
    return Response.json({ error: error.message, code: error.conflict.code, conflict: error.conflict }, { status: 409 });
  }
  if (error instanceof ZodError) return Response.json({ error: "A solicitaÃ§Ã£o da Fila Editorial Ã© invÃ¡lida.", code: "validation_failed" }, { status: 400 });
  if (error instanceof AiProviderRequestError) {
    return Response.json({ error: "A geraÃ§Ã£o nÃ£o foi concluÃ­da. A pauta retornou para Em anÃ¡lise e nenhum Kit parcial foi salvo.", code: "ai_provider_error" }, { status: error.httpStatus >= 500 ? 503 : 502 });
  }
  const message = error instanceof Error ? error.message : "Falha na Fila Editorial.";
  const schemaPending = /editorial_queue|does not exist|undefined_table/i.test(message);
  return Response.json({ error: schemaPending ? "A migration aditiva da Fila Editorial ainda nÃ£o foi aplicada." : message, code: schemaPending ? "schema_pending" : "request_failed" }, { status: schemaPending ? 503 : 400 });
}
