import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { buildEditorialIntelligence, scoreEditorialOpportunity } from "../lib/editorial-intelligence.ts";
import { runStructuredAi } from "../lib/ai.ts";
import { createEditorialKit, EDITORIAL_KIT_MAX_OUTPUT_TOKENS, EDITORIAL_KIT_TIMEOUT_MS, normalizeEditorialKitPayload } from "../lib/editorial-kit.ts";
import { editorialKitPayloadSchema } from "../lib/operational-schemas.ts";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const NEWS = {
  id: 1,
  title: "Nova fábrica amplia capacidade e demanda logística no agronegócio",
  excerpt: "Investimento afeta fornecedores, armazenagem e transporte no Centro-Oeste.",
  content: "A expansão da produção deve aumentar a capacidade e a demanda regional.",
  sourceName: "Fonte Setorial",
  originalUrl: "https://example.com/fabrica",
  publishedAt: "2026-07-15T09:00:00.000Z",
  collectedAt: "2026-07-15T09:10:00.000Z",
  primaryIcp: "Agronegócio",
  secondaryIcps: ["Máquinas e Equipamentos Pesados"],
  topics: ["investimento", "produção", "logística"],
  region: "Centro-Oeste",
  logisticsImpact: "high",
  relevanceScore: 88,
  status: "new",
  sourceReliability: 92,
};

test("prioriza uma oportunidade editorial real e explica o score", () => {
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  assert.ok(decision.editorialScore >= 80);
  assert.equal(decision.classification, "very_relevant");
  assert.equal(decision.produceContent, true);
  assert.match(decision.decisionReason, /Agronegócio/);
  assert.equal(Object.keys(decision.scoreBreakdown).length, 8);
});

test("forma notícia do dia, Top 5, radar e insights sem IA automática", () => {
  const result = buildEditorialIntelligence([NEWS, { ...NEWS, id: 2, title: "Nota secundária", relevanceScore: 35, logisticsImpact: "low", originalUrl: "https://example.com/nota", publishedAt: "2026-07-01T09:00:00.000Z" }], NOW);
  assert.equal(result.newsOfTheDay?.id, 1);
  assert.equal(result.topFive.length, 2);
  assert.equal(result.summary.analyzed, 2);
  assert.ok(result.radar.length >= 1);
  assert.ok(result.insights.length >= 1);
});

test("adapta saída estruturada ao Gemini sem expor a chave no corpo ou URL", async () => {
  const queries = [];
  const db = {
    prepare(query) {
      queries.push(query);
      return {
        bind() { return this; },
        async first() { return { requests: 0, cost: 0 }; },
        async run() { return { results: [], meta: { changes: 1 } }; },
      };
    },
  };
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ responseId: "gemini-request", candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "decisão editorial" }) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await runStructuredAi({
    db,
    config: { provider: "gemini", apiKey: "secret-test-key", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", timeoutMs: 1000, maxRetries: 0, dailyCostLimitUsd: 5, dailyRequestLimit: 10, inputCostPerMillion: 0, outputCostPerMillion: 0 },
    operation: "editorial-kit",
    schemaName: "test_schema",
    schema: z.object({ answer: z.string() }),
    system: "Sistema",
    user: "Usuário",
    fetchImpl,
  });
  assert.equal(result.data.answer, "decisão editorial");
  assert.match(captured.url, /gemini-2\.5-flash:generateContent$/);
  assert.doesNotMatch(captured.url, /secret-test-key/);
  assert.equal(captured.init.headers["x-goog-api-key"], "secret-test-key");
  assert.doesNotMatch(String(captured.init.body), /secret-test-key/);
  assert.ok(queries.some((query) => query.includes("ai_usage_logs")));
});

test("valida o Kit V1 somente com Blog SEO, WhatsApp e metadados", () => {
  const payload = editorialKitPayloadSchema.parse({
    metadata: { version: "v1", generatedAt: NOW.toISOString(), newsId: 1, sourceTitle: NEWS.title, sourceName: NEWS.sourceName, sourceUrl: NEWS.originalUrl, primaryIcp: NEWS.primaryIcp, editorialScore: 88 },
    blog: {
      title: NEWS.title,
      seoTitle: "Expansão no agro amplia a demanda logística",
      slug: "expansao-agro-demanda-logistica",
      metaDescription: "Nova capacidade produtiva no agronegócio amplia desafios de armazenagem, transporte e planejamento logístico no Centro-Oeste brasileiro.",
      primaryKeyword: "logística no agronegócio",
      secondaryKeywords: ["transporte de cargas", "armazenagem"],
      excerpt: "O novo investimento produtivo altera a demanda regional por armazenagem, transporte e fornecedores especializados em operações do agronegócio.",
      html: `<p>${"Contexto jornalístico e análise logística. ".repeat(90)}</p>`,
      category: "Agronegócio",
      tags: ["agronegócio", "logística"],
      cta: "Converse com a TransFAST para avaliar os impactos logísticos na sua operação.",
      sources: [{ name: NEWS.sourceName, url: NEWS.originalUrl }],
    },
    whatsapp: { content: "A expansão anunciada para o agronegócio no Centro-Oeste deve elevar a movimentação de insumos e produtos na região. Para as empresas do segmento, o principal ponto de atenção é o planejamento de armazenagem, capacidade de transporte e previsibilidade dos fluxos, especialmente nos períodos de maior demanda. A mudança pode pressionar prazos e exigir rotas mais bem coordenadas entre fornecedores, fábricas e clientes. A TransFAST acompanha esses movimentos para apoiar operações que precisam ganhar segurança e eficiência logística. Se esse cenário impacta sua empresa, podemos conversar sobre alternativas para preparar a operação." },
    linkedin: { content: "campo legado que deve ser descartado" },
  });
  assert.deepEqual(Object.keys(payload).sort(), ["blog", "metadata", "whatsapp"]);
  assert.equal(payload.whatsapp.content.length >= 500, true);
  assert.equal(EDITORIAL_KIT_MAX_OUTPUT_TOKENS, 3_600);
  assert.equal(EDITORIAL_KIT_TIMEOUT_MS, 42_000);
});

test("cancela a chamada com AbortController no timeout interno e registra a falha", async () => {
  let aborted = false;
  const queries = [];
  const db = fakeAiDb(queries);
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      aborted = init.signal.aborted;
      reject(new Error("aborted"));
    }, { once: true });
  });
  await assert.rejects(runStructuredAi({
    db,
    config: aiConfig({ timeoutMs: 20 }),
    operation: "editorial-kit",
    schemaName: "timeout_schema",
    schema: z.object({ answer: z.string() }),
    system: "Sistema",
    user: "Usuário",
    fetchImpl,
  }), /Timeout interno da IA após 20 ms/);
  assert.equal(aborted, true);
  assert.ok(queries.some((query) => query.includes("ai_usage_logs")));
});

test("não persiste Kit parcial quando a geração falha", async () => {
  const queries = [];
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  await assert.rejects(createEditorialKit(db, aiConfig(), decision, {
    now: NOW,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "falha controlada" } }), { status: 503, headers: { "Content-Type": "application/json" } }),
  }), /falha controlada/);
  assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
});

test("normaliza kits antigos para leitura sem alterar os dados persistidos", () => {
  const legacy = {
    strategicIntelligence: { eventSummary: "Resumo preservado do kit anterior." },
    blogSeo: { seoTitle: "Título SEO legado", metaDescription: "Descrição legada", slug: "titulo-legado", cta: "CTA legado", category: "Logística", tags: ["logística", "mercado"], html: "<p>Conteúdo legado</p>" },
    whatsapp: { title: "WhatsApp", content: "Mensagem comercial legada" },
    linkedin: { title: "LinkedIn", content: "Conteúdo legado" },
    newsletter: { title: "Newsletter", content: "Conteúdo legado" },
    reels: { hook: "Gancho legado", scenes: ["Cena 1", "Cena 2", "Cena 3"], caption: "Legenda" },
    imagePrompt: "Prompt legado que permanece intacto no banco",
    sources: [{ name: NEWS.sourceName, url: NEWS.originalUrl }],
  };
  const normalized = normalizeEditorialKitPayload(legacy, { newsId: 1, title: "Kit legado", primaryIcp: NEWS.primaryIcp, editorialScore: 88, createdAt: NOW.toISOString() });
  assert.equal(normalized.blog.seoTitle, "Título SEO legado");
  assert.equal(normalized.whatsapp.content, "Mensagem comercial legada");
  assert.equal("linkedin" in normalized, false);
  assert.equal(legacy.linkedin.content, "Conteúdo legado");
});

test("migration da Biblioteca é somente aditiva", async () => {
  const migration = await readFile(new URL("../drizzle/0002_overjoyed_gideon.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "editorial_kits"/);
  assert.match(migration, /CREATE INDEX "editorial_kits_news_idx"/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE SET)\b/i);
});

test("endpoint bloqueia geração paga antes de a Biblioteca existir", async () => {
  const route = await readFile(new URL("../app/api/editorial-kits/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("to_regclass('public.editorial_kits')") < route.indexOf("createEditorialKit(db"));
  assert.match(route, /schema_pending/);
});

function aiConfig(overrides = {}) {
  return { provider: "gemini", apiKey: "test-key", model: "gemini-test", baseUrl: "https://example.test/v1beta", timeoutMs: 1_000, maxRetries: 0, dailyCostLimitUsd: 5, dailyRequestLimit: 10, inputCostPerMillion: 0, outputCostPerMillion: 0, ...overrides };
}

function fakeAiDb(queries) {
  return {
    prepare(query) {
      queries.push(query);
      return {
        bind() { return this; },
        async first() { return { requests: 0, cost: 0 }; },
        async run() { return { results: [], meta: { changes: 1 } }; },
      };
    },
  };
}
