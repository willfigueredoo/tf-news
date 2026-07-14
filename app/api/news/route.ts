import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { toCsv } from "../../../lib/csv";
import { ICP_CATALOG, newsUpdateSchema } from "../../../lib/editorial";
import { rateLimit } from "../../../lib/api-security";

type NewsRow = {
  id: number; title: string; original_url: string; source_id: number; source_name: string; published_at: string; collected_at: string;
  excerpt: string; content_text: string; author: string | null; region: string; logistics_impact: "low" | "medium" | "high"; relevance_score: number;
  status: string; topics: string; icps: string; primary_icp: string; secondary_icps: string; classification_reason: string; classification_method: string;
  read_at: string | null; favorite: boolean; archived_at: string | null; internal_notes: string; manual_override: boolean;
  collection_run_id: string | null; updated_at: string | null; domain?: string;
};

const SORTS: Record<string, string> = {
  recent: "n.published_at DESC", relevance: "n.relevance_score DESC, n.published_at DESC",
  impact: "CASE n.logistics_impact WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, n.published_at DESC",
  source: "n.source_name ASC, n.published_at DESC", collected: "n.collected_at DESC",
};

export async function GET(request: Request) {
  try {
    const db = await getRuntimeDb();
    const url = new URL(request.url);
    const id = positiveNumber(url.searchParams.get("id"));
    if (id) {
      const row = await db.prepare("SELECT n.*, s.domain FROM news_items n JOIN sources s ON s.id = n.source_id WHERE n.id = ?").bind(id).first<NewsRow>();
      if (!row) return Response.json({ error: "Notícia não encontrada." }, { status: 404 });
      const history = await db.prepare("SELECT id, action, previous_value, next_value, metadata, created_at FROM news_item_history WHERE news_item_id = ? ORDER BY id DESC LIMIT 100").bind(id).all<Record<string, unknown>>();
      return Response.json({ newsItem: mapNews(row), history: rowsOf(history).map(mapHistory) });
    }

    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, ...params: unknown[]) => { clauses.push(sql); values.push(...params); };
    const status = url.searchParams.get("status");
    if (status && status !== "all") add("n.status = ?", status);
    else if (url.searchParams.get("includeDiscarded") !== "true") add("n.status <> 'discarded'");
    if (url.searchParams.get("archived") === "true") add("n.archived_at IS NOT NULL");
    else if (url.searchParams.get("includeArchived") !== "true") add("n.archived_at IS NULL");
    const search = url.searchParams.get("search")?.trim();
    if (search) add("(n.title ILIKE ? OR n.excerpt ILIKE ? OR n.content_text ILIKE ? OR n.original_url ILIKE ? OR n.source_name ILIKE ? OR s.domain ILIKE ?)", ...Array(6).fill(`%${search}%`));
    const sourceId = positiveNumber(url.searchParams.get("sourceId")); if (sourceId) add("n.source_id = ?", sourceId);
    const primaryIcp = url.searchParams.get("primaryIcp"); if (primaryIcp) add("n.primary_icp = ?", primaryIcp);
    const icp = url.searchParams.get("icp"); if (icp) add("n.icps ILIKE ?", `%\"${icp}\"%`);
    const region = url.searchParams.get("region"); if (region) add("n.region = ?", region);
    const topic = url.searchParams.get("topic"); if (topic) add("n.topics ILIKE ?", `%\"${topic}\"%`);
    const impact = url.searchParams.get("impact"); if (impact) add("n.logistics_impact = ?", impact);
    const minimum = Number(url.searchParams.get("minimumRelevance")); if (Number.isFinite(minimum) && minimum > 0) add("n.relevance_score >= ?", minimum);
    const dateFrom = url.searchParams.get("dateFrom"); if (dateFrom) add("n.published_at >= ?", dateFrom);
    const dateTo = url.searchParams.get("dateTo"); if (dateTo) add("n.published_at <= ?", dateTo);
    const read = url.searchParams.get("read"); if (read === "true") add("n.read_at IS NOT NULL"); else if (read === "false") add("n.read_at IS NULL");
    const favorite = url.searchParams.get("favorite"); if (favorite === "true") add("n.favorite = TRUE"); else if (favorite === "false") add("n.favorite = FALSE");
    const runId = url.searchParams.get("collectionRunId"); if (runId) add("n.collection_run_id = ?", runId);
    const ids = (url.searchParams.get("ids") ?? "").split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0).slice(0, 200);
    if (ids.length) add(`n.id IN (${ids.map(() => "?").join(",")})`, ...ids);

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const format = url.searchParams.get("format");
    const pageSize = format === "csv" ? 5000 : Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const order = SORTS[url.searchParams.get("sort") ?? "relevance"] ?? SORTS.relevance;
    const count = await db.prepare(`SELECT COUNT(*)::int AS total FROM news_items n JOIN sources s ON s.id = n.source_id ${where}`).bind(...values).first<{ total: number }>();
    const result = await db.prepare(`SELECT n.*, s.domain FROM news_items n JOIN sources s ON s.id = n.source_id ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all<NewsRow>();
    const news = rowsOf(result).map(mapNews);
    if (format === "csv") {
      return new Response(toCsv(news as Array<Record<string, unknown>>, [
        { key: "title", label: "Título" }, { key: "excerpt", label: "Resumo" }, { key: "sourceName", label: "Fonte" },
        { key: "domain", label: "Domínio" }, { key: "originalUrl", label: "URL" }, { key: "publishedAt", label: "Publicação" },
        { key: "collectedAt", label: "Coleta" }, { key: "primaryIcp", label: "ICP principal" }, { key: "secondaryIcps", label: "ICPs secundários" },
        { key: "topics", label: "Temas" }, { key: "region", label: "Região" }, { key: "relevanceScore", label: "Relevância" },
        { key: "logisticsImpact", label: "Impacto" }, { key: "status", label: "Status" }, { key: "read", label: "Lida" },
        { key: "favorite", label: "Favorita" }, { key: "archived", label: "Arquivada" }, { key: "internalNotes", label: "Observações" },
      ]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=tf-news-monitoramento.csv" } });
    }
    return Response.json({ news, pagination: { page, pageSize, total: count?.total ?? 0, totalPages: Math.max(1, Math.ceil((count?.total ?? 0) / pageSize)) } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao carregar notícias." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const limited = rateLimit(request, "news-update", 120, 60_000); if (limited) return limited;
  try {
    const input = newsUpdateSchema.parse(await request.json());
    const db = await getRuntimeDb();
    if (input.primaryIcp && !validIcp(input.primaryIcp)) return Response.json({ error: "ICP principal inválido." }, { status: 400 });
    if (input.secondaryIcp && !validIcp(input.secondaryIcp)) return Response.json({ error: "ICP secundário inválido." }, { status: 400 });
    const placeholders = input.newsIds.map(() => "?").join(",");
    const current = await db.prepare(`SELECT * FROM news_items WHERE id IN (${placeholders})`).bind(...input.newsIds).all<NewsRow>();
    if (!current.results?.length) return Response.json({ error: "Nenhuma notícia encontrada." }, { status: 404 });
    const now = new Date().toISOString();
    const statements = [];

    for (const row of rowsOf(current)) {
      const before = snapshot(row);
      let after: Record<string, unknown> = {};
      if (input.action === "setIcp") {
        if (!input.primaryIcp) throw new Error("Informe o ICP principal.");
        const secondary = parseList(row.secondary_icps).filter((value) => value !== input.primaryIcp);
        after = { primaryIcp: input.primaryIcp, secondaryIcps: secondary };
        statements.push(db.prepare("UPDATE news_items SET primary_icp = ?, secondary_icps = ?, icps = ?, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?").bind(input.primaryIcp, JSON.stringify(secondary), JSON.stringify([input.primaryIcp, ...secondary]), now, now, row.id));
      } else if (input.action === "addSecondaryIcp") {
        if (!input.secondaryIcp) throw new Error("Informe o ICP secundário.");
        const secondary = [...new Set([...parseList(row.secondary_icps), input.secondaryIcp])].filter((value) => value !== row.primary_icp).slice(0, 7);
        after = { secondaryIcps: secondary };
        statements.push(db.prepare("UPDATE news_items SET secondary_icps = ?, icps = ?, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(secondary), JSON.stringify([row.primary_icp, ...secondary]), now, now, row.id));
      } else if (input.action === "setTopics" || input.action === "addTag") {
        const topics = input.action === "setTopics" ? (input.topics ?? []) : [...new Set([...parseList(row.topics), input.tag ?? ""])].filter(Boolean);
        after = { topics };
        statements.push(db.prepare("UPDATE news_items SET topics = ?, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(topics), now, now, row.id));
      } else if (input.action === "setRelevance") {
        if (input.relevanceScore === undefined) throw new Error("Informe a relevância.");
        after = { relevanceScore: input.relevanceScore };
        statements.push(db.prepare("UPDATE news_items SET relevance_score = ?, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?").bind(input.relevanceScore, now, now, row.id));
      } else if (input.action === "setImpact") {
        if (!input.logisticsImpact) throw new Error("Informe o impacto.");
        after = { logisticsImpact: input.logisticsImpact };
        statements.push(db.prepare("UPDATE news_items SET logistics_impact = ?, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?").bind(input.logisticsImpact, now, now, row.id));
      } else if (input.action === "addNote") {
        after = { internalNotes: input.note ?? "" };
        statements.push(db.prepare("UPDATE news_items SET internal_notes = ?, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?").bind(input.note ?? "", now, now, row.id));
      } else {
        const change = simpleChange(input.action, now);
        after = change.after;
        statements.push(db.prepare(`UPDATE news_items SET ${change.sql}, manual_override = TRUE, manually_edited_at = ?, updated_at = ? WHERE id = ?`).bind(...change.values, now, now, row.id));
      }
      statements.push(db.prepare("INSERT INTO news_item_history (news_item_id, action, previous_value, next_value, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(row.id, input.action, JSON.stringify(before), JSON.stringify(after), JSON.stringify({ batchSize: input.newsIds.length }), now));
    }
    await db.batch(statements);
    return Response.json({ updated: current.results?.length ?? 0, action: input.action });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha ao atualizar notícia." }, { status: 400 }); }
}

function simpleChange(action: string, now: string) {
  if (action === "read") return { sql: "read_at = ?", values: [now], after: { read: true } };
  if (action === "unread") return { sql: "read_at = NULL", values: [], after: { read: false } };
  if (action === "favorite") return { sql: "favorite = TRUE", values: [], after: { favorite: true } };
  if (action === "unfavorite") return { sql: "favorite = FALSE", values: [], after: { favorite: false } };
  if (action === "archive") return { sql: "status = 'archived', archived_at = ?", values: [now], after: { status: "archived", archived: true } };
  if (action === "restore") return { sql: "status = 'new', archived_at = NULL", values: [], after: { status: "new", archived: false } };
  const status = action === "relevant" ? "relevant" : action === "discard" ? "discarded" : action === "analysis" ? "analysis" : action === "selected" ? "selected" : action === "used" ? "used" : "new";
  return { sql: "status = ?", values: [status], after: { status } };
}

function mapNews(row: NewsRow) {
  return {
    id: row.id, title: row.title, originalUrl: row.original_url, sourceId: row.source_id, sourceName: row.source_name,
    domain: row.domain ?? "", author: row.author, publishedAt: row.published_at, collectedAt: row.collected_at,
    excerpt: row.excerpt, content: row.content_text, region: row.region, logisticsImpact: row.logistics_impact,
    relevanceScore: row.relevance_score, status: row.status, topics: parseList(row.topics), icps: parseList(row.icps),
    primaryIcp: row.primary_icp, secondaryIcps: parseList(row.secondary_icps), classificationReason: row.classification_reason,
    classificationMethod: row.classification_method, readAt: row.read_at, read: Boolean(row.read_at), favorite: row.favorite,
    archivedAt: row.archived_at, archived: Boolean(row.archived_at), internalNotes: row.internal_notes,
    manualOverride: row.manual_override, collectionRunId: row.collection_run_id, updatedAt: row.updated_at,
  };
}

function mapHistory(row: Record<string, unknown>) {
  return { id: row.id, action: row.action, previousValue: parseJson(row.previous_value), nextValue: parseJson(row.next_value), metadata: parseJson(row.metadata), createdAt: row.created_at };
}

function snapshot(row: NewsRow) { return { status: row.status, primaryIcp: row.primary_icp, secondaryIcps: parseList(row.secondary_icps), topics: parseList(row.topics), relevanceScore: row.relevance_score, logisticsImpact: row.logistics_impact, read: Boolean(row.read_at), favorite: row.favorite, archived: Boolean(row.archived_at), internalNotes: row.internal_notes }; }
function parseList(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function parseJson(value: unknown) { if (typeof value !== "string") return value ?? null; try { return JSON.parse(value); } catch { return value; } }
function validIcp(value: string) { return ICP_CATALOG.some((icp) => icp.name === value); }
function positiveNumber(value: string | null) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
