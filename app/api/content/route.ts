import { getRuntimeDb, rowsOf } from "../../../db/runtime";
import { contentInputSchema } from "../../../lib/editorial";

type SelectedNews = { id: number; title: string; source_name: string; original_url: string; published_at: string; excerpt: string; region: string; logistics_impact: string; topics: string; icps: string };
type BriefRow = { id: number; title: string; selected_icp: string; objective: string; primary_keyword: string; payload: string; news_ids: string };

export async function GET() {
  try {
    const db = await getRuntimeDb();
    const result = await db.prepare("SELECT a.*, p.wordpress_post_id, p.wordpress_url, p.wordpress_status FROM articles a LEFT JOIN wordpress_publications p ON p.article_id = a.id ORDER BY a.updated_at DESC LIMIT 100").all<Record<string, unknown>>();
    return Response.json({ articles: rowsOf(result).map((row: Record<string, unknown>) => ({
      id: row.id, briefId: row.brief_id, title: row.title, slug: row.slug, excerpt: row.excerpt, content: row.content,
      metaTitle: row.meta_title, metaDescription: row.meta_description, primaryKeyword: row.primary_keyword,
      status: row.status, qualityScore: row.quality_score, createdAt: row.created_at, updatedAt: row.updated_at,
      wordpressPostId: row.wordpress_post_id ?? null, wordpressUrl: row.wordpress_url ?? null, wordpressStatus: row.wordpress_status ?? null,
    })) });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const input = contentInputSchema.parse(await request.json());
    const db = await getRuntimeDb();
    if (input.action === "save") {
      if (!input.articleId || !input.title || input.content === undefined) return Response.json({ error: "Artigo, título e conteúdo são obrigatórios." }, { status: 400 });
      await db.prepare("UPDATE articles SET title = ?, content = ?, updated_at = ? WHERE id = ?").bind(input.title, input.content, new Date().toISOString(), input.articleId).run();
      return Response.json({ saved: true });
    }
    if (input.action === "brief") {
      const news = await selectedNews(db, input.newsIds);
      if (!news.length) return Response.json({ error: "Selecione ao menos uma notícia coletada para gerar o briefing." }, { status: 400 });
      const primary = news[0];
      const title = `${input.icp === "Todos os ICPs" ? JSON.parse(primary.icps)[0] : input.icp}: impactos e sinais para a cadeia logística`;
      const facts = news.map((item) => ({ fact: item.title, source: item.source_name, url: item.original_url, publishedAt: item.published_at }));
      const topics = [...new Set(news.flatMap((item) => JSON.parse(item.topics) as string[]))].slice(0, 8);
      const regions = [...new Set(news.map((item) => item.region))];
      const payload = {
        summary: `Síntese editorial baseada em ${news.length} notícia(s) confirmada(s), com foco nos efeitos para operação, abastecimento e transporte.`,
        primaryIcp: input.icp === "Todos os ICPs" ? (JSON.parse(primary.icps) as string[])[0] : input.icp,
        secondaryIcps: [...new Set(news.flatMap((item) => JSON.parse(item.icps) as string[]))].slice(1, 4),
        topics, regions, facts,
        importance: "O tema combina atualidade setorial e possíveis efeitos sobre planejamento de demanda, distribuição e nível de serviço.",
        opportunity: "Explicar o acontecimento sem reproduzir as fontes, conectando sinais de mercado a decisões logísticas B2B.",
        logisticsImpact: news.some((item) => item.logistics_impact === "high") ? "Alto" : "Moderado",
        suggestedTitle: title,
        alternativeTitles: [`O que o mercado deve acompanhar em ${topics[0] ?? "logística"}`, `Cadeia de abastecimento: sinais recentes e pontos de atenção`],
        structure: ["O que aconteceu", "Contexto do setor", "Impactos para o mercado", "Efeitos logísticos", "O que acompanhar"],
        warnings: ["Revisar números e datas diretamente nas fontes antes da aprovação", "Não tratar projeções como fatos confirmados"],
      };
      const now = new Date().toISOString();
      const result = await db.prepare("INSERT INTO editorial_briefs (title, selected_icp, objective, primary_keyword, payload, news_ids, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
        .bind(title, input.icp, input.objective, input.primaryKeyword, JSON.stringify(payload), JSON.stringify(input.newsIds), now, now).run();
      return Response.json({ brief: { id: Number(result.meta.last_row_id), title, ...payload } }, { status: 201 });
    }
    if (!input.briefId) return Response.json({ error: "Aprove um briefing antes de gerar o artigo." }, { status: 400 });
    const brief = await db.prepare("SELECT * FROM editorial_briefs WHERE id = ?").bind(input.briefId).first<BriefRow>();
    if (!brief) return Response.json({ error: "Briefing não encontrado." }, { status: 404 });
    const newsIds = JSON.parse(brief.news_ids) as number[];
    const news = await selectedNews(db, newsIds);
    if (!news.length) return Response.json({ error: "As fontes do briefing não estão mais disponíveis." }, { status: 409 });
    const briefPayload = JSON.parse(brief.payload) as { topics: string[]; regions: string[]; logisticsImpact: string; warnings: string[] };
    const title = brief.title;
    const sourceList = news.map((item) => `<li><a href="${escapeHtml(item.original_url)}" rel="nofollow noopener">${escapeHtml(item.source_name)} — ${escapeHtml(item.title)}</a></li>`).join("");
    const content = `<p>Movimentos recentes em ${escapeHtml(brief.selected_icp)} reforçam a necessidade de acompanhar de perto a cadeia de abastecimento. Esta análise reúne sinais publicados por fontes monitoradas e organiza os possíveis reflexos para empresas que dependem de previsibilidade operacional.</p>
<h2>O que aconteceu</h2><p>${escapeHtml(news.map((item) => item.title).join("; "))}. Em conjunto, os acontecimentos ajudam a compor um quadro atual do setor, sem substituir a consulta às publicações originais.</p>
<h2>Por que o tema importa</h2><p>${escapeHtml(brief.objective)}. Para compradores, indústrias e distribuidores, mudanças de oferta, demanda ou infraestrutura podem alterar prazos, necessidade de estoque e planejamento de transporte.</p>
<h2>Possíveis impactos logísticos</h2><p>O briefing classificou o impacto como ${escapeHtml(briefPayload.logisticsImpact.toLowerCase())}. Entre os pontos a observar estão disponibilidade de capacidade, concentração regional de fluxos, janelas de coleta, custos operacionais e comunicação entre embarcadores e transportadores.</p>
<h2>Regiões e segmentos em atenção</h2><p>As fontes citam principalmente ${escapeHtml(briefPayload.regions.join(", "))}. O efeito real varia conforme produto, rota, sazonalidade e estratégia de abastecimento de cada empresa.</p>
<h2>O que as empresas devem acompanhar</h2><ul><li>Atualizações oficiais e dados confirmados pelas fontes.</li><li>Mudanças em prazos, estoques e disponibilidade de insumos.</li><li>Condições de infraestrutura nas rotas mais relevantes.</li><li>Planos de contingência para períodos de maior pressão.</li></ul>
<h2>Conclusão</h2><p>Antecipar impactos exige leitura contínua do mercado e coordenação operacional. A TransFAST acompanha esses sinais para apoiar conversas logísticas mais objetivas, sempre considerando as particularidades de cada operação B2B.</p>
<h2>Fontes consultadas</h2><ul>${sourceList}</ul>`;
    const slugBase = slugify(title);
    const slug = `${slugBase}-${Date.now().toString(36)}`;
    const excerpt = `Análise dos sinais recentes em ${brief.selected_icp} e dos possíveis impactos para abastecimento, distribuição e transporte.`;
    const now = new Date().toISOString();
    const insert = await db.prepare("INSERT INTO articles (brief_id, title, slug, excerpt, content, meta_title, meta_description, primary_keyword, secondary_keywords, category, tags, status, quality_score, factual_confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 82, .82, ?, ?)")
      .bind(brief.id, title, slug, excerpt, content, title.slice(0, 60), excerpt.slice(0, 155), brief.primary_keyword, JSON.stringify(briefPayload.topics.slice(0, 6)), brief.selected_icp, JSON.stringify(briefPayload.topics), now, now).run();
    return Response.json({ article: { id: Number(insert.meta.last_row_id), briefId: brief.id, title, slug, excerpt, content, primaryKeyword: brief.primary_keyword, status: "draft", qualityScore: 82, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) { return fail(error, 400); }
}

async function selectedNews(db: D1Database, ids: number[]) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(`SELECT id, title, source_name, original_url, published_at, excerpt, region, logistics_impact, topics, icps FROM news_items WHERE id IN (${placeholders}) ORDER BY relevance_score DESC`).bind(...ids).all<SelectedNews>();
  return rowsOf(result);
}

function slugify(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char); }
function fail(error: unknown, status = 500) { return Response.json({ error: error instanceof Error ? error.message : "Falha no fluxo editorial." }, { status }); }
