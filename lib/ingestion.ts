import { aiConfigured, runStructuredAi, type AiConfig } from "./ai.ts";
import { canonicalizeUrl, classifyNews, isSafeHttpUrl, parseFeed, parseFeedMetadata, sha256, type Classification, type ParsedFeedItem } from "./editorial.ts";
import { acquireJobLock, releaseJobLock } from "./jobs.ts";
import { classificationBatchSchema } from "./operational-schemas.ts";
import type { Database } from "../db/runtime.ts";
import { lookup } from "node:dns/promises";

type SourceRow = { id: number; name: string; feed_url: string; reliability_score: number; collection_frequency_minutes?: number };
type Candidate = ParsedFeedItem & { canonicalUrl: string; titleHash: string; contentHash: string; deterministic: Classification };

export async function fetchFeed(startUrl: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number; retries?: number } = {}) {
  const started = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 1;
  let lastError = "Falha ao acessar o feed.";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      let current = startUrl;
      for (let redirect = 0; redirect <= 2; redirect += 1) {
        if (!isSafeHttpUrl(current)) throw new Error("A fonte redirecionou para um endereço não permitido.");
        if (fetchImpl === fetch) await assertPublicDns(current);
        const response = await fetchImpl(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
          headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9", "User-Agent": "TF-News/1.0 (+editorial-monitor)" },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirecionamento inválido na fonte.");
          current = new URL(location, current).toString();
          continue;
        }
        if (!response.ok) throw new Error(`A fonte respondeu com status ${response.status}.`);
        const type = response.headers.get("content-type") ?? "";
        if (!/(xml|rss|atom|text)/i.test(type)) throw new Error("O conteúdo retornado não parece ser RSS ou Atom.");
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > 3_000_000) throw new Error("O feed excede o limite de 3 MB.");
        const xml = await response.text();
        if (xml.length > 3_000_000) throw new Error("O feed excede o limite de 3 MB.");
        const items = parseFeed(xml);
        if (!items.length) throw new Error("Nenhuma notícia válida foi encontrada no feed.");
        const metadata = parseFeedMetadata(xml);
        return { xml, items, finalUrl: current, httpStatus: response.status, contentType: type, redirects: redirect, durationMs: Date.now() - started, ...metadata };
      }
      throw new Error("A fonte excedeu o limite de redirecionamentos.");
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw new Error(lastError);
}

async function assertPublicDns(value: string) {
  const hostname = new URL(value).hostname;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("O endereço do feed foi bloqueado pela proteção SSRF.");
  }
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  const ipv4 = normalized.match(/^(?:\d{1,3}\.){3}\d{1,3}$/) ? normalized.split(".").map(Number) : normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1].split(".").map(Number);
  if (!ipv4 || ipv4.length !== 4) return false;
  const [a, b] = ipv4;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export async function testFeed(feedUrl: string, fetchImpl?: typeof fetch) {
  const result = await fetchFeed(feedUrl, { fetchImpl, retries: 0 });
  return {
    valid: true,
    httpStatus: result.httpStatus,
    itemCount: result.items.length,
    title: result.title,
    latestItemAt: result.items.map((item) => item.publishedAt).sort().at(-1) ?? null,
    encoding: result.encoding,
    format: result.format,
    contentType: result.contentType,
    finalUrl: result.finalUrl,
    redirects: result.redirects,
    durationMs: result.durationMs,
    usesHttps: result.finalUrl.startsWith("https://"),
    sample: result.items.slice(0, 3).map((item) => ({ title: item.title, url: item.originalUrl, publishedAt: item.publishedAt })),
  };
}

export async function inspectFeed(feedUrl: string, fetchImpl?: typeof fetch) {
  const started = Date.now();
  try {
    return { status: "valid" as const, ...(await testFeed(feedUrl, fetchImpl)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao testar o feed.";
    const normalized = message.toLowerCase();
    const status = normalized.includes("timeout") || normalized.includes("aborted")
      ? "timeout"
      : normalized.includes("não permitido") || normalized.includes("bloque")
        ? "blocked"
        : normalized.includes("nenhuma notícia")
          ? "empty"
          : normalized.includes("rss") || normalized.includes("atom") || normalized.includes("xml")
            ? "unsupported"
            : "invalid";
    return { valid: false, status, error: message, durationMs: Date.now() - started };
  }
}

export async function collectSource(db: Database, source: SourceRow, aiConfig: AiConfig, options: { fetchImpl?: typeof fetch; maxItems?: number; trigger?: "manual" | "automatic" } = {}) {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  try {
    const feed = await fetchFeed(source.feed_url, { fetchImpl: options.fetchImpl, retries: 2 });
    const candidates: Candidate[] = [];
    let duplicates = 0;
    for (const item of feed.items.slice(0, options.maxItems ?? 30)) {
      const canonicalUrl = canonicalizeUrl(item.originalUrl);
      const titleHash = await sha256(item.title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim());
      const contentHash = await sha256(`${item.title}\n${item.excerpt}\n${item.content}`);
      const duplicate = await db.prepare("SELECT id FROM news_items WHERE canonical_url = ? OR title_hash = ? OR content_hash = ? OR (external_id = ? AND source_id = ?) LIMIT 1")
        .bind(canonicalUrl, titleHash, contentHash, item.externalId, source.id).first<{ id: number }>();
      if (duplicate) { duplicates += 1; continue; }
      candidates.push({ ...item, canonicalUrl, titleHash, contentHash, deterministic: classifyNews({ title: item.title, excerpt: `${item.excerpt} ${item.content.slice(0, 2500)}`, publishedAt: item.publishedAt, reliabilityScore: source.reliability_score }) });
    }

    const aiClassifications = await classifyBatchWithAi(db, aiConfig, candidates);
    let created = 0;
    let aiClassified = 0;
    for (const candidate of candidates) {
      const aiResult = aiClassifications.get(candidate.externalId);
      const classification = aiResult ?? candidate.deterministic;
      const method = aiResult ? "hybrid-ai" : "deterministic";
      const result = await db.prepare("INSERT INTO news_items (external_id, title, original_url, canonical_url, source_id, source_name, author, published_at, collected_at, excerpt, content_text, content_hash, title_hash, region, logistics_impact, relevance_score, status, topics, icps, primary_icp, secondary_icps, classification_reason, classification_method, collection_run_id, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM news_items WHERE canonical_url = ? OR title_hash = ? OR content_hash = ? OR (external_id = ? AND source_id = ?))")
        .bind(candidate.externalId, candidate.title, candidate.originalUrl, candidate.canonicalUrl, source.id, source.name, candidate.author || null, candidate.publishedAt, new Date().toISOString(), candidate.excerpt, candidate.content, candidate.contentHash, candidate.titleHash, classification.region, classification.logisticsImpact, classification.relevanceScore, JSON.stringify(classification.topics), JSON.stringify([classification.primaryIcp, ...classification.secondaryIcps]), classification.primaryIcp, JSON.stringify(classification.secondaryIcps), classification.reason, method, runId, new Date().toISOString(), candidate.canonicalUrl, candidate.titleHash, candidate.contentHash, candidate.externalId, source.id).run();
      if (result.meta.changes > 0) { created += 1; if (aiResult) aiClassified += 1; } else duplicates += 1;
    }
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    const nextCollectionAt = new Date(Date.now() + (source.collection_frequency_minutes ?? 720) * 60_000).toISOString();
    await db.batch([
      db.prepare("UPDATE sources SET last_collected_at = ?, last_success_at = ?, last_error = NULL, last_status = 'success', last_duration_ms = ?, last_http_status = ?, last_item_count = ?, consecutive_failures = 0, next_collection_at = ?, total_news_collected = total_news_collected + ?, average_response_ms = CASE WHEN average_response_ms = 0 THEN ? ELSE ROUND((average_response_ms + ?) / 2.0)::integer END, updated_at = ? WHERE id = ?").bind(finishedAt, finishedAt, durationMs, feed.httpStatus, feed.items.length, nextCollectionAt, created, durationMs, durationMs, finishedAt, source.id),
      db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata) VALUES ('collect', 'success', ?, ?, ?, ?)").bind(startedAt, finishedAt, created, JSON.stringify({ runId, trigger: options.trigger ?? "manual", sourceId: source.id, sourceName: source.name, found: feed.items.length, newItems: created, duplicates, ignored: 0, aiClassified, durationMs, httpStatus: feed.httpStatus })),
    ]);
    return { runId, sourceId: source.id, sourceName: source.name, found: feed.items.length, created, duplicates, ignored: 0, processed: feed.items.length, aiClassified, durationMs, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na coleta.";
    const finishedAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE sources SET last_error = ?, last_status = 'failed', last_failure_at = ?, last_duration_ms = ?, consecutive_failures = consecutive_failures + 1, updated_at = ? WHERE id = ?").bind(message.slice(0, 500), finishedAt, Date.now() - started, finishedAt, source.id),
      db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, error_message, metadata) VALUES ('collect', 'failed', ?, ?, 0, ?, ?)").bind(startedAt, finishedAt, message.slice(0, 500), JSON.stringify({ runId, trigger: options.trigger ?? "manual", sourceId: source.id, sourceName: source.name, found: 0, newItems: 0, duplicates: 0, ignored: 0, durationMs: Date.now() - started })),
    ]);
    throw new Error(message);
  }
}

export async function collectAllSources(db: Database, aiConfig: AiConfig, options: { fetchImpl?: typeof fetch; maxItems?: number } = {}) {
  const owner = await acquireJobLock(db, "collect-all", 20 * 60);
  if (!owner) return { locked: true, results: [], successes: 0, failures: 0, created: 0 };
  const startedAt = new Date().toISOString();
  try {
    const sourceResult = await db.prepare("SELECT id, name, feed_url, reliability_score, collection_frequency_minutes FROM sources WHERE active = TRUE AND archived_at IS NULL ORDER BY priority DESC, id").all<SourceRow>();
    const results: Array<Record<string, unknown>> = [];
    let successes = 0; let failures = 0; let created = 0;
    for (const source of sourceResult.results ?? []) {
      try {
        const result = await collectSource(db, source, aiConfig, { ...options, trigger: "automatic" });
        results.push({ ...result, status: "success" }); successes += 1; created += result.created;
      } catch (error) {
        results.push({ sourceId: source.id, sourceName: source.name, status: "failed", error: error instanceof Error ? error.message : "Falha na coleta." }); failures += 1;
      }
    }
    const finishedAt = new Date().toISOString();
    await db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata) VALUES ('collect-all', ?, ?, ?, ?, ?)")
      .bind(failures ? (successes ? "partial" : "failed") : "success", startedAt, finishedAt, created, JSON.stringify({ successes, failures, results })).run();
    return { locked: false, results, successes, failures, created };
  } finally {
    await releaseJobLock(db, "collect-all", owner);
  }
}

async function classifyBatchWithAi(db: Database, config: AiConfig, candidates: Candidate[]) {
  const result = new Map<string, Classification>();
  if (!candidates.length || !aiConfigured(config)) return result;
  try {
    const response = await runStructuredAi({
      db, config, operation: "classification", schemaName: "tf_news_classification_batch", schema: classificationBatchSchema,
      system: "Você classifica notícias B2B brasileiras. Use apenas os fatos fornecidos. Combine a taxonomia ICP informada com julgamento editorial. Retorne JSON estrito, sem texto adicional.",
      user: JSON.stringify({
        allowedIcps: ["Agronegócio", "Máquinas e Equipamentos Pesados", "Indústria Química", "Termoplásticos", "Aço", "Tintas", "Nutrição Animal", "ACM", "Mercado e Logística"],
        news: candidates.map((item) => ({ externalId: item.externalId, title: item.title, summary: item.excerpt, content: item.content.slice(0, 3500), publishedAt: item.publishedAt, deterministicBaseline: item.deterministic })),
      }),
      maxOutputTokens: Math.min(6000, 500 + candidates.length * 350),
    });
    for (const item of response.data.items) result.set(item.externalId, item.classification);
  } catch {
    // Deterministic classification remains available and is explicitly recorded.
  }
  return result;
}
