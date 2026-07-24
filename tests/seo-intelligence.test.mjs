import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFeed } from "../lib/editorial.ts";
import {
  calculateEngineScore,
  generateOpportunityCandidates,
} from "../lib/seo-engine.ts";
import {
  seoAuthorityAnalysisSchema,
  seoCompetitorAnalysisSchema,
  seoOpportunityRankingSchema,
} from "../lib/seo-schemas.ts";
import {
  assertPublicUrl,
  normalizeDomain,
  normalizeExternalUrl,
  parseSitemap,
  safeExternalFetch,
} from "../lib/seo-security.ts";
import {
  deduplicateArticles,
  normalizeWordPressPost,
} from "../lib/seo-sync.ts";

test("migration SEO é aditiva, cria as tabelas e não cadastra concorrentes fictícios", async () => {
  const migration = await readFile(new URL("../drizzle/0006_tough_vargas.sql", import.meta.url), "utf8");
  for (const table of [
    "seo_sites",
    "seo_site_sources",
    "seo_articles",
    "seo_competitors",
    "seo_competitor_sources",
    "seo_competitor_articles",
    "seo_sync_runs",
    "seo_authority_snapshots",
    "seo_ai_analyses",
    "seo_opportunities",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.match(migration, /ON CONFLICT \("domain"\) DO NOTHING/);
  assert.doesNotMatch(migration, /Braspress|Jadlog|Patrus/i);
});

test("URLs são normalizadas e destinos privados são bloqueados", async () => {
  assert.equal(normalizeDomain("transfast.log.br/blog"), "https://transfast.log.br");
  assert.equal(normalizeExternalUrl("https://EXAMPLE.com/post/?utm_source=x#top"), "https://example.com/post");
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1/admin"), /SSRF/i);
  await assert.rejects(() => assertPublicUrl("file:///etc/passwd"), /Protocolo/i);
});

test("coleta segura valida content type, tamanho e falhas externas", async () => {
  const htmlFetch = async () => new Response("<html><title>OK</title></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const result = await safeExternalFetch("https://example.com/blog", {
    fetchImpl: htmlFetch,
    allowedContentTypes: /html/i,
    maxBytes: 1_000,
  });
  assert.match(result.text, /<title>OK/);

  await assert.rejects(() => safeExternalFetch("https://example.com/data", {
    fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    allowedContentTypes: /xml/i,
  }), /Content-Type não suportado/i);
});

test("parser WordPress normaliza conteúdo e metadados úteis", async () => {
  const article = await normalizeWordPressPost({
    id: 42,
    link: "https://transfast.log.br/blog/logistica-industrial/",
    slug: "logistica-industrial",
    status: "publish",
    date_gmt: "2026-07-20T10:00:00",
    modified_gmt: "2026-07-21T11:00:00",
    title: { rendered: "Logística <em>industrial</em>" },
    excerpt: { rendered: "<p>Resumo verificável.</p>" },
    content: { rendered: "<article><h2>Contexto</h2><p>Conteúdo publicado pela TransFAST.</p></article>" },
    yoast_head_json: {
      canonical: "https://transfast.log.br/blog/logistica-industrial/",
      description: "Descrição SEO do artigo.",
    },
    _embedded: {
      author: [{ name: "TransFAST" }],
      "wp:term": [[{ taxonomy: "category", name: "Logística" }], [{ taxonomy: "post_tag", name: "Indústria" }]],
    },
  });
  assert.equal(article.externalId, "42");
  assert.equal(article.title, "Logística industrial");
  assert.equal(article.author, "TransFAST");
  assert.equal(article.metaDescription, "Descrição SEO do artigo.");
  assert.ok(article.contentHash.length >= 32);
  assert.ok(article.topics.length > 0);
});

test("parsers RSS e sitemap reconhecem itens reais e hierarquia", () => {
  const feed = parseFeed(`<?xml version="1.0"?><rss><channel><title>Blog</title><item><guid>7</guid><title>Frete industrial</title><link>https://example.com/frete</link><description>Resumo</description><pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].title, "Frete industrial");

  const sitemap = parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://example.com/blog/a</loc><lastmod>2026-07-20</lastmod></url></urlset>`);
  assert.deepEqual(sitemap.entries, [{ url: "https://example.com/blog/a", lastModifiedAt: "2026-07-20" }]);
  const index = parseSitemap(`<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>`);
  assert.deepEqual(index.childSitemaps, ["https://example.com/post-sitemap.xml"]);
});

test("deduplicação considera canonical, URL, identificador, hash e título/data", () => {
  const base = {
    externalId: "1",
    title: "Artigo logístico",
    url: "https://example.com/a",
    canonicalUrl: "https://example.com/a",
    publishedAt: "2026-07-20T10:00:00Z",
    contentHash: "hash-a",
  };
  const result = deduplicateArticles([
    base,
    { ...base, externalId: "2", url: "https://example.com/a?utm_source=x" },
    { ...base, externalId: "3", url: "https://example.com/b", canonicalUrl: "https://example.com/b", contentHash: "hash-a" },
    { ...base, externalId: "4", url: "https://example.com/c", canonicalUrl: "https://example.com/c", contentHash: "hash-c", title: "Outro artigo" },
  ]);
  assert.equal(result.length, 2);
});

test("TF News Engine calcula score determinístico e não simula autoridade sem acervo", () => {
  const empty = {
    articleCount: 0,
    articlesLast30Days: 0,
    articlesLast90Days: 0,
    publishingFrequencyPerWeek: 0,
    regularityScore: 0,
    recencyScore: 0,
    updatedArticleRatio: 0,
    analyzableArticleRatio: 0,
    topicDiversity: 0,
    dominantTopic: null,
    dominantTopicShare: 0,
    clusterCount: 0,
    monitoredTopicCoverage: 0,
    competitorGapCount: 0,
    reactionSpeedScore: 0,
  };
  assert.equal(calculateEngineScore(empty), 0);
  const populated = calculateEngineScore({
    ...empty,
    articleCount: 50,
    articlesLast30Days: 8,
    articlesLast90Days: 20,
    publishingFrequencyPerWeek: 1.54,
    regularityScore: 80,
    recencyScore: 92,
    updatedArticleRatio: .3,
    analyzableArticleRatio: .9,
    topicDiversity: 12,
    dominantTopic: "Logística",
    dominantTopicShare: .25,
    clusterCount: 4,
    monitoredTopicCoverage: .6,
    reactionSpeedScore: 70,
  });
  assert.ok(populated > 60 && populated <= 100);
});

test("schemas Zod aceitam análises estruturadas e rejeitam payloads incompletos", () => {
  assert.equal(seoAuthorityAnalysisSchema.safeParse({
    qualitativeScore: 80,
    summary: "A".repeat(100),
    strengths: [{ title: "Consistência", description: "B".repeat(30) }],
    attentionPoints: [{ title: "Cobertura", description: "C".repeat(30) }],
    recommendations: ["D".repeat(20)],
    scoreExplanation: "E".repeat(50),
    confidence: .8,
  }).success, true);
  assert.equal(seoCompetitorAnalysisSchema.safeParse({ summary: "curto" }).success, false);
  assert.equal(seoOpportunityRankingSchema.safeParse({ items: [] }).success, false);
});

test("engine gera oportunidades apenas a partir de sinais fornecidos e evita colisões", async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [], meta: { changes: 0 } }; },
      };
    },
  };
  const now = new Date().toISOString();
  const candidates = await generateOpportunityCandidates(db, 1, {
    siteArticles: [],
    competitorArticles: [],
    news: [
      { id: 9, title: "Novas rotas industriais", excerpt: "Mercado", published_at: now, topics: JSON.stringify(["Transporte rodoviário"]), primary_icp: "Máquinas e Equipamentos Pesados", relevance_score: 90 },
      { id: 10, title: "Custos rodoviários", excerpt: "Mercado", published_at: now, topics: JSON.stringify(["Transporte rodoviário"]), primary_icp: "Máquinas e Equipamentos Pesados", relevance_score: 82 },
      { id: 11, title: "Operação rodoviária", excerpt: "Mercado", published_at: now, topics: JSON.stringify(["Transporte rodoviário"]), primary_icp: "Máquinas e Equipamentos Pesados", relevance_score: 78 },
    ],
    kits: [],
    queue: [],
  });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].newsIds, [9, 10, 11]);
  assert.ok(candidates[0].reasons.some((reason) => /notícia/i.test(reason)));
});

test("frontend usa API real, mantém estados vazios e reutiliza Fila/Biblioteca", async () => {
  const [service, module, overview, competitors, opportunities, route, engine] = await Promise.all([
    readFile(new URL("../app/seo-intelligence/services.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/seo-intelligence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/components/authority-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/components/competitors-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/components/opportunities-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/seo-intelligence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/seo-engine.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /fetch\("\/api\/seo-intelligence"/);
  assert.doesNotMatch(service, /MOCK|mockSeo/i);
  assert.doesNotMatch(module, /Ambiente demonstrativo|Dados simulados/i);
  assert.match(overview, /Google Signals|não conectado/i);
  assert.match(competitors, /Nenhum concorrente cadastrado/);
  assert.match(opportunities, /Ainda não há oportunidades suficientes/);
  assert.match(route, /enqueueEditorialNews/);
  assert.match(route, /generateEditorialKitForNews/);
  assert.match(route, /runStructuredAi|refreshSeoIntelligence/);
  assert.match(engine, /status NOT IN \('discarded', 'archived'\)/);
  assert.doesNotMatch(engine, /discarded = FALSE/);
});
