import { getRuntimeDb } from "../../../db/runtime";
import { canonicalizeUrl, classifyNews, collectInputSchema, isSafeHttpUrl, parseFeed, sha256 } from "../../../lib/editorial";

type SourceRow = { id: number; name: string; feed_url: string; reliability_score: number };

async function fetchFeed(startUrl: string) {
  let current = startUrl;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    if (!isSafeHttpUrl(current)) throw new Error("A fonte redirecionou para um endereço não permitido.");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
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
    if (length > 2_000_000) throw new Error("O feed excede o limite de 2 MB.");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("O feed excede o limite de 2 MB.");
    return text;
  }
  throw new Error("A fonte excedeu o limite de redirecionamentos.");
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  let sourceId: number | null = null;
  try {
    const input = collectInputSchema.parse(await request.json());
    sourceId = input.sourceId;
    const db = await getRuntimeDb();
    const source = await db.prepare("SELECT id, name, feed_url, reliability_score FROM sources WHERE id = ? AND active = 1").bind(sourceId).first<SourceRow>();
    if (!source) return Response.json({ error: "Fonte não encontrada ou inativa." }, { status: 404 });
    const xml = await fetchFeed(source.feed_url);
    const items = parseFeed(xml);
    if (!items.length) throw new Error("Nenhuma notícia válida foi encontrada no feed.");
    let created = 0;
    let duplicates = 0;
    for (const item of items.slice(0, 30)) {
      const canonicalUrl = canonicalizeUrl(item.originalUrl);
      const titleHash = await sha256(item.title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim());
      const contentHash = await sha256(`${item.title}\n${item.excerpt}`);
      const classification = classifyNews({ title: item.title, excerpt: item.excerpt, publishedAt: item.publishedAt, reliabilityScore: source.reliability_score });
      const result = await db.prepare("INSERT OR IGNORE INTO news_items (external_id, title, original_url, canonical_url, source_id, source_name, author, published_at, collected_at, excerpt, content_hash, title_hash, region, logistics_impact, relevance_score, status, topics, icps, classification_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)")
        .bind(item.externalId, item.title, item.originalUrl, canonicalUrl, source.id, source.name, item.author || null, item.publishedAt, new Date().toISOString(), item.excerpt, contentHash, titleHash, classification.region, classification.logisticsImpact, classification.relevanceScore, JSON.stringify(classification.topics), JSON.stringify([classification.primaryIcp, ...classification.secondaryIcps]), classification.reason).run();
      if (result.meta.changes > 0) created += 1; else duplicates += 1;
    }
    const finishedAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE sources SET last_collected_at = ?, last_error = NULL WHERE id = ?").bind(finishedAt, source.id),
      db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata) VALUES ('collect', 'success', ?, ?, ?, ?)").bind(startedAt, finishedAt, created, JSON.stringify({ sourceId: source.id, duplicates })),
    ]);
    return Response.json({ created, duplicates, processed: items.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na coleta.";
    try {
      const db = await getRuntimeDb();
      const finishedAt = new Date().toISOString();
      if (sourceId) await db.prepare("UPDATE sources SET last_error = ? WHERE id = ?").bind(message.slice(0, 500), sourceId).run();
      await db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, error_message) VALUES ('collect', 'failed', ?, ?, 0, ?)").bind(startedAt, finishedAt, message.slice(0, 500)).run();
    } catch { /* the original error is more useful */ }
    return Response.json({ error: message }, { status: 400 });
  }
}

