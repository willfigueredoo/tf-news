import type { Database } from "../db/runtime.ts";
import type { AiConfig } from "./ai.ts";
import { aiConfigured } from "./ai.ts";
import { buildEditorialIntelligence, type EditorialDecision, type IntelligenceNews } from "./editorial-intelligence.ts";
import { loadIntelligenceNews } from "./intelligence-news.ts";
import { acquireJobLock, releaseJobLock } from "./jobs.ts";
import { buildReelIdeaRelevance, generateReelIdea } from "./reel-ideas.ts";
import { manusConfigured, type ManusConfig } from "./manus.ts";
import { startReelIdeaResearch } from "./reel-idea-research.ts";

export type ReelIdeaAutomationConfig = {
  dailyLimit: number;
  primaryWindowDays: number;
  fallbackWindowDays: number;
  minimumRelevance: number;
};

type ExistingSource = { news_item_id: number; title: string };

export function selectNewsCandidate(
  news: IntelligenceNews[],
  existingSources: ExistingSource[],
  options: {
    now: Date;
    primaryWindowDays: number;
    fallbackWindowDays: number;
    minimumRelevance: number;
    allowFallback: boolean;
  },
) {
  const usedIds = new Set(existingSources.map((item) => item.news_item_id));
  const existingTitles = existingSources.map((item) => item.title);
  const decisions = buildEditorialIntelligence(news, options.now).all.filter((item) =>
    item.produceContent
    && buildReelIdeaRelevance(item, "news", 1).score >= options.minimumRelevance
    && validPublishedAt(item.publishedAt, options.now)
    && !usedIds.has(item.id)
    && !existingTitles.some((title) => similarTitle(title, item.title)),
  );
  const primary = decisions.filter((item) => ageInDays(item.publishedAt, options.now) <= options.primaryWindowDays);
  if (primary.length) return { decision: primary[0], windowDays: options.primaryWindowDays, fallback: false };
  if (!options.allowFallback) return null;
  const fallback = decisions.filter((item) => ageInDays(item.publishedAt, options.now) <= options.fallbackWindowDays);
  return fallback[0] ? { decision: fallback[0], windowDays: options.fallbackWindowDays, fallback: true } : null;
}

export function selectEvergreenCandidate(
  news: IntelligenceNews[],
  existingSources: ExistingSource[],
  options: { now: Date; minimumRelevance: number },
) {
  const usedIds = new Set(existingSources.map((item) => item.news_item_id));
  const existingTitles = existingSources.map((item) => item.title);
  const decisions = buildEditorialIntelligence(news, options.now).all.filter((item) =>
    item.produceContent
    && validPublishedAt(item.publishedAt, options.now)
    && ageInDays(item.publishedAt, options.now) <= 90
    && !usedIds.has(item.id)
    && !existingTitles.some((title) => similarTitle(title, item.title)),
  );
  for (const seed of decisions) {
    const related = decisions
      .filter((item) => item.id !== seed.id && relatedTo(seed, item))
      .sort((a, b) => Number(b.sourceName !== seed.sourceName) - Number(a.sourceName !== seed.sourceName) || b.editorialScore - a.editorialScore)
      .slice(0, 4);
    if (buildReelIdeaRelevance(seed, "evergreen", related.length + 1).score >= options.minimumRelevance) {
      return { decision: seed, related };
    }
  }
  return null;
}

export async function runReelIdeaAutomation(
  db: Database,
  ai: AiConfig,
  automation: ReelIdeaAutomationConfig,
  mode: "news" | "evergreen",
  options: { now?: Date; fetchImpl?: typeof fetch; manus?: ManusConfig } = {},
) {
  if (!aiConfigured(ai)) throw new Error("A IA não está configurada para alimentar o Banco de Ideias.");
  const lockName = `reel-ideas:${mode}`;
  const owner = await acquireJobLock(db, lockName, 58);
  if (!owner) return { status: "locked", mode, created: false } as const;
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  try {
    const [news, existingResult] = await Promise.all([
      loadIntelligenceNews(db),
      db.prepare(`
        SELECT relation.news_item_id, news.title
        FROM reel_idea_sources relation
        JOIN news_items news ON news.id = relation.news_item_id
        UNION
        SELECT job.news_item_id, news.title
        FROM reel_idea_research_jobs job
        JOIN news_items news ON news.id = job.news_item_id
        WHERE job.status IN ('submitting', 'researching', 'ready', 'generating', 'waiting')
      `).all<ExistingSource>(),
    ]);
    const existing = existingResult.results;

    if (mode === "evergreen") {
      const weekStart = saoPauloWeekStart(now).toISOString();
      const createdThisWeek = options.manus && manusConfigured(options.manus)
        ? await countResearchJobs(db, "evergreen", weekStart, now.toISOString())
        : await countIdeas(db, "evergreen", weekStart, now.toISOString());
      if (createdThisWeek > 0) return await logSkipped(db, mode, startedAt, now, "weekly_limit", { createdThisWeek });
      const candidate = selectEvergreenCandidate(news, existing, { now, minimumRelevance: automation.minimumRelevance });
      if (!candidate) return await logSkipped(db, mode, startedAt, now, "no_eligible_candidate", { maximumAgeDays: 90 });
      if (options.manus && manusConfigured(options.manus)) {
        const researchJob = await startReelIdeaResearch(db, options.manus, candidate.decision.id, "automatic", {
          fetchImpl: options.fetchImpl,
          contentType: "evergreen",
          automatic: true,
          selectionWindowDays: null,
          relatedNews: candidate.related,
          now,
        });
        await logResearchStarted(db, mode, startedAt, researchJob);
        return { status: "researching", mode, created: false, researchJob } as const;
      }
      const idea = await generateReelIdea(db, ai, candidate.decision.id, "automatic", {
        fetchImpl: options.fetchImpl,
        contentType: "evergreen",
        automatic: true,
        selectionWindowDays: null,
        relatedNews: candidate.related,
        now,
      });
      if (!idea) throw new Error("A ideia evergreen foi gerada, mas não pôde ser relida.");
      await logSuccess(db, mode, startedAt, now, idea);
      return { status: "created", mode, created: true, idea } as const;
    }

    const { start, end } = saoPauloDayBounds(now);
    const daily = options.manus && manusConfigured(options.manus)
      ? await db.prepare(`
          SELECT COUNT(*)::integer AS count, COALESCE(MAX(selection_window_days), 0)::integer AS window_days
          FROM reel_idea_research_jobs
          WHERE automatic = TRUE AND content_type = 'news' AND created_at >= ? AND created_at < ?
        `).bind(start.toISOString(), end.toISOString()).first<{ count: number; window_days: number }>()
      : await db.prepare(`
          SELECT COUNT(*)::integer AS count, COALESCE(MAX(selection_window_days), 0)::integer AS window_days
          FROM reel_ideas
          WHERE automatic = TRUE AND content_type = 'news' AND created_at >= ? AND created_at < ?
        `).bind(start.toISOString(), end.toISOString()).first<{ count: number; window_days: number }>();
    const createdToday = Number(daily?.count ?? 0);
    if (createdToday >= automation.dailyLimit) {
      return await logSkipped(db, mode, startedAt, now, "daily_limit", { createdToday, dailyLimit: automation.dailyLimit });
    }
    const activeWindow = Number(daily?.window_days ?? 0);
    const candidate = selectNewsCandidate(news, existing, {
      now,
      primaryWindowDays: automation.primaryWindowDays,
      fallbackWindowDays: automation.fallbackWindowDays,
      minimumRelevance: automation.minimumRelevance,
      allowFallback: createdToday === 0 || activeWindow === automation.fallbackWindowDays,
    });
    if (!candidate) return await logSkipped(db, mode, startedAt, now, "no_eligible_candidate", {
      primaryWindowDays: automation.primaryWindowDays,
      fallbackWindowDays: automation.fallbackWindowDays,
      fallbackAllowed: createdToday === 0 || activeWindow === automation.fallbackWindowDays,
    });
    if (options.manus && manusConfigured(options.manus)) {
      const researchJob = await startReelIdeaResearch(db, options.manus, candidate.decision.id, "automatic", {
        fetchImpl: options.fetchImpl,
        contentType: "news",
        automatic: true,
        selectionWindowDays: candidate.windowDays,
        now,
      });
      await logResearchStarted(db, mode, startedAt, researchJob, { fallback: candidate.fallback, windowDays: candidate.windowDays });
      return { status: "researching", mode, created: false, fallback: candidate.fallback, windowDays: candidate.windowDays, researchJob } as const;
    }
    const idea = await generateReelIdea(db, ai, candidate.decision.id, "automatic", {
      fetchImpl: options.fetchImpl,
      contentType: "news",
      automatic: true,
      selectionWindowDays: candidate.windowDays,
      now,
    });
    if (!idea) throw new Error("A ideia de atualidade foi gerada, mas não pôde ser relida.");
    await logSuccess(db, mode, startedAt, now, idea, { fallback: candidate.fallback, windowDays: candidate.windowDays });
    return { status: "created", mode, created: true, fallback: candidate.fallback, windowDays: candidate.windowDays, idea } as const;
  } catch (error) {
    const message = safeError(error);
    await db.prepare(`
      INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, error_message, metadata)
      VALUES (?, 'failed', ?, ?, 0, ?, ?)
    `).bind(`reel-ideas-${mode}`, startedAt, new Date().toISOString(), message, JSON.stringify({ mode, automatic: true })).run();
    throw error;
  } finally {
    await releaseJobLock(db, lockName, owner);
  }
}

function relatedTo(seed: EditorialDecision, candidate: EditorialDecision) {
  if (seed.primaryIcp === candidate.primaryIcp) return true;
  const topics = new Set(seed.topics.map(normalize));
  return candidate.topics.some((topic) => topics.has(normalize(topic)));
}

function validPublishedAt(value: string, now: Date) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() + 5 * 60_000;
}

function ageInDays(value: string, now: Date) {
  return Math.max(0, (now.getTime() - Date.parse(value)) / 86_400_000);
}

function similarTitle(left: string, right: string) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return false;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union >= .72;
}

function titleTokens(value: string) {
  const ignored = new Set(["para", "como", "sobre", "entre", "pela", "pelo", "uma", "das", "dos", "que", "com", "sem"]);
  return new Set(normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !ignored.has(token)));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function saoPauloDayBounds(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(`${date}T03:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function saoPauloWeekStart(now: Date) {
  const { start } = saoPauloDayBounds(now);
  const localWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(localWeekday);
  const daysSinceMonday = (index + 6) % 7;
  return new Date(start.getTime() - daysSinceMonday * 86_400_000);
}

async function countIdeas(db: Database, contentType: string, start: string, end: string) {
  const row = await db.prepare(`
    SELECT COUNT(*)::integer AS count FROM reel_ideas
    WHERE automatic = TRUE AND content_type = ? AND created_at >= ? AND created_at < ?
  `).bind(contentType, start, end).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function countResearchJobs(db: Database, contentType: string, start: string, end: string) {
  const row = await db.prepare(`
    SELECT COUNT(*)::integer AS count FROM reel_idea_research_jobs
    WHERE automatic = TRUE AND content_type = ? AND created_at >= ? AND created_at < ?
  `).bind(contentType, start, end).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function logSkipped(db: Database, mode: string, startedAt: string, now: Date, reason: string, metadata: Record<string, unknown>) {
  await db.prepare(`
    INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata)
    VALUES (?, 'skipped', ?, ?, 0, ?)
  `).bind(`reel-ideas-${mode}`, startedAt, new Date().toISOString(), JSON.stringify({ mode, automatic: true, reason, ...metadata })).run();
  return { status: "skipped", mode, created: false, reason, ...metadata } as const;
}

async function logSuccess(db: Database, mode: string, startedAt: string, now: Date, idea: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  await db.prepare(`
    INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata)
    VALUES (?, 'success', ?, ?, 1, ?)
  `).bind(`reel-ideas-${mode}`, startedAt, new Date().toISOString(), JSON.stringify({ mode, automatic: true, ideaId: idea.id, relevanceScore: idea.relevanceScore, ...metadata })).run();
}

async function logResearchStarted(db: Database, mode: string, startedAt: string, researchJob: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  await db.prepare(`
    INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata)
    VALUES (?, 'success', ?, ?, 0, ?)
  `).bind(`reel-ideas-${mode}`, startedAt, new Date().toISOString(), JSON.stringify({ mode, automatic: true, researchJobId: researchJob.id, stage: "manus_research", ...metadata })).run();
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Falha na automação do Banco de Ideias.")
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
