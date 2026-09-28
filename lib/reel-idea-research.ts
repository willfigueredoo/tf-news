import type { Database } from "../db/runtime.ts";
import type { AiConfig } from "./ai.ts";
import { buildEditorialIntelligence, isValidEditorialInput, type IntelligenceNews } from "./editorial-intelligence.ts";
import { loadIntelligenceNews } from "./intelligence-news.ts";
import {
  buildManusResearchPrompt,
  createManusResearchTask,
  manusConfigured,
  manusResearchSchema,
  type ManusConfig,
} from "./manus.ts";
import { generateReelIdea, ReelIdeaConflictError } from "./reel-ideas.ts";

export type ReelIdeaResearchStartOptions = {
  contentType?: "news" | "evergreen";
  automatic?: boolean;
  selectionWindowDays?: number | null;
  relatedNews?: IntelligenceNews[];
  fetchImpl?: typeof fetch;
  now?: Date;
};

type ResearchJobRow = {
  id: number;
  news_item_id: number;
  reel_idea_id: number | null;
  task_id: string | null;
  task_url: string | null;
  request_id: string | null;
  provider: string;
  agent_profile: string;
  status: string;
  origin_type: "monitoring" | "executive" | "automatic";
  content_type: "news" | "evergreen";
  automatic: boolean;
  selection_window_days: number | null;
  related_news_ids: string;
  research_payload: string | null;
  attempts: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function startReelIdeaResearch(
  db: Database,
  config: ManusConfig,
  newsId: number,
  originType: "monitoring" | "executive" | "automatic",
  options: ReelIdeaResearchStartOptions = {},
) {
  if (!manusConfigured(config)) throw new Error("O Manus ainda não está configurado.");
  const existingIdea = await db.prepare("SELECT id FROM reel_ideas WHERE news_item_id = ? LIMIT 1").bind(newsId).first<{ id: number }>();
  if (existingIdea) throw new ReelIdeaConflictError(existingIdea.id);
  const active = await findActiveResearchJob(db, newsId);
  if (active) return mapResearchJob(active);

  const news = (await loadIntelligenceNews(db, newsId))[0];
  if (!news || !isValidEditorialInput(news)) throw new Error("A notícia não possui conteúdo e fonte suficientes para iniciar a pesquisa.");
  const now = options.now ?? new Date();
  const relatedNewsIds = uniqueNumbers((options.relatedNews ?? []).map((item) => item.id).filter((id) => id !== newsId));
  const inserted = await db.prepare(`
    INSERT INTO reel_idea_research_jobs (
      news_item_id, provider, agent_profile, status, origin_type, content_type, automatic,
      selection_window_days, related_news_ids, attempts, created_at, updated_at
    ) VALUES (?, 'manus', ?, 'submitting', ?, ?, ?, ?, ?, 1, ?, ?)
    RETURNING id
  `).bind(
    newsId,
    config.agentProfile,
    originType,
    options.contentType ?? "news",
    options.automatic ?? false,
    options.selectionWindowDays ?? null,
    JSON.stringify(relatedNewsIds),
    now.toISOString(),
    now.toISOString(),
  ).first<{ id: number }>();
  if (!inserted) throw new Error("Não foi possível registrar a pesquisa editorial.");

  try {
    const task = await createManusResearchTask(config, researchInput(news), {
      fetchImpl: options.fetchImpl,
      title: `TF News — ${news.title}`,
    });
    const updatedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE reel_idea_research_jobs
      SET task_id = ?, task_url = ?, request_id = ?, status = 'researching', updated_at = ?
      WHERE id = ?
    `).bind(task.taskId, task.taskUrl, task.requestId, updatedAt, inserted.id).run();
  } catch (error) {
    await failResearchJob(db, inserted.id, error);
    throw error;
  }
  const job = await getResearchJobRow(db, inserted.id);
  if (!job) throw new Error("A pesquisa foi criada, mas não pôde ser relida.");
  return mapResearchJob(job);
}

export async function discoverNextReelIdeaResearch(
  db: Database,
  config: ManusConfig,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
) {
  const [news, existingIdeas, activeJobs] = await Promise.all([
    loadIntelligenceNews(db),
    db.prepare("SELECT news_item_id FROM reel_ideas").all<{ news_item_id: number }>(),
    db.prepare("SELECT news_item_id FROM reel_idea_research_jobs WHERE status IN ('submitting', 'researching', 'ready', 'generating', 'waiting')").all<{ news_item_id: number }>(),
  ]);
  const used = new Set([...existingIdeas.results, ...activeJobs.results].map((row) => Number(row.news_item_id)));
  const candidate = buildEditorialIntelligence(news, options.now ?? new Date()).all
    .find((item) => item.produceContent && item.editorialScore >= 60 && !used.has(item.id));
  if (!candidate) throw new Error("Nenhuma nova notícia elegível foi encontrada para criar uma ideia.");
  return startReelIdeaResearch(db, config, candidate.id, "executive", options);
}

export async function ingestManusWebhook(db: Database, payload: Record<string, unknown>) {
  const eventId = stringValue(payload.event_id);
  const eventType = stringValue(payload.event_type);
  const detail = objectValue(payload.task_detail);
  const taskId = stringValue(detail.task_id);
  if (!eventId || !taskId) return { accepted: true, ignored: true } as const;
  const job = await db.prepare("SELECT id, last_event_id FROM reel_idea_research_jobs WHERE task_id = ? LIMIT 1").bind(taskId).first<{ id: number; last_event_id: string | null }>();
  if (!job || job.last_event_id === eventId) return { accepted: true, ignored: true } as const;
  if (eventType !== "task_stopped") return { accepted: true, ignored: true } as const;

  const stoppedReason = stringValue(detail.stop_reason);
  const structured = objectValue(detail.structured_output);
  if (stoppedReason === "finish" && structured.success === true) {
    const now = new Date().toISOString();
    const parsed = manusResearchSchema.safeParse(parseStructuredValue(structured.value));
    if (!parsed.success) {
      await db.prepare(`
        UPDATE reel_idea_research_jobs
        SET status = 'failed', last_event_id = ?, error_message = ?, updated_at = ? WHERE id = ?
      `).bind(eventId, "O Manus retornou uma pesquisa fora do contrato estruturado.", now, job.id).run();
      return { accepted: true, ready: false, jobId: job.id } as const;
    }
    await db.prepare(`
      UPDATE reel_idea_research_jobs
      SET status = 'ready', research_payload = ?, last_event_id = ?, error_message = NULL, updated_at = ?
      WHERE id = ? AND status IN ('submitting', 'researching', 'waiting')
    `).bind(JSON.stringify(parsed.data), eventId, now, job.id).run();
    return { accepted: true, ready: true, jobId: job.id } as const;
  }
  const waiting = stoppedReason === "ask";
  const error = stringValue(structured.error) || stringValue(detail.message) || `A tarefa Manus terminou com motivo ${stoppedReason || "desconhecido"}.`;
  await db.prepare(`
    UPDATE reel_idea_research_jobs SET status = ?, last_event_id = ?, error_message = ?, updated_at = ? WHERE id = ?
  `).bind(waiting ? "waiting" : "failed", eventId, safeError(error), new Date().toISOString(), job.id).run();
  return { accepted: true, ready: false, jobId: job.id } as const;
}

export async function processNextReadyResearchJob(
  db: Database,
  ai: AiConfig,
  options: { fetchImpl?: typeof fetch } = {},
) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const claimed = await db.prepare(`
    UPDATE reel_idea_research_jobs SET status = 'generating', attempts = attempts + 1, updated_at = ?
    WHERE id = (
      SELECT id FROM reel_idea_research_jobs
      WHERE status = 'ready' OR (status = 'generating' AND updated_at < ?)
      ORDER BY CASE WHEN status = 'ready' THEN 0 ELSE 1 END, updated_at, id LIMIT 1
    ) AND (status = 'ready' OR (status = 'generating' AND updated_at < ?))
    RETURNING *
  `).bind(now.toISOString(), staleBefore, staleBefore).first<ResearchJobRow>();
  if (!claimed) return { status: "idle", processed: false } as const;
  try {
    const research = manusResearchSchema.parse(JSON.parse(claimed.research_payload ?? "null"));
    const related = await loadRelatedNews(db, parseNumberList(claimed.related_news_ids));
    const idea = await generateReelIdea(db, ai, claimed.news_item_id, claimed.origin_type, {
      fetchImpl: options.fetchImpl,
      contentType: claimed.content_type,
      automatic: Boolean(claimed.automatic),
      selectionWindowDays: claimed.selection_window_days,
      relatedNews: related,
      researchContext: research,
      researchJobId: claimed.id,
    });
    if (!idea) throw new Error("A ideia foi gerada, mas não pôde ser relida.");
    await completeResearchJob(db, claimed.id, Number(idea.id));
    return { status: "completed", processed: true, jobId: claimed.id, idea } as const;
  } catch (error) {
    if (error instanceof ReelIdeaConflictError && error.ideaId) {
      await completeResearchJob(db, claimed.id, error.ideaId);
      return { status: "completed", processed: true, jobId: claimed.id, ideaId: error.ideaId } as const;
    }
    await failResearchJob(db, claimed.id, error);
    throw error;
  }
}

export async function getResearchJob(db: Database, id: number) {
  const row = await getResearchJobRow(db, id);
  return row ? mapResearchJob(row) : null;
}

async function completeResearchJob(db: Database, id: number, ideaId: number) {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE reel_idea_research_jobs
    SET status = 'completed', reel_idea_id = ?, error_message = NULL, updated_at = ?, completed_at = ?
    WHERE id = ?
  `).bind(ideaId, now, now, id).run();
}

async function failResearchJob(db: Database, id: number, error: unknown) {
  await db.prepare(`
    UPDATE reel_idea_research_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?
  `).bind(safeError(error), new Date().toISOString(), id).run();
}

async function findActiveResearchJob(db: Database, newsId: number) {
  return db.prepare(`
    SELECT * FROM reel_idea_research_jobs
    WHERE news_item_id = ? AND status IN ('submitting', 'researching', 'ready', 'generating', 'waiting')
    ORDER BY id DESC LIMIT 1
  `).bind(newsId).first<ResearchJobRow>();
}

async function getResearchJobRow(db: Database, id: number) {
  return db.prepare("SELECT * FROM reel_idea_research_jobs WHERE id = ? LIMIT 1").bind(id).first<ResearchJobRow>();
}

async function loadRelatedNews(db: Database, ids: number[]) {
  if (!ids.length) return [];
  const news = await loadIntelligenceNews(db);
  const wanted = new Set(ids);
  return news.filter((item) => wanted.has(item.id));
}

function researchInput(news: IntelligenceNews): Parameters<typeof buildManusResearchPrompt>[0] {
  return {
    title: news.title,
    excerpt: news.excerpt,
    content: news.content.slice(0, 8_000),
    sourceName: news.sourceName,
    originalUrl: news.originalUrl,
    publishedAt: news.publishedAt,
    topics: news.topics,
    primaryIcp: news.primaryIcp,
  };
}

function mapResearchJob(row: ResearchJobRow) {
  return {
    id: Number(row.id),
    newsItemId: Number(row.news_item_id),
    ideaId: row.reel_idea_id == null ? null : Number(row.reel_idea_id),
    taskUrl: row.task_url,
    status: row.status,
    agentProfile: row.agent_profile,
    originType: row.origin_type,
    contentType: row.content_type,
    automatic: Boolean(row.automatic),
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function parseNumberList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? uniqueNumbers(parsed.map(Number).filter(Number.isInteger)) : [];
  } catch { return []; }
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Falha na pesquisa editorial."))
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
