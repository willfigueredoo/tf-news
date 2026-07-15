import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { getAiConfig } from "../../../lib/runtime-config";
import { editorialKitRequestSchema, editorialKitUpdateSchema } from "../../../lib/operational-schemas";
import { buildEditorialIntelligence } from "../../../lib/editorial-intelligence";
import { generateEditorialKit } from "../../../lib/editorial-kit";
import { loadIntelligenceNews } from "../intelligence/route";

type KitRow = { id: number; news_item_id: number; title: string; primary_icp: string; editorial_score: number; provider: string; model: string; payload: string; status: string; archived_at: string | null; created_at: string; updated_at: string };

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const result = await db.prepare("SELECT id, news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, archived_at, created_at, updated_at FROM editorial_kits ORDER BY updated_at DESC LIMIT 200").all<KitRow>();
    return Response.json({ kits: rowsOf(result).map(toClientKit) });
  } catch (error) { return tableAwareError(error); }
}

export async function POST(request: Request) {
  try {
    const input = editorialKitRequestSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const schema = await db.prepare("SELECT to_regclass('public.editorial_kits') AS editorial_kits").first<{ editorial_kits: string | null }>();
    if (!schema?.editorial_kits) return Response.json({ error: "A migration aditiva da Biblioteca Editorial ainda não foi aplicada.", code: "schema_pending" }, { status: 503 });
    const news = await loadIntelligenceNews(db, input.newsId);
    if (!news.length) return Response.json({ error: "Notícia não encontrada." }, { status: 404 });
    const decision = buildEditorialIntelligence(news).newsOfTheDay;
    if (!decision) return Response.json({ error: "A notícia não está disponível para decisão editorial." }, { status: 409 });
    const config = getAiConfig();
    const payload = await generateEditorialKit(db, config, decision);
    const now = new Date().toISOString();
    const insert = await db.prepare("INSERT INTO editorial_kits (news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?) RETURNING id")
      .bind(decision.id, payload.blogSeo.seoTitle, decision.primaryIcp, decision.editorialScore, config.provider, config.model, JSON.stringify(payload), now, now).run();
    return Response.json({ kit: { id: Number(insert.meta.last_row_id), newsItemId: decision.id, title: payload.blogSeo.seoTitle, primaryIcp: decision.primaryIcp, editorialScore: decision.editorialScore, provider: config.provider, model: config.model, payload, status: "draft", archivedAt: null, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) { return tableAwareError(error, 400); }
}

export async function PATCH(request: Request) {
  try {
    const input = editorialKitUpdateSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const now = new Date().toISOString();
    if (input.action === "duplicate") {
      const result = await db.prepare("INSERT INTO editorial_kits (news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, created_at, updated_at) SELECT news_item_id, title || ' — cópia', primary_icp, editorial_score, provider, model, payload, 'draft', ?, ? FROM editorial_kits WHERE id = ? RETURNING id").bind(now, now, input.id).run();
      if (!result.meta.last_row_id) return Response.json({ error: "Kit Editorial não encontrado." }, { status: 404 });
      return Response.json({ id: Number(result.meta.last_row_id), duplicated: true });
    }
    const archive = input.action === "archive" ? now : null;
    const status = input.action === "archive" ? "archived" : "draft";
    const result = await db.prepare("UPDATE editorial_kits SET archived_at = ?, status = ?, updated_at = ? WHERE id = ?").bind(archive, status, now, input.id).run();
    if (!result.meta.changes) return Response.json({ error: "Kit Editorial não encontrado." }, { status: 404 });
    return Response.json({ updated: true });
  } catch (error) { return tableAwareError(error, 400); }
}

function toClientKit(row: KitRow) {
  return { id: row.id, newsItemId: row.news_item_id, title: row.title, primaryIcp: row.primary_icp, editorialScore: row.editorial_score, provider: row.provider, model: row.model, payload: JSON.parse(row.payload), status: row.status, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function tableAwareError(error: unknown, fallbackStatus = 500) {
  const message = error instanceof Error ? error.message : "Falha na Biblioteca Editorial.";
  const schemaPending = /editorial_kits|does not exist|undefined_table/i.test(message);
  return Response.json({ error: schemaPending ? "A migration aditiva da Biblioteca Editorial ainda não foi aplicada." : message, code: schemaPending ? "schema_pending" : "request_failed" }, { status: schemaPending ? 503 : fallbackStatus });
}
