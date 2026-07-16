import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { ZodError } from "zod";
import { getAiConfig } from "../../../lib/runtime-config";
import { editorialKitDeleteSchema, editorialKitRequestSchema, editorialKitUpdateSchema } from "../../../lib/operational-schemas";
import { buildEditorialIntelligence } from "../../../lib/editorial-intelligence";
import { createEditorialKit, enforcePermanentEditorialPolicy, normalizeEditorialKitPayload } from "../../../lib/editorial-kit";
import { deleteEditorialKit, isEditorialDeleteAuthorized } from "../../../lib/editorial-kit-delete";
import { AiProviderRequestError } from "../../../lib/ai";
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
    if (!decision.produceContent) {
      if (decision.sourceGovernance.status === "confirmation_required") {
        const now = new Date().toISOString();
        await db.prepare("UPDATE news_items SET status = 'pending_confirmation', updated_at = ? WHERE id = ? AND manual_override = FALSE AND status NOT IN ('discarded', 'archived', 'used')").bind(now, decision.id).run();
        return Response.json({ error: "Confirmação oficial obrigatória. Este tema exige uma fonte oficial antes da geração do conteúdo.", code: "official_confirmation_required" }, { status: 409 });
      }
      return Response.json({ error: "A notícia ainda não atende aos critérios editoriais para geração automática.", code: "editorial_criteria_not_met" }, { status: 409 });
    }
    const config = getAiConfig();
    const kit = await createEditorialKit(db, config, decision);
    return Response.json({ kit }, { status: 201 });
  } catch (error) { return tableAwareError(error, 400); }
}

export async function PATCH(request: Request) {
  try {
    const input = editorialKitUpdateSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const now = new Date().toISOString();
    if (input.action === "save") {
      const governedPayload = enforcePermanentEditorialPolicy(input.payload);
      const result = await db.prepare("UPDATE editorial_kits SET title = ?, payload = ?, updated_at = ? WHERE id = ?")
        .bind(governedPayload.blog.seoTitle, JSON.stringify(governedPayload), now, input.id).run();
      if (!result.meta.changes) return Response.json({ error: "Kit Editorial não encontrado." }, { status: 404 });
      return Response.json({ updated: true, updatedAt: now, payload: governedPayload });
    }
    if (input.action === "duplicate") {
      const result = await db.prepare("WITH duplicated AS (INSERT INTO editorial_kits (news_item_id, title, primary_icp, editorial_score, provider, model, payload, status, created_at, updated_at) SELECT news_item_id, title || ' — cópia', primary_icp, editorial_score, provider, model, payload, 'draft', ?, ? FROM editorial_kits WHERE id = ? RETURNING id), copied_sources AS (INSERT INTO editorial_kit_sources (editorial_kit_id, editorial_source_id, title, url, publisher, primary_or_secondary, authority_level, published_at, created_at) SELECT duplicated.id, source.editorial_source_id, source.title, source.url, source.publisher, source.primary_or_secondary, source.authority_level, source.published_at, ? FROM duplicated JOIN editorial_kit_sources source ON source.editorial_kit_id = ? RETURNING editorial_kit_id) SELECT id FROM duplicated").bind(now, now, input.id, now, input.id).run();
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

export async function DELETE(request: Request) {
  if (!isEditorialDeleteAuthorized(request)) {
    return Response.json({ error: "Usuário não autorizado para excluir conteúdo." }, { status: 401 });
  }
  try {
    const input = editorialKitDeleteSchema.parse(await request.json());
    const db = await getRuntimeDb();
    const result = await deleteEditorialKit(db, input.id);
    if (!result.deleted) return Response.json({ error: "Kit Editorial não encontrado." }, { status: 404 });
    return Response.json({ deleted: true, id: result.kitId, removedRelations: result.removedRelations });
  } catch (error) {
    return tableAwareError(error, 400);
  }
}

function toClientKit(row: KitRow) {
  const payload = normalizeEditorialKitPayload(JSON.parse(row.payload), { newsId: row.news_item_id, title: row.title, primaryIcp: row.primary_icp, editorialScore: row.editorial_score, createdAt: row.created_at });
  return { id: row.id, newsItemId: row.news_item_id, title: row.title, primaryIcp: row.primary_icp, editorialScore: row.editorial_score, provider: row.provider, model: row.model, payload, status: row.status, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function tableAwareError(error: unknown, fallbackStatus = 500) {
  if (error instanceof ZodError) return Response.json({ error: "Revise os campos do Kit. Há conteúdo obrigatório ausente ou fora dos limites editoriais.", code: "validation_failed" }, { status: 400 });
  if (error instanceof AiProviderRequestError) {
    const invalidArgument = error.httpStatus === 400 || error.providerStatus === "INVALID_ARGUMENT";
    return Response.json({
      error: invalidArgument
        ? "O Gemini recusou o formato estruturado desta geração. O diagnóstico técnico completo foi registrado e nenhuma informação foi salva."
        : "O serviço de IA não conseguiu concluir a geração. Nenhuma informação foi salva.",
      code: invalidArgument ? "ai_invalid_argument" : "ai_provider_error",
      providerStatus: error.providerStatus,
    }, { status: invalidArgument ? 502 : error.httpStatus >= 500 ? 503 : fallbackStatus });
  }
  const message = error instanceof Error ? error.message : "Falha na Biblioteca Editorial.";
  const schemaPending = /editorial_kits|does not exist|undefined_table/i.test(message);
  const aiTimeout = /Timeout interno da IA/i.test(message);
  return Response.json({ error: schemaPending ? "A migration aditiva da Biblioteca Editorial ainda não foi aplicada." : message, code: schemaPending ? "schema_pending" : aiTimeout ? "ai_timeout" : "request_failed" }, { status: schemaPending ? 503 : aiTimeout ? 504 : fallbackStatus });
}
