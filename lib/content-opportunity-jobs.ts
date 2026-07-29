import type { Database } from "../db/runtime.ts";
import type { AiConfig } from "./ai.ts";
import {
  analyzeEvergreenBatch,
  buildEvergreenCandidates,
  persistEvergreenBatch,
  type EvergreenCandidate,
} from "./content-opportunities.ts";

const ACTIVE_STATUSES = "('queued', 'processing', 'retry')";
const LEASE_SECONDS = 58;
const BATCH_SIZE = 3;

type Trigger = "manual" | "news_sync" | "competitor_sync" | "cron";

type JobRow = {
  id: number;
  job_key: string;
  trigger: Trigger;
  status: string;
  cursor: number;
  batch_size: number;
  total_candidates: number;
  processed_candidates: number;
  opportunities_created: number;
  opportunities_updated: number;
  ignored: number;
  attempts: number;
  candidate_snapshot: string;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_run_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function enqueueContentOpportunityAnalysis(
  db: Database,
  trigger: Trigger = "manual",
  options: { now?: Date } = {},
) {
  const active = await findActiveJob(db);
  if (active) return mapJob(active);
  const now = options.now ?? new Date();
  const candidates = await buildEvergreenCandidates(db, { now });
  const timestamp = now.toISOString();
  try {
    const row = await db.prepare(`
      INSERT INTO content_opportunity_jobs (
        job_key, trigger, status, cursor, batch_size, total_candidates, processed_candidates,
        opportunities_created, opportunities_updated, ignored, attempts, candidate_snapshot,
        next_run_at, finished_at, created_at, updated_at
      ) VALUES (
        'evergreen', ?, ?, 0, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?
      )
      RETURNING *
    `).bind(
      trigger,
      candidates.length ? "queued" : "completed",
      BATCH_SIZE,
      candidates.length,
      JSON.stringify(candidates),
      timestamp,
      candidates.length ? null : timestamp,
      timestamp,
      timestamp,
    ).first<JobRow>();
    if (!row) throw new Error("Não foi possível iniciar a análise de oportunidades.");
    console.info("[content-opportunity-job]", JSON.stringify({
      phase: "queued",
      jobId: row.id,
      trigger,
      totalCandidates: candidates.length,
    }));
    return mapJob(row);
  } catch (error) {
    const concurrent = await findActiveJob(db);
    if (concurrent) return mapJob(concurrent);
    throw error;
  }
}

export async function processNextContentOpportunityBatch(
  db: Database,
  config: AiConfig,
  options: { jobId?: number; fetchImpl?: typeof fetch } = {},
) {
  const job = await claimJob(db, options.jobId);
  if (!job) return null;
  const candidates = parseCandidates(job.candidate_snapshot);
  const batch = candidates.slice(job.cursor, job.cursor + job.batch_size);
  if (!batch.length) return completeJob(db, job);
  console.info("[content-opportunity-job]", JSON.stringify({
    phase: "batch_start",
    jobId: job.id,
    cursor: job.cursor,
    batchSize: batch.length,
    totalCandidates: candidates.length,
  }));

  try {
    const analysis = await analyzeEvergreenBatch(db, config, batch, {
      fetchImpl: options.fetchImpl,
    });
    const persisted = await persistEvergreenBatch(db, batch, analysis.data.items, analysis.analysisId);
    const nextCursor = job.cursor + batch.length;
    const now = new Date().toISOString();
    const completed = nextCursor >= candidates.length;
    await db.prepare(`
      UPDATE content_opportunity_jobs SET
        status = ?, cursor = ?, processed_candidates = ?,
        opportunities_created = opportunities_created + ?,
        opportunities_updated = opportunities_updated + ?,
        ignored = ignored + ?, last_error = NULL,
        lease_owner = NULL, lease_expires_at = NULL, next_run_at = ?,
        finished_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      completed ? "completed" : "queued",
      nextCursor,
      nextCursor,
      persisted.created,
      persisted.updated,
      persisted.ignored,
      now,
      completed ? now : null,
      now,
      job.id,
    ).run();
    console.info("[content-opportunity-job]", JSON.stringify({
      phase: completed ? "job_complete" : "batch_complete",
      jobId: job.id,
      processed: nextCursor,
      total: candidates.length,
      created: persisted.created,
      updated: persisted.updated,
      ignored: persisted.ignored,
      cached: analysis.cached,
    }));
    return getContentOpportunityJob(db, job.id);
  } catch (error) {
    return retryOrFailJob(db, job, safeError(error));
  }
}

export async function drainContentOpportunityJobs(
  db: Database,
  config: AiConfig,
  options: { maxBatches?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {},
) {
  const maxBatches = Math.max(1, Math.min(options.maxBatches ?? 3, 10));
  const deadline = Date.now() + Math.max(5_000, Math.min(options.deadlineMs ?? 50_000, 55_000));
  const jobs = [];
  while (jobs.length < maxBatches && Date.now() < deadline) {
    const job = await processNextContentOpportunityBatch(db, config, {
      fetchImpl: options.fetchImpl,
    });
    if (!job) break;
    jobs.push(job);
    if (job.status === "retry" || job.status === "failed") break;
  }
  return {
    processedBatches: jobs.length,
    completedJobs: jobs.filter((job) => job.status === "completed").length,
    failedJobs: jobs.filter((job) => job.status === "failed").length,
    jobs,
  };
}

export async function getContentOpportunityJob(db: Database, id: number) {
  const row = await db.prepare("SELECT * FROM content_opportunity_jobs WHERE id = ?")
    .bind(id).first<JobRow>();
  return row ? mapJob(row) : null;
}

export async function getLatestContentOpportunityJob(db: Database) {
  const row = await db.prepare(`
    SELECT * FROM content_opportunity_jobs
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).first<JobRow>();
  return row ? mapJob(row) : null;
}

async function claimJob(db: Database, jobId?: number) {
  const now = new Date().toISOString();
  const leaseOwner = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString();
  const target = jobId
    ? "id = ?"
    : `id = (
        SELECT id FROM content_opportunity_jobs
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
    UPDATE content_opportunity_jobs
    SET status = 'processing', lease_owner = ?, lease_expires_at = ?,
      started_at = COALESCE(started_at, ?), attempts = attempts + 1, updated_at = ?
    WHERE ${target}
      AND ((status IN ('queued', 'retry') AND next_run_at <= ?)
        OR (status = 'processing' AND lease_expires_at < ?))
    RETURNING *
  `);
  const values = jobId
    ? [leaseOwner, leaseExpiresAt, now, now, jobId, now, now]
    : [leaseOwner, leaseExpiresAt, now, now, now, now, now, now];
  return statement.bind(...values).first<JobRow>();
}

async function completeJob(db: Database, job: JobRow) {
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE content_opportunity_jobs
    SET status = 'completed', processed_candidates = total_candidates,
      lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(now, now, job.id).run();
  return getContentOpportunityJob(db, job.id);
}

async function retryOrFailJob(db: Database, job: JobRow, message: string) {
  const now = new Date().toISOString();
  const retry = job.attempts < 3;
  const nextRunAt = retry
    ? new Date(Date.now() + Math.min(60_000, 5_000 * 2 ** Math.max(0, job.attempts - 1))).toISOString()
    : now;
  await db.prepare(`
    UPDATE content_opportunity_jobs SET status = ?, last_error = ?,
      lease_owner = NULL, lease_expires_at = NULL, next_run_at = ?,
      finished_at = ?, updated_at = ? WHERE id = ?
  `).bind(
    retry ? "retry" : "failed",
    message.slice(0, 1_000),
    nextRunAt,
    retry ? null : now,
    now,
    job.id,
  ).run();
  console.error("[content-opportunity-job]", JSON.stringify({
    phase: retry ? "batch_retry" : "job_failed",
    jobId: job.id,
    attempt: job.attempts,
    message,
  }));
  return getContentOpportunityJob(db, job.id);
}

async function findActiveJob(db: Database) {
  return db.prepare(`
    SELECT * FROM content_opportunity_jobs
    WHERE job_key = 'evergreen' AND status IN ${ACTIVE_STATUSES}
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).first<JobRow>();
}

function parseCandidates(value: string): EvergreenCandidate[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as EvergreenCandidate[] : [];
  } catch {
    return [];
  }
}

function mapJob(row: JobRow) {
  const progressPercent = row.total_candidates > 0
    ? Math.min(100, Math.round((row.processed_candidates / row.total_candidates) * 100))
    : 100;
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    cursor: row.cursor,
    batchSize: row.batch_size,
    totalCandidates: row.total_candidates,
    processedCandidates: row.processed_candidates,
    progressPercent,
    opportunitiesCreated: row.opportunities_created,
    opportunitiesUpdated: row.opportunities_updated,
    ignored: row.ignored,
    attempts: row.attempts,
    lastError: row.last_error,
    nextRunAt: row.next_run_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na análise evergreen.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
