import type { Database } from "../db/runtime.ts";
import { getAiConfig } from "./runtime-config.ts";
import { buildEditorialIntelligence } from "./editorial-intelligence.ts";
import { createEditorialKit } from "./editorial-kit.ts";
import type { AiConfig } from "./ai.ts";
import { loadIntelligenceNews } from "./intelligence-news.ts";

export const EDITORIAL_QUEUE_STATUSES = ["new", "analysis", "approved", "generating", "ready", "published", "archived"] as const;
export type EditorialQueueStatus = typeof EDITORIAL_QUEUE_STATUSES[number];
export type EditorialConflictCode = "active_queue" | "generation_in_progress" | "existing_kit";

export type EditorialConflict = {
  code: EditorialConflictCode;
  newsId: number;
  queueId: number | null;
  queueStatus: EditorialQueueStatus | null;
  kitId: number | null;
  options: Array<"open_queue" | "open_kit" | "generate_existing" | "generate_new_version" | "cancel">;
};

type ConflictRow = {
  news_id: number;
  queue_id: number | null;
  queue_status: EditorialQueueStatus | null;
  queue_kit_id: number | null;
  kit_id: number | null;
};

export type QueueRow = {
  id: number;
  news_item_id: number;
  editorial_kit_id: number | null;
  title: string;
  status: EditorialQueueStatus;
  origin: string;
  version: number;
  requested_by: string | null;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export class EditorialWorkflowConflictError extends Error {
  readonly conflict: EditorialConflict;
  constructor(conflict: EditorialConflict) {
    super(conflictMessage(conflict.code));
    this.name = "EditorialWorkflowConflictError";
    this.conflict = conflict;
  }
}

export async function inspectEditorialConflict(db: Database, newsId: number): Promise<EditorialConflict | null> {
  const row = await db.prepare(`
    SELECT n.id AS news_id, active.id AS queue_id, active.status AS queue_status,
      active.editorial_kit_id AS queue_kit_id, kit.id AS kit_id
    FROM news_items n
    LEFT JOIN LATERAL (
      SELECT q.id, q.status, q.editorial_kit_id
      FROM editorial_queue q
      WHERE q.news_item_id = n.id
        AND q.archived_at IS NULL
        AND q.status IN ('new', 'analysis', 'approved', 'generating')
      ORDER BY q.created_at DESC, q.id DESC LIMIT 1
    ) active ON TRUE
    LEFT JOIN LATERAL (
      SELECT k.id FROM editorial_kits k
      WHERE k.news_item_id = n.id
      ORDER BY k.created_at DESC, k.id DESC LIMIT 1
    ) kit ON TRUE
    WHERE n.id = ?
  `).bind(newsId).first<ConflictRow>();
  if (!row) return null;
  const kitId = row.queue_kit_id ?? row.kit_id;
  if (row.queue_id) {
    const generating = row.queue_status === "generating";
    return {
      code: generating ? "generation_in_progress" : "active_queue",
      newsId,
      queueId: row.queue_id,
      queueStatus: row.queue_status,
      kitId,
      options: ["open_queue", ...(kitId ? ["open_kit"] as const : ["generate_existing"] as const), "cancel"],
    };
  }
  if (kitId) return { code: "existing_kit", newsId, queueId: null, queueStatus: null, kitId, options: ["open_kit", "generate_new_version", "cancel"] };
  return null;
}

export async function enqueueEditorialNews(db: Database, newsId: number, origin = "monitoring") {
  const conflict = await inspectEditorialConflict(db, newsId);
  if (conflict) throw new EditorialWorkflowConflictError(conflict);
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO editorial_queue (news_item_id, title, status, origin, version, created_at, updated_at)
    SELECT n.id, n.title, 'new', ?, COALESCE(MAX(q.version), 0) + 1, ?, ?
    FROM news_items n LEFT JOIN editorial_queue q ON q.news_item_id = n.id
    WHERE n.id = ? GROUP BY n.id, n.title RETURNING id
  `).bind(origin, now, now, newsId).run();
  const id = Number(result.meta.last_row_id);
  if (!id) throw new Error("NotÃ­cia nÃ£o encontrada para criar a pauta editorial.");
  return loadEditorialQueueItem(db, id);
}

export async function generateEditorialKitForNews(db: Database, newsId: number, options: {
  mode?: "default" | "new_version";
  origin?: string;
  queueId?: number;
  config?: AiConfig;
  createKit?: typeof createEditorialKit;
} = {}) {
  const news = await loadIntelligenceNews(db, newsId);
  if (!news.length) throw new Error("NotÃ­cia nÃ£o encontrada.");
  const decision = buildEditorialIntelligence(news).newsOfTheDay;
  if (!decision?.produceContent) throw new Error("A notÃ­cia nÃ£o possui conteÃºdo e fonte vÃ¡lidos para gerar um Kit Editorial.");

  const mode = options.mode ?? "default";
  let queueId = options.queueId ?? null;
  if (queueId) {
    const now = new Date().toISOString();
    const claimed = await db.prepare(`
      UPDATE editorial_queue SET status = 'generating', started_at = ?, completed_at = NULL,
        last_error = NULL, updated_at = ?
      WHERE id = ? AND news_item_id = ? AND editorial_kit_id IS NULL
        AND archived_at IS NULL AND status IN ('new', 'analysis', 'approved')
      RETURNING id
    `).bind(now, now, queueId, newsId).run();
    if (!claimed.meta.last_row_id) {
      const conflict = await inspectEditorialConflict(db, newsId);
      if (conflict) throw new EditorialWorkflowConflictError(conflict);
      throw new Error("A pauta nÃ£o estÃ¡ disponÃ­vel para geraÃ§Ã£o.");
    }
  } else {
    const conflict = await inspectEditorialConflict(db, newsId);
    if (conflict && (mode !== "new_version" || conflict.code !== "existing_kit")) {
      throw new EditorialWorkflowConflictError(conflict);
    }
    queueId = await createGeneratingQueue(db, newsId, options.origin ?? "monitoring");
  }

  try {
    const kit = await (options.createKit ?? createEditorialKit)(db, options.config ?? getAiConfig(), decision, { queueId });
    return { kit, queue: await loadEditorialQueueItem(db, queueId) };
  } catch (error) {
    const now = new Date().toISOString();
    await db.prepare("UPDATE editorial_queue SET status = 'analysis', last_error = ?, completed_at = NULL, updated_at = ? WHERE id = ? AND editorial_kit_id IS NULL")
      .bind(safeWorkflowError(error), now, queueId).run();
    throw error;
  }
}

export async function transitionEditorialQueue(db: Database, queueId: number, target: EditorialQueueStatus) {
  const current = await loadEditorialQueueItem(db, queueId);
  if (!current) throw new Error("Pauta editorial nÃ£o encontrada.");
  const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(target)) throw new Error(`TransiÃ§Ã£o editorial invÃ¡lida: ${current.status} â†’ ${target}.`);
  const now = new Date().toISOString();
  const archivedAt = target === "archived" ? now : null;
  await db.prepare("UPDATE editorial_queue SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?")
    .bind(target, archivedAt, now, queueId).run();
  return loadEditorialQueueItem(db, queueId);
}

export async function loadEditorialQueueItem(db: Database, id: number) {
  return db.prepare("SELECT id, news_item_id, editorial_kit_id, title, status, origin, version, requested_by, last_error, started_at, completed_at, archived_at, created_at, updated_at FROM editorial_queue WHERE id = ?")
    .bind(id).first<QueueRow>();
}

async function createGeneratingQueue(db: Database, newsId: number, origin: string) {
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO editorial_queue (news_item_id, title, status, origin, version, started_at, created_at, updated_at)
    SELECT n.id, n.title, 'generating', ?, COALESCE(MAX(q.version), 0) + 1, ?, ?, ?
    FROM news_items n LEFT JOIN editorial_queue q ON q.news_item_id = n.id
    WHERE n.id = ? GROUP BY n.id, n.title RETURNING id
  `).bind(origin, now, now, now, newsId).run();
  const id = Number(result.meta.last_row_id);
  if (!id) throw new Error("NÃ£o foi possÃ­vel criar a pauta editorial.");
  return id;
}

const ALLOWED_TRANSITIONS: Record<EditorialQueueStatus, EditorialQueueStatus[]> = {
  new: ["analysis", "approved", "generating", "archived"],
  analysis: ["approved", "generating", "archived"],
  approved: ["generating", "archived"],
  generating: ["analysis", "ready"],
  ready: ["published", "archived"],
  published: ["archived"],
  archived: ["new"],
};

function safeWorkflowError(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha na geraÃ§Ã£o editorial.";
  return message.replace(/(key|token|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]").slice(0, 1_000);
}

function conflictMessage(code: EditorialConflictCode) {
  if (code === "generation_in_progress") return "JÃ¡ existe uma geraÃ§Ã£o em andamento para esta notÃ­cia.";
  if (code === "active_queue") return "JÃ¡ existe uma pauta ativa para esta notÃ­cia.";
  return "JÃ¡ existe um Kit Editorial para esta notÃ­cia.";
}
