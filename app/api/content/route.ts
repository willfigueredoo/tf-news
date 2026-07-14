import { getRuntimeDb, rowsOf, type Database } from "../../../db/runtime";
import { sanitizeWordPressHtml, slugify, validateArticleHtml } from "../../../lib/article-html";
import { contentInputSchema } from "../../../lib/editorial";
import { evaluateCoherence, generateArticleWithAi, generateBriefWithAi, type EditorialNews } from "../../../lib/editorial-ai";
import { briefPayloadSchema } from "../../../lib/operational-schemas";
import { getAiConfig } from "../../../lib/runtime-config";

type SelectedNewsRow = { id: number; title: string; source_name: string; original_url: string; published_at: string; excerpt: string; content_text: string; region: string; logistics_impact: string; topics: string; icps: string; primary_icp: string };
type BriefRow = { id: number; title: string; selected_icp: string; objective: string; primary_keyword: string; payload: string; news_ids: string };

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const result = await db.prepare("SELECT a.*, p.wordpress_post_id, p.wordpress_url, p.wordpress_edit_url, p.wordpress_status FROM articles a LEFT JOIN wordpress_publications p ON p.article_id = a.id ORDER BY a.updated_at DESC LIMIT 100").all<Record<string, unknown>>();
    return Response.json({ articles: rowsOf(result).map((row) => ({
      id: row.id, briefId: row.brief_id, title: row.title, slug: row.slug, excerpt: row.excerpt, content: row.content,
      metaTitle: row.meta_title, metaDescription: row.meta_description, primaryKeyword: row.primary_keyword,
      status: row.status, qualityScore: row.quality_score, factualConfidence: row.factual_confidence, createdAt: row.created_at, updatedAt: row.updated_at,
      wordpressPostId: row.wordpress_post_id ?? null, wordpressUrl: row.wordpress_url ?? null, wordpressEditUrl: row.wordpress_edit_url ?? null, wordpressStatus: row.wordpress_status ?? null,
    })) });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const input = contentInputSchema.parse(await request.json());
    const db = await getRuntimeDb();
    if (input.action === "save") {
      if (!input.articleId || !input.title || input.content === undefined) return Response.json({ error: "Artigo, título e conteúdo são obrigatórios." }, { status: 400 });
      const content = sanitizeWordPressHtml(input.content);
      validateArticleHtml(content);
      const result = await db.prepare("UPDATE articles SET title = ?, content = ?, status = 'review', updated_at = ? WHERE id = ?").bind(input.title, content, new Date().toISOString(), input.articleId).run();
      if (!result.meta.changes) return Response.json({ error: "Artigo não encontrado." }, { status: 404 });
      return Response.json({ saved: true });
    }

    const config = getAiConfig();
    if (input.action === "brief") {
      const news = await selectedNews(db, input.newsIds);
      if (!news.length) return Response.json({ error: "Selecione ao menos uma notícia coletada para gerar o briefing." }, { status: 400 });
      const coherence = await evaluateCoherence(db, config, news);
      if (!coherence.coherent && !input.allowDisconnected) {
        return Response.json({ error: "As notícias selecionadas tratam de eventos ou temas desconectados. Separe-as em conteúdos distintos.", coherence }, { status: 409 });
      }
      const payload = await generateBriefWithAi(db, config, { news, coherence, requestedIcp: input.icp, objective: input.objective, primaryKeyword: input.primaryKeyword, tone: input.tone });
      const now = new Date().toISOString();
      const result = await db.prepare("INSERT INTO editorial_briefs (title, selected_icp, objective, primary_keyword, payload, news_ids, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?) RETURNING id")
        .bind(payload.suggestedTitle, payload.primaryIcp, input.objective, payload.primaryKeyword, JSON.stringify({ ...payload, coherence }), JSON.stringify(input.newsIds), now, now).run();
      return Response.json({ brief: toClientBrief(Number(result.meta.last_row_id), payload, coherence) }, { status: 201 });
    }

    if (!input.briefId) return Response.json({ error: "Aprove um briefing antes de gerar o artigo." }, { status: 400 });
    const brief = await db.prepare("SELECT * FROM editorial_briefs WHERE id = ?").bind(input.briefId).first<BriefRow>();
    if (!brief) return Response.json({ error: "Briefing não encontrado." }, { status: 404 });
    const newsIds = JSON.parse(brief.news_ids) as number[];
    const news = await selectedNews(db, newsIds);
    if (!news.length) return Response.json({ error: "As fontes do briefing não estão mais disponíveis." }, { status: 409 });
    const payload = briefPayloadSchema.parse(JSON.parse(brief.payload));
    const article = await generateArticleWithAi(db, config, { brief: payload, news, objective: brief.objective, tone: input.tone });
    const slug = `${slugify(article.title)}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const insert = await db.prepare("INSERT INTO articles (brief_id, title, slug, excerpt, content, meta_title, meta_description, primary_keyword, secondary_keywords, category, tags, status, quality_score, factual_confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?) RETURNING id")
      .bind(brief.id, article.title, slug, article.excerpt, article.contentHtml, article.metaTitle, article.metaDescription, brief.primary_keyword, JSON.stringify(article.secondaryKeywords), article.category, JSON.stringify(article.tags), article.qualityScore, article.factualConfidence, now, now).run();
    return Response.json({ article: { id: Number(insert.meta.last_row_id), briefId: brief.id, title: article.title, slug, excerpt: article.excerpt, content: article.contentHtml, primaryKeyword: brief.primary_keyword, status: "draft", qualityScore: article.qualityScore, factualConfidence: article.factualConfidence, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) { return fail(error, error instanceof SyntaxError ? 502 : 400); }
}

async function selectedNews(db: Database, ids: number[]): Promise<EditorialNews[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(`SELECT id, title, source_name, original_url, published_at, excerpt, content_text, region, logistics_impact, topics, icps, primary_icp FROM news_items WHERE status <> 'discarded' AND id IN (${placeholders}) ORDER BY relevance_score DESC`).bind(...ids).all<SelectedNewsRow>();
  return rowsOf(result).map((item) => ({ id: item.id, title: item.title, sourceName: item.source_name, originalUrl: item.original_url, publishedAt: item.published_at, excerpt: item.excerpt, content: item.content_text, region: item.region, logisticsImpact: item.logistics_impact, topics: JSON.parse(item.topics), icps: JSON.parse(item.icps), primaryIcp: item.primary_icp }));
}

function toClientBrief(id: number, payload: ReturnType<typeof briefPayloadSchema.parse>, coherence: unknown) {
  return { id, title: payload.suggestedTitle, summary: payload.mainEvent, importance: payload.sectorImpact, opportunity: payload.editorialAngle, ...payload, coherence };
}

function fail(error: unknown, status = 500) { return Response.json({ error: error instanceof Error ? error.message : "Falha no fluxo editorial." }, { status }); }
