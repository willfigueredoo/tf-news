import { ZodError } from "zod";
import { getRuntimeDb } from "../../../db/runtime";
import { AiProviderRequestError } from "../../../lib/ai";
import { rateLimit } from "../../../lib/api-security";
import { isEditorialDeleteAuthorized } from "../../../lib/editorial-kit-delete";
import {
  EditorialWorkflowConflictError,
  enqueueEditorialNews,
  generateEditorialKitForNews,
} from "../../../lib/editorial-workflow";
import { getAiConfig } from "../../../lib/runtime-config";
import {
  analyzeSeoCompetitor,
  refreshSeoIntelligence,
} from "../../../lib/seo-engine";
import { seoActionSchema, seoSiteUpdateSchema } from "../../../lib/seo-schemas";
import {
  loadSeoIntelligenceSnapshot,
  updatePrimarySeoSite,
} from "../../../lib/seo-service";
import {
  createSeoCompetitor,
  discoverCompetitorSources,
  removeSeoCompetitor,
  syncPrimarySeoSite,
  syncSeoCompetitor,
  updateSeoCompetitor,
} from "../../../lib/seo-sync";

export const maxDuration = 60;

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const snapshot = await loadSeoIntelligenceSnapshot(db, getAiConfig());
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return seoError(error);
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "seo-intelligence-write", 20, 60_000);
  if (limited) return limited;

  try {
    const body = await request.json();
    const db = await getRuntimeDb();
    const config = getAiConfig();

    if (body?.action === "update_site") {
      const input = seoSiteUpdateSchema.parse(body);
      const siteId = await updatePrimarySeoSite(db, input);
      return Response.json({ updated: true, siteId });
    }

    const input = seoActionSchema.parse(body);
    switch (input.action) {
      case "sync_site": {
        const sync = await syncPrimarySeoSite(db, { trigger: "manual" });
        const intelligence = await refreshSeoIntelligence(db, config, { withAi: false });
        return Response.json({ sync, intelligence });
      }
      case "refresh_intelligence": {
        const intelligence = await refreshSeoIntelligence(db, config, {
          withAi: true,
          forceAi: input.forceAi,
        });
        return Response.json({ intelligence });
      }
      case "discover_competitor": {
        const discovery = await discoverCompetitorSources(input);
        return Response.json(discovery);
      }
      case "save_competitor": {
        const competitor = await createSeoCompetitor(db, input);
        let sync: Awaited<ReturnType<typeof syncSeoCompetitor>> | null = null;
        let syncError: string | null = null;
        try {
          sync = await syncSeoCompetitor(db, competitor.id, { trigger: "manual" });
          await refreshSeoIntelligence(db, config, { withAi: false });
        } catch (error) {
          syncError = safeMessage(error);
        }
        return Response.json({ competitor, sync, syncError }, { status: 201 });
      }
      case "sync_competitor": {
        const sync = await syncSeoCompetitor(db, input.competitorId, { trigger: "manual" });
        const intelligence = await refreshSeoIntelligence(db, config, { withAi: false });
        return Response.json({ sync, intelligence });
      }
      case "analyze_competitor": {
        const analysis = await analyzeSeoCompetitor(db, config, input.competitorId, input.force);
        return Response.json({ analysis });
      }
      case "update_competitor": {
        const competitor = await updateSeoCompetitor(db, {
          id: input.competitorId,
          name: input.name,
          notes: input.notes,
          active: input.active,
        });
        return Response.json({ competitor });
      }
      case "delete_competitor": {
        if (!isEditorialDeleteAuthorized(request)) {
          return Response.json({ error: "Usuário não autorizado para remover concorrentes." }, { status: 401 });
        }
        const deleted = await removeSeoCompetitor(db, input.competitorId);
        if (!deleted) return Response.json({ error: "Concorrente não encontrado." }, { status: 404 });
        await refreshSeoIntelligence(db, config, { withAi: false });
        return Response.json({ deleted: true, competitorId: input.competitorId });
      }
      case "opportunity": {
        return await runOpportunityAction(db, config, input.opportunityId, input.operation);
      }
    }
  } catch (error) {
    return seoError(error, 400);
  }
}

async function runOpportunityAction(
  db: Awaited<ReturnType<typeof getRuntimeDb>>,
  config: ReturnType<typeof getAiConfig>,
  opportunityId: number,
  operation: "review" | "discard" | "reanalyze" | "create_queue" | "generate_kit",
) {
  const opportunity = await db.prepare("SELECT id, news_ids, status FROM seo_opportunities WHERE id = ? AND status <> 'expired'")
    .bind(opportunityId).first<{ id: number; news_ids: string; status: string }>();
  if (!opportunity) return Response.json({ error: "Oportunidade não encontrada ou expirada." }, { status: 404 });
  const now = new Date().toISOString();

  if (operation === "review") {
    await db.prepare("UPDATE seo_opportunities SET status = 'reviewed', reviewed_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, opportunityId).run();
    return Response.json({ updated: true, status: "reviewed" });
  }
  if (operation === "discard") {
    await db.prepare("UPDATE seo_opportunities SET status = 'discarded', discarded_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, opportunityId).run();
    return Response.json({ updated: true, status: "discarded" });
  }
  if (operation === "reanalyze") {
    const intelligence = await refreshSeoIntelligence(db, config, { withAi: true, forceAi: true });
    return Response.json({ intelligence });
  }

  const newsId = firstNewsId(opportunity.news_ids);
  if (!newsId) {
    return Response.json({
      error: "Esta oportunidade ainda não possui uma notícia real vinculada para criar pauta ou Kit Editorial.",
      code: "missing_news_reference",
    }, { status: 409 });
  }
  if (operation === "create_queue") {
    const queue = await enqueueEditorialNews(db, newsId, "seo_opportunity");
    await db.prepare("UPDATE seo_opportunities SET status = 'accepted', editorial_queue_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
      .bind(queue?.id ?? null, now, now, opportunityId).run();
    return Response.json({ queue, navigateTo: "queue" }, { status: 201 });
  }

  const generated = await generateEditorialKitForNews(db, newsId, { origin: "seo_opportunity" });
  await db.prepare("UPDATE seo_opportunities SET status = 'converted_to_kit', editorial_queue_id = ?, editorial_kit_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
    .bind(generated.queue?.id ?? null, generated.kit?.id ?? null, now, now, opportunityId).run();
  return Response.json({
    ...generated,
    navigateTo: "library",
  }, { status: 201 });
}

function firstNewsId(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const id = parsed.map(Number).find((item) => Number.isInteger(item) && item > 0);
    return id ?? null;
  } catch {
    return null;
  }
}

function seoError(error: unknown, fallbackStatus = 500) {
  const technical = safeMessage(error);
  console.error("[seo-intelligence]", technical);
  if (error instanceof EditorialWorkflowConflictError) {
    return Response.json({
      error: error.message,
      code: error.conflict.code,
      conflict: error.conflict,
    }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({
      error: "Revise os campos informados antes de continuar.",
      code: "validation_error",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, { status: 400 });
  }
  if (error instanceof AiProviderRequestError) {
    return Response.json({
      error: "A análise do Gemini não foi concluída. Os dados já sincronizados permanecem intactos.",
      code: "ai_provider_error",
    }, { status: error.httpStatus >= 500 ? 503 : 502 });
  }
  const schemaPending = /seo_sites|seo_articles|seo_opportunities|does not exist|undefined_table/i.test(technical);
  return Response.json({
    error: schemaPending
      ? "A migration aditiva da Inteligência SEO ainda não foi aplicada."
      : technical,
    code: schemaPending ? "schema_pending" : "request_failed",
  }, { status: schemaPending ? 503 : fallbackStatus });
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao processar a Inteligência SEO.";
  return message
    .replace(/(key|token|password|authorization|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}
