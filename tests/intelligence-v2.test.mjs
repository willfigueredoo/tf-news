import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { buildEditorialIntelligence, scoreEditorialOpportunity } from "../lib/editorial-intelligence.ts";
import { runStructuredAi } from "../lib/ai.ts";

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

test("migration da Biblioteca é somente aditiva", async () => {
  const migration = await readFile(new URL("../drizzle/0002_overjoyed_gideon.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "editorial_kits"/);
  assert.match(migration, /CREATE INDEX "editorial_kits_news_idx"/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE SET)\b/i);
});

test("endpoint bloqueia geração paga antes de a Biblioteca existir", async () => {
  const route = await readFile(new URL("../app/api/editorial-kits/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("to_regclass('public.editorial_kits')") < route.indexOf("generateEditorialKit(db"));
  assert.match(route, /schema_pending/);
});
