import type { Database } from "../db/runtime.ts";
import {
  collectSourceIncrementalBatch,
  getPrimarySeoSite,
  markSourceFailure,
  markSourceSuccess,
  markUnavailableCompetitorArticles,
  markUnavailableSiteArticles,
  persistCompetitorArticles,
  persistSiteArticles,
  safeError,
  type SeoSourceRow,
  type SeoSyncCursor,
} from "./seo-sync.ts";

const ACTIVE_JOB_STATUSES = "('queued', 'processing', 'retry')";
const LEASE_SECONDS = 45;
const DEFAULT_BATCH_SIZE = 5;

type SyncScope = "site" | "competitor";
type SyncTrigger = "manual" | "automatic";

type SyncJobRow = {
  id: number;
  run_id: number;
  scope: SyncScope;
  target_id: number;
  trigger: SyncTrigger;
  status: string;
  source_id: number | null;
  source_type: string | null;
  source_url: string | null;
  source_position: number;
  cursor: string;
  batch_size: number;
  processed_items: number;
  total_items: number | null;
  found: number;
  inserted: number;
  updated: number;
  ignored: number;
  unavailable: number;
  errors: number;
  attempts: number;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_run_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SeoSyncJob = ReturnType<typeof mapJob>;

export async function enqueueSeoSiteSync(
  db: Database,
  trigger: SyncTrigger = "manual",
) {
  const site = await getPrimarySeoSite(db);
  if (!site) throw new Error("Configure o site principal antes de iniciar a sincronização.");
  return enqueueSeoSyncJob(db, "site", site.id, trigger);
}

export async function enqueueSeoCompetitorSync(
  db: Database,
  competitorId: number,
  trigger: SyncTrigger = "manual",
) {
  const competitor = await db.prepare("SELECT id, active FROM seo_competitors WHERE id = ? AND archived_at IS NULL")
    .bind(competitorId).first<{ id: number; active: boolean }>();
  if (!competitor) throw new Error("Concorrente não encontrado.");
  if (!competitor.active) throw new Error("Ative o concorrente antes de sincronizar.");
  return enqueueSeoSyncJob(db, "competitor", competitorId, trigger);
}

export async function enqueueAllSeoSyncJobs(db: Database, trigger: SyncTrigger = "automatic") {
  const jobs: SeoSyncJob[] = [];
  const site = await getPrimarySeoSite(db);
  if (site) jobs.push(await enqueueSeoSyncJob(db, "site", site.id, trigger));
  const competitors = await db.prepare("SELECT id FROM seo_competitors WHERE active = TRUE AND archived_at IS NULL ORDER BY id")
    .all<{ id: number }>();
  for (const competitor of competitors.results) {
    jobs.push(await enqueueSeoSyncJob(db, "competitor", competitor.id, trigger));
  }
  return jobs;
}

export async function enqueueSeoSyncJob(
  db: Database,
  scope: SyncScope,
  targetId: number,
  trigger: SyncTrigger,
) {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
  await db.prepare(`
    UPDATE seo_sync_runs
    SET status = 'interrupted', finished_at = ?, duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (?::timestamptz - started_at::timestamptz)) * 1000)::int),
      errors = errors + 1, error_message = 'Execução anterior interrompida pelo limite do runtime.'
    WHERE scope = ? AND target_id = ? AND status = 'running' AND started_at < ?
  `).bind(now, now, scope, targetId, staleBefore).run();

  const active = await findActiveJob(db, scope, targetId);
  if (active) return mapJob(active);

  const run = await db.prepare(`
    INSERT INTO seo_sync_runs (scope, target_id, trigger, status, started_at, metadata)
    VALUES (?, ?, ?, 'queued', ?, '{"mode":"incremental"}')
    RETURNING id
  `).bind(scope, targetId, trigger, now).run();
  const runId = Number(run.meta.last_row_id);
  if (!runId) throw new Error("Não foi possível registrar a sincronização incremental.");

  try {
    const created = await db.prepare(`
      INSERT INTO seo_sync_jobs (
        run_id, scope, target_id, trigger, status, source_position, cursor, batch_size,
        processed_items, found, inserted, updated, ignored, unavailable, errors, attempts,
        next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', 0, '{}', ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?)
      RETURNING *
    `).bind(runId, scope, targetId, trigger, DEFAULT_BATCH_SIZE, now, now, now).first<SyncJobRow>();
    if (!created) throw new Error("Não foi possível criar o job de sincronização.");
    await markTargetQueued(db, scope, targetId, now);
    console.info("[seo-sync-job]", JSON.stringify({ phase: "queued", jobId: created.id, scope, targetId, trigger }));
    return mapJob(created);
  } catch (error) {
    const concurrent = await findActiveJob(db, scope, targetId);
    if (concurrent) {
      await db.prepare("UPDATE seo_sync_runs SET status = 'superseded', finished_at = ? WHERE id = ?")
        .bind(now, runId).run();
      return mapJob(concurrent);
    }
    throw error;
  }
}

export async function processNextSeoSyncBatch(
  db: Database,
  options: { jobId?: number; fetchImpl?: typeof fetch } = {},
) {
  const job = await claimJob(db, options.jobId);
  if (!job) return null;
  const started = Date.now();
  console.info("[seo-sync-job]", JSON.stringify({
    phase: "batch_start",
    jobId: job.id,
    scope: job.scope,
    targetId: job.target_id,
    sourcePosition: job.source_position,
    processed: job.processed_items,
  }));

  try {
    const sources = await loadSources(db, job);
    const source = sources[job.source_position];
    if (!source) {
      return failJob(db, job, job.last_error ?? "Nenhuma fonte confirmada pôde ser processada.");
    }

    try {
      const batch = await collectSourceIncrementalBatch(source, parseCursor(job.cursor), {
        fetchImpl: options.fetchImpl,
        batchSize: job.batch_size,
      });
      const articles = batch.articles.map((article) => ({ ...article, sourceId: source.id }));
      const counts = job.scope === "site"
        ? await persistSiteArticles(db, job.target_id, articles, job.created_at)
        : await persistCompetitorArticles(db, job.target_id, articles, job.created_at);
      await markSourceSuccess(db, sourceTable(job.scope), source.id);

      const totals = {
        processed: job.processed_items + batch.processed,
        found: job.found + articles.length,
        inserted: job.inserted + counts.inserted,
        updated: job.updated + counts.updated,
        ignored: job.ignored + counts.ignored,
      };
      if (batch.done && totals.found === 0 && job.source_position + 1 < sources.length) {
        return moveToNextSource(db, job, source, totals, "A fonte não apresentou artigos utilizáveis.");
      }
      if (batch.done) {
        return completeJob(db, job, source, totals, batch.total, started);
      }

      const now = new Date().toISOString();
      await db.batch([
        db.prepare(`
          UPDATE seo_sync_jobs SET status = 'queued', source_id = ?, source_type = ?, source_url = ?,
            cursor = ?, processed_items = ?, total_items = ?, found = ?, inserted = ?, updated = ?, ignored = ?,
            last_error = NULL, lease_owner = NULL, lease_expires_at = NULL, next_run_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(
          source.id, source.source_type, source.url, JSON.stringify(batch.cursor), totals.processed,
          batch.total, totals.found, totals.inserted, totals.updated, totals.ignored, now, now, job.id,
        ),
        updateRunProgress(db, job.run_id, "running", source.source_type, totals, job.errors, null),
        markTargetSyncing(db, job.scope, job.target_id, now),
      ]);
      const current = await getSeoSyncJob(db, job.id);
      console.info("[seo-sync-job]", JSON.stringify({
        phase: "batch_complete",
        jobId: job.id,
        processed: totals.processed,
        total: batch.total,
        durationMs: Date.now() - started,
        done: false,
      }));
      return current;
    } catch (error) {
      const message = safeError(error);
      await markSourceFailure(db, sourceTable(job.scope), source.id, message);
      if (job.source_position + 1 < sources.length) {
        return moveToNextSource(db, job, source, {
          processed: job.processed_items,
          found: job.found,
          inserted: job.inserted,
          updated: job.updated,
          ignored: job.ignored,
        }, message);
      }
      return failJob(db, job, message);
    }
  } catch (error) {
    return failJob(db, job, safeError(error));
  }
}

export async function drainSeoSyncJobs(
  db: Database,
  options: { maxBatches?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {},
) {
  const maxBatches = Math.max(1, Math.min(options.maxBatches ?? 8, 30));
  const deadline = Date.now() + Math.max(5_000, Math.min(options.deadlineMs ?? 45_000, 50_000));
  const jobs: SeoSyncJob[] = [];
  while (jobs.length < maxBatches && Date.now() < deadline) {
    const job = await processNextSeoSyncBatch(db, { fetchImpl: options.fetchImpl });
    if (!job) break;
    jobs.push(job);
  }
  return {
    processedBatches: jobs.length,
    completedJobs: jobs.filter((job) => job.status === "completed").length,
    failedJobs: jobs.filter((job) => job.status === "failed").length,
    changed: jobs.some((job) => job.inserted > 0 || job.updated > 0 || job.unavailable > 0),
    jobs,
  };
}

export async function getSeoSyncJob(db: Database, jobId: number) {
  const row = await db.prepare("SELECT * FROM seo_sync_jobs WHERE id = ?").bind(jobId).first<SyncJobRow>();
  return row ? mapJob(row) : null;
}

async function claimJob(db: Database, jobId?: number) {
  const now = new Date().toISOString();
  const leaseOwner = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();
  const target = jobId
    ? "id = ?"
    : `id = (
        SELECT id FROM seo_sync_jobs
        WHERE (
          status IN ('queued', 'retry') AND next_run_at <= ?
        ) OR (
          status = 'processing' AND lease_expires_at < ?
        )
        ORDER BY next_run_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )`;
  const statement = db.prepare(`
    UPDATE seo_sync_jobs SET status = 'processing', lease_owner = ?, lease_expires_at = ?,
      started_at = COALESCE(started_at, ?), attempts = attempts + 1, updated_at = ?
    WHERE ${target}
      AND ((status IN ('queued', 'retry') AND next_run_at <= ?) OR (status = 'processing' AND lease_expires_at < ?))
    RETURNING *
  `);
  const values = jobId
    ? [leaseOwner, leaseExpiresAt, now, now, jobId, now, now]
    : [leaseOwner, leaseExpiresAt, now, now, now, now, now, now];
  return statement.bind(...values).first<SyncJobRow>();
}

async function completeJob(
  db: Database,
  job: SyncJobRow,
  source: SeoSourceRow,
  totals: { processed: number; found: number; inserted: number; updated: number; ignored: number },
  totalItems: number | null,
  batchStarted: number,
) {
  const now = new Date().toISOString();
  const reconciled = await reconcileJobCounts(db, job);
  totals.found = reconciled.found;
  totals.inserted = reconciled.inserted;
  totals.ignored = Math.max(0, reconciled.found - reconciled.inserted - totals.updated);
  const unavailable = source.source_type === "wordpress_rest"
    ? job.scope === "site"
      ? await markUnavailableSiteArticles(db, job.target_id, job.created_at)
      : await markUnavailableCompetitorArticles(db, job.target_id, job.created_at)
    : 0;
  const durationMs = Math.max(0, Date.now() - new Date(job.created_at).getTime());
  await db.batch([
    db.prepare(`
      UPDATE seo_sync_jobs SET status = 'completed', source_id = ?, source_type = ?, source_url = ?,
        processed_items = ?, total_items = ?, found = ?, inserted = ?, updated = ?, ignored = ?, unavailable = ?,
        last_error = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      source.id, source.source_type, source.url, totals.processed, totalItems, totals.found,
      totals.inserted, totals.updated, totals.ignored, unavailable, now, now, job.id,
    ),
    db.prepare(`
      UPDATE seo_sync_runs SET status = 'success', method = ?, finished_at = ?, duration_ms = ?,
        found = ?, inserted = ?, updated = ?, ignored = ?, unavailable = ?, errors = ?, error_message = NULL,
        metadata = ? WHERE id = ?
    `).bind(
      source.source_type, now, durationMs, totals.found, totals.inserted, totals.updated, totals.ignored,
      unavailable, job.errors, JSON.stringify({ mode: "incremental", jobId: job.id, processed: totals.processed, total: totalItems }), job.run_id,
    ),
    finishTarget(db, job.scope, job.target_id, now, source.source_type),
  ]);
  const current = await getSeoSyncJob(db, job.id);
  console.info("[seo-sync-job]", JSON.stringify({
    phase: "job_complete",
    jobId: job.id,
    processed: totals.processed,
    total: totalItems,
    found: totals.found,
    inserted: totals.inserted,
    updated: totals.updated,
    ignored: totals.ignored,
    unavailable,
    batchDurationMs: Date.now() - batchStarted,
    durationMs,
  }));
  return current;
}

async function moveToNextSource(
  db: Database,
  job: SyncJobRow,
  source: SeoSourceRow,
  totals: { processed: number; found: number; inserted: number; updated: number; ignored: number },
  message: string,
) {
  const now = new Date().toISOString();
  const nextRunAt = new Date(Date.now() + 500).toISOString();
  await db.batch([
    db.prepare(`
      UPDATE seo_sync_jobs SET status = 'retry', source_id = ?, source_type = ?, source_url = ?,
        source_position = source_position + 1, cursor = '{}', processed_items = ?, total_items = NULL,
        found = ?, inserted = ?, updated = ?, ignored = ?, errors = errors + 1, last_error = ?,
        lease_owner = NULL, lease_expires_at = NULL, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      source.id, source.source_type, source.url, totals.processed, totals.found, totals.inserted,
      totals.updated, totals.ignored, message.slice(0, 800), nextRunAt, now, job.id,
    ),
    updateRunProgress(db, job.run_id, "running", source.source_type, totals, job.errors + 1, message),
    markTargetSyncing(db, job.scope, job.target_id, now),
  ]);
  console.warn("[seo-sync-job]", JSON.stringify({
    phase: "source_fallback",
    jobId: job.id,
    sourceId: source.id,
    sourceType: source.source_type,
    message,
  }));
  return getSeoSyncJob(db, job.id);
}

async function failJob(db: Database, job: SyncJobRow, message: string) {
  const now = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - new Date(job.created_at).getTime());
  await db.batch([
    db.prepare(`
      UPDATE seo_sync_jobs SET status = 'failed', errors = errors + 1, last_error = ?,
        lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?
    `).bind(message.slice(0, 800), now, now, job.id),
    db.prepare(`
      UPDATE seo_sync_runs SET status = 'failed', finished_at = ?, duration_ms = ?, found = ?, inserted = ?,
        updated = ?, ignored = ?, unavailable = ?, errors = ?, error_message = ?, metadata = ?
      WHERE id = ?
    `).bind(
      now, durationMs, job.found, job.inserted, job.updated, job.ignored, job.unavailable, job.errors + 1,
      message.slice(0, 800), JSON.stringify({ mode: "incremental", jobId: job.id, processed: job.processed_items }), job.run_id,
    ),
    failTarget(db, job.scope, job.target_id, message, now),
  ]);
  console.error("[seo-sync-job]", JSON.stringify({ phase: "job_failed", jobId: job.id, message }));
  return getSeoSyncJob(db, job.id);
}

async function findActiveJob(db: Database, scope: SyncScope, targetId: number) {
  return db.prepare(`
    SELECT * FROM seo_sync_jobs
    WHERE scope = ? AND target_id = ? AND status IN ${ACTIVE_JOB_STATUSES}
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).bind(scope, targetId).first<SyncJobRow>();
}

async function loadSources(db: Database, job: SyncJobRow) {
  const table = sourceTable(job.scope);
  const ownerColumn = job.scope === "site" ? "site_id" : "competitor_id";
  const statusClause = job.scope === "site" ? "" : "AND status IN ('confirmed', 'active')";
  const result = await db.prepare(`
    SELECT id, source_type, url, priority, status FROM ${table}
    WHERE ${ownerColumn} = ? ${statusClause}
    ORDER BY priority DESC, id
  `).bind(job.target_id).all<SeoSourceRow>();
  return result.results;
}

function updateRunProgress(
  db: Database,
  runId: number,
  status: string,
  method: string,
  totals: { found: number; inserted: number; updated: number; ignored: number; processed: number },
  errors: number,
  error: string | null,
) {
  return db.prepare(`
    UPDATE seo_sync_runs SET status = ?, method = ?, found = ?, inserted = ?, updated = ?, ignored = ?,
      errors = ?, error_message = ?, metadata = ? WHERE id = ?
  `).bind(
    status, method, totals.found, totals.inserted, totals.updated, totals.ignored, errors,
    error?.slice(0, 800) ?? null, JSON.stringify({ mode: "incremental", processed: totals.processed }), runId,
  );
}

function markTargetQueued(db: Database, scope: SyncScope, targetId: number, now: string) {
  return scope === "site"
    ? db.prepare("UPDATE seo_sites SET status = 'syncing', last_error = NULL, updated_at = ? WHERE id = ?").bind(now, targetId).run()
    : db.prepare("UPDATE seo_competitors SET sync_status = 'queued', last_error = NULL, updated_at = ? WHERE id = ?").bind(now, targetId).run();
}

function markTargetSyncing(db: Database, scope: SyncScope, targetId: number, now: string) {
  return scope === "site"
    ? db.prepare("UPDATE seo_sites SET status = 'syncing', updated_at = ? WHERE id = ?").bind(now, targetId)
    : db.prepare("UPDATE seo_competitors SET sync_status = 'syncing', updated_at = ? WHERE id = ?").bind(now, targetId);
}

function finishTarget(db: Database, scope: SyncScope, targetId: number, now: string, method: string) {
  return scope === "site"
    ? db.prepare(`
        UPDATE seo_sites SET status = 'ready', last_sync_at = ?, next_sync_at = ?, last_error = NULL,
          articles_found = (SELECT COUNT(*)::int FROM seo_articles WHERE site_id = ?),
          articles_synced = (SELECT COUNT(*)::int FROM seo_articles WHERE site_id = ? AND status = 'published'),
          discovery_method = ?, updated_at = ? WHERE id = ?
      `).bind(now, new Date(Date.now() + 86_400_000).toISOString(), targetId, targetId, method, now, targetId)
    : db.prepare("UPDATE seo_competitors SET sync_status = 'ready', last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(now, now, targetId);
}

function failTarget(db: Database, scope: SyncScope, targetId: number, message: string, now: string) {
  return scope === "site"
    ? db.prepare("UPDATE seo_sites SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 800), now, targetId)
    : db.prepare("UPDATE seo_competitors SET sync_status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(message.slice(0, 800), now, targetId);
}

function sourceTable(scope: SyncScope) {
  return scope === "site" ? "seo_site_sources" as const : "seo_competitor_sources" as const;
}

async function reconcileJobCounts(db: Database, job: SyncJobRow) {
  const table = job.scope === "site" ? "seo_articles" : "seo_competitor_articles";
  const ownerColumn = job.scope === "site" ? "site_id" : "competitor_id";
  const row = await db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE last_collected_at = ?)::int AS found,
      COUNT(*) FILTER (WHERE first_collected_at = ?)::int AS inserted
    FROM ${table}
    WHERE ${ownerColumn} = ?
  `).bind(job.created_at, job.created_at, job.target_id).first<{ found: number; inserted: number }>();
  return { found: row?.found ?? 0, inserted: row?.inserted ?? 0 };
}

function parseCursor(value: string): SeoSyncCursor {
  try {
    const parsed = JSON.parse(value) as SeoSyncCursor;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mapJob(row: SyncJobRow) {
  const progressPercent = row.total_items && row.total_items > 0
    ? Math.min(100, Math.round((row.processed_items / row.total_items) * 100))
    : null;
  return {
    id: row.id,
    runId: row.run_id,
    scope: row.scope,
    targetId: row.target_id,
    trigger: row.trigger,
    status: row.status,
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    processedItems: row.processed_items,
    totalItems: row.total_items,
    progressPercent,
    found: row.found,
    inserted: row.inserted,
    updated: row.updated,
    ignored: row.ignored,
    unavailable: row.unavailable,
    errors: row.errors,
    attempts: row.attempts,
    lastError: row.last_error,
    nextRunAt: row.next_run_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
