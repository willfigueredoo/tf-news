import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { buildEditorialIntelligence, scoreEditorialOpportunity } from "../lib/editorial-intelligence.ts";
import { runStructuredAi } from "../lib/ai.ts";
import { createEditorialKit, EDITORIAL_KIT_MAX_OUTPUT_TOKENS, EDITORIAL_KIT_TIMEOUT_MS, normalizeEditorialKitPayload, normalizeGeneratedEditorialKitPayload } from "../lib/editorial-kit.ts";
import { editorialKitPayloadSchema, editorialKitUpdateSchema } from "../lib/operational-schemas.ts";

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
  const phases = [];
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ responseId: "gemini-request", candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "decisão editorial" }) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await runStructuredAi({
    db,
    config: { provider: "gemini", apiKey: "secret-test-key", model: "gemini-3.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", timeoutMs: 1000, maxRetries: 0, dailyCostLimitUsd: 5, dailyRequestLimit: 10, inputCostPerMillion: 0, outputCostPerMillion: 0 },
    operation: "editorial-kit",
    schemaName: "test_schema",
    schema: z.object({ answer: z.string() }),
    system: "Sistema",
    user: "Usuário",
    fetchImpl,
    phaseLogger: (entry) => phases.push(entry),
  });
  assert.equal(result.data.answer, "decisão editorial");
  assert.match(captured.url, /gemini-3\.5-flash:generateContent$/);
  assert.doesNotMatch(captured.url, /secret-test-key/);
  assert.equal(captured.init.headers["x-goog-api-key"], "secret-test-key");
  assert.doesNotMatch(String(captured.init.body), /secret-test-key/);
  const requestBody = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(requestBody).sort(), ["contents", "generationConfig", "systemInstruction"]);
  assert.equal(requestBody.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(requestBody.generationConfig.candidateCount, 1);
  assert.equal("tools" in requestBody, false);
  assert.equal("toolConfig" in requestBody, false);
  assert.deepEqual(phases.map((entry) => entry.phase), ["request_start", "provider_response", "zod_validation_start", "zod_validation_end"]);
  assert.ok(queries.some((query) => query.includes("ai_usage_logs")));
});

test("valida o Kit minimalista somente com Blog SEO e WhatsApp", () => {
  const payload = editorialKitPayloadSchema.parse({ ...minimalPayload(), metadata: { legacy: true }, linkedin: { content: "campo descartado" } });
  assert.deepEqual(Object.keys(payload).sort(), ["blog", "whatsapp"]);
  assert.deepEqual(Object.keys(payload.whatsapp), ["text"]);
  assert.equal(payload.whatsapp.text.length >= 400, true);
  assert.equal(payload.whatsapp.text.length <= 700, true);
  assert.equal(EDITORIAL_KIT_MAX_OUTPUT_TOKENS, 1_800);
  assert.equal(EDITORIAL_KIT_TIMEOUT_MS, 54_000);
});

test("aceita revisão completa do Kit existente sem alterar o schema do banco", () => {
  const update = editorialKitUpdateSchema.parse({ id: 7, action: "save", payload: minimalPayload() });
  assert.equal(update.action, "save");
  assert.equal(update.id, 7);
  assert.equal(update.payload.blog.seoTitle, minimalPayload().blog.seoTitle);
  assert.throws(() => editorialKitUpdateSchema.parse({ id: 7, action: "save", payload: { blog: minimalPayload().blog } }));
});

test("orienta a experiência editorial para Blog de 450–550 palavras e WhatsApp natural", async () => {
  const implementation = await readFile(new URL("../lib/editorial-kit.ts", import.meta.url), "utf8");
  assert.match(implementation, /entre 450 e 550 palavras/);
  assert.match(implementation, /resumo executivo, introdução, contexto, o que aconteceu, impacto para o mercado, impacto logístico, oportunidades, conclusão, CTA discreto e fontes/);
  assert.match(implementation, /450 a 650 caracteres/);
  assert.match(implementation, /sem tom promocional excessivo/);
  assert.match(implementation, /EDITORIAL_KIT_TIMEOUT_MS = 54_000/);
  assert.match(implementation, /retryPolicy: "high-demand"/);
});

test("normaliza comprimentos, slug e arrays sem cortar palavras", () => {
  const raw = minimalPayload();
  raw.blog.seoTitle = "Mercado de etanol amplia oportunidades logísticas para empresas brasileiras em 2026!!!";
  raw.blog.metaDescription = `${raw.blog.metaDescription} ${"Planejamento logístico preserva eficiência operacional e competitividade. ".repeat(4)}`;
  raw.blog.slug = "  Mercado de Etanol / Expansão & Logística --- " + "planejamento-".repeat(20);
  raw.blog.excerpt = `${raw.blog.excerpt} ${"Empresas devem acompanhar capacidade, prazos e custos logísticos. ".repeat(12)}`;
  raw.blog.tags = [" Etanol ", "etanol", "", "Logística", "logística", "Mercado", "Energia", "Brasil", "Transporte", "Planejamento", "Infraestrutura"];
  raw.blog.secondaryKeywords = [" Transporte ", "transporte", "", "Armazenagem", "Custos", "Eficiência", "Rotas", "Mercado", "Oferta", "Demanda"];
  raw.whatsapp.text = `${raw.whatsapp.text} ${"As empresas precisam revisar rotas e capacidade antes do aumento de demanda. ".repeat(8)}`;

  const normalized = normalizeGeneratedEditorialKitPayload(raw);
  assert.ok(normalized.blog.seoTitle.length <= 70);
  assert.doesNotMatch(normalized.blog.seoTitle, /[,;:!?./–—-]$/u);
  assert.ok(raw.blog.seoTitle.split(/\s+/).some((word) => word.replace(/[!]+$/u, "") === normalized.blog.seoTitle.split(" ").at(-1)));
  assert.ok(normalized.blog.metaDescription.length <= 170);
  assert.ok(normalized.blog.excerpt.length <= 500);
  assert.match(normalized.blog.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(normalized.blog.slug.length <= 140);
  assert.doesNotMatch(normalized.blog.slug, /-$/);
  assert.deepEqual(normalized.blog.tags.slice(0, 3), ["Etanol", "Logística", "Mercado"]);
  assert.equal(new Set(normalized.blog.tags.map((tag) => tag.toLocaleLowerCase("pt-BR"))).size, normalized.blog.tags.length);
  assert.ok(normalized.blog.tags.length <= 8);
  assert.ok(normalized.blog.secondaryKeywords.length <= 8);
  assert.ok(normalized.whatsapp.text.length <= 700);
  assert.match(normalized.whatsapp.text, /[.!?]$/u);
  assert.doesNotThrow(() => editorialKitPayloadSchema.parse(normalized));
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
    phaseLogger: () => {},
  }), /Timeout interno da IA após \d+ ms/);
  assert.equal(aborted, true);
  assert.ok(queries.some((query) => query.includes("ai_usage_logs")));
});

test("não persiste Kit parcial quando a geração falha", async () => {
  const queries = [];
  let requests = 0;
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  await assert.rejects(createEditorialKit(db, aiConfig(), decision, {
    now: NOW,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: "falha controlada" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    },
    phaseLogger: () => {},
    delayImpl: async () => assert.fail("não deve aguardar ou repetir erro sem alta demanda"),
  }), /falha controlada/);
  assert.equal(requests, 1);
  assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
});

test("aguarda 5s e 10s em alta demanda, conclui na terceira tentativa e só então persiste", async () => {
  const queries = [];
  const phases = [];
  const delays = [];
  let requests = 0;
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  const kit = await createEditorialKit(db, aiConfig({ model: "gemini-3.5-flash" }), decision, {
    now: NOW,
    phaseLogger: (entry) => phases.push(entry),
    delayImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      requests += 1;
      if (requests < 3) return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503, headers: { "Content-Type": "application/json" } });
      const overlong = minimalPayload();
      overlong.blog.seoTitle = "Mercado de etanol amplia oportunidades logísticas para empresas brasileiras em 2026";
      overlong.blog.tags = ["Etanol", "etanol", "", "Logística"];
      overlong.whatsapp.text = `${overlong.whatsapp.text} ${"A operação deve antecipar capacidade e rotas. ".repeat(8)}`;
      return new Response(JSON.stringify({ responseId: "minimal-kit", candidates: [{ content: { parts: [{ text: JSON.stringify(overlong) }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 900 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(kit.id, 123);
  assert.ok(kit.payload.blog.seoTitle.length <= 70);
  assert.ok(kit.payload.whatsapp.text.length <= 700);
  assert.deepEqual(kit.payload.blog.tags, ["Etanol", "Logística"]);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
  assert.deepEqual(phases.map((entry) => entry.phase), ["request_start", "provider_response", "retry_wait", "request_start", "provider_response", "retry_wait", "request_start", "provider_response", "zod_validation_start", "zod_validation_end", "normalization_start", "normalization_end", "zod_final_validation_start", "zod_final_validation_end", "persistence_start", "persistence_end"]);
  assert.ok(queries.some((query) => query.includes("INSERT INTO editorial_kits")));
});

test("encerra após a terceira resposta de alta demanda sem persistência parcial", async () => {
  const queries = [];
  const delays = [];
  let requests = 0;
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  await assert.rejects(createEditorialKit(db, aiConfig({ model: "gemini-3.5-flash" }), decision, {
    now: NOW,
    phaseLogger: () => {},
    delayImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 429, headers: { "Content-Type": "application/json" } });
    },
  }), /high demand/);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
  assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
});

test("rejeita estrutura ausente ou HTML inválido sem persistência parcial", async () => {
  for (const invalidPayload of [
    { blog: minimalPayload().blog },
    { ...minimalPayload(), blog: { ...minimalPayload().blog, html: `<script>alert("inválido")</script>${"texto ".repeat(400)}` } },
  ]) {
    const queries = [];
    const db = fakeAiDb(queries);
    const decision = scoreEditorialOpportunity(NEWS, NOW);
    await assert.rejects(createEditorialKit(db, aiConfig({ model: "gemini-3.1-flash-lite" }), decision, {
      now: NOW,
      phaseLogger: () => {},
      fetchImpl: async () => new Response(JSON.stringify({ responseId: "invalid-kit", candidates: [{ content: { parts: [{ text: JSON.stringify(invalidPayload) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    }));
    assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
  }
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
  assert.equal(normalized.whatsapp.text, "Mensagem comercial legada");
  assert.equal("linkedin" in normalized, false);
  assert.equal(legacy.linkedin.content, "Conteúdo legado");
});

test("mantém compatibilidade de leitura com o payload Blog + WhatsApp anterior", () => {
  const previous = {
    metadata: { version: "v1" },
    blog: { ...minimalPayload().blog, cta: "CTA da versão anterior" },
    whatsapp: { content: minimalPayload().whatsapp.text },
  };
  const normalized = normalizeEditorialKitPayload(previous, { newsId: 1, title: "Kit anterior", primaryIcp: NEWS.primaryIcp, editorialScore: 88, createdAt: NOW.toISOString() });
  assert.equal(normalized.whatsapp.text, previous.whatsapp.content);
  assert.equal("cta" in normalized.blog, false);
  assert.equal(previous.blog.cta, "CTA da versão anterior");
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
  assert.match(route, /input\.action === "save"/);
  assert.match(route, /UPDATE editorial_kits SET title = \?, payload = \?, updated_at = \? WHERE id = \?/);
  assert.match(route, /validation_failed/);
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
        async run() { return { results: [], meta: { changes: 1, ...(query.includes("INSERT INTO editorial_kits") ? { last_row_id: 123 } : {}) } }; },
      };
    },
  };
}

function minimalPayload() {
  return {
    blog: {
      title: NEWS.title,
      seoTitle: "Expansão no agro amplia a demanda logística",
      slug: "expansao-agro-demanda-logistica",
      metaDescription: "Nova capacidade produtiva no agronegócio amplia desafios de armazenagem, transporte e planejamento logístico no Centro-Oeste brasileiro.",
      primaryKeyword: "logística no agronegócio",
      secondaryKeywords: ["transporte de cargas", "armazenagem"],
      excerpt: "O novo investimento produtivo altera a demanda regional por armazenagem, transporte e fornecedores especializados em operações do agronegócio.",
      html: `<h2>Contexto e impacto para o setor</h2><p>${"Contexto jornalístico e análise logística para empresas do setor. ".repeat(55)}</p>`,
      category: "Agronegócio",
      tags: ["agronegócio", "logística"],
      sources: [{ name: NEWS.sourceName, url: NEWS.originalUrl }],
    },
    whatsapp: { text: "A expansão anunciada para o agronegócio no Centro-Oeste deve elevar a movimentação de insumos e produtos na região. Para as empresas do segmento, o ponto de atenção é o planejamento de armazenagem, capacidade de transporte e previsibilidade dos fluxos nos períodos de maior demanda. A mudança pode pressionar prazos e exigir rotas mais coordenadas entre fornecedores, fábricas e clientes. A TransFAST acompanha esses movimentos para apoiar operações que buscam segurança e eficiência logística. Se esse cenário impacta sua empresa, podemos conversar sobre alternativas para preparar a operação." },
  };
}
