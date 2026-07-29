import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateStrategicScore,
  groupEvergreenSignals,
  priorityFromScore,
  semanticSimilarity,
} from "../lib/content-opportunities.ts";
import { evergreenOpportunityBatchSchema } from "../lib/content-opportunity-schemas.ts";

const news = (id, title, topics, relevance = 82) => ({
  type: "news",
  id,
  title,
  excerpt: "Conteúdo rastreável sobre operação, transporte e planejamento logístico.",
  content: "Informações persistidas da fonte monitorada.",
  publishedAt: "2026-07-28T10:00:00.000Z",
  topics,
  icps: ["Agronegócio"],
  relevance,
  publisher: "Fonte real",
});

test("migration da Central de Conteúdos é estritamente aditiva", async () => {
  const migration = await readFile(new URL("../drizzle/0008_normal_mysterio.sql", import.meta.url), "utf8");
  for (const table of [
    "content_opportunities",
    "content_opportunity_sources",
    "content_opportunity_jobs",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /content_opportunity_jobs_active_unique/);
  assert.match(migration, /FOREIGN KEY \("generated_kit_id"\).*"editorial_kits"/s);
  assert.match(migration, /FOREIGN KEY \("news_item_id"\).*"news_items"/s);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i);
});

test("notícias semanticamente relacionadas formam uma única oportunidade evergreen", () => {
  const candidates = groupEvergreenSignals([
    news(1, "Alta do diesel pressiona os custos logísticos", ["custos logísticos"], 91),
    news(2, "Transportadoras buscam reduzir despesas operacionais", ["gestão de custos"], 84),
    news(3, "Tecnologia reduz consumo de combustível", ["tecnologia logística"], 78),
  ]);
  const costs = candidates.find((candidate) => candidate.normalizedTopic === "custos-logisticos");
  assert.ok(costs);
  assert.equal(costs.signals.length, 2);
  assert.ok(costs.factors.strategicScore >= 50);
  assert.equal(new Set(candidates.map((candidate) => candidate.normalizedTopic)).size, candidates.length);
});

test("score não atribui nota fictícia ao Google Signals e respeita as faixas", () => {
  const score = calculateStrategicScore({
    signalCount: 7,
    competitorCount: 2,
    averageRelevance: 88,
    hasIcp: true,
    siteMatchCount: 0,
    evergreenStrength: 94,
  });
  assert.equal(score.googleSignalsScore, null);
  assert.ok(score.strategicScore >= 85);
  assert.equal(priorityFromScore(score.strategicScore), "high");
  assert.equal(priorityFromScore(74), "good");
  assert.equal(priorityFromScore(58), "secondary");
});

test("conteúdo semelhante da TransFAST reduz a lacuna e evita canibalização silenciosa", () => {
  const withoutExisting = groupEvergreenSignals([
    news(1, "Como reduzir custos logísticos no transporte", ["custos logísticos"], 90),
    news(2, "Frete exige controle de custos operacionais", ["custos logísticos"], 86),
  ]);
  const withExisting = groupEvergreenSignals([
    news(1, "Como reduzir custos logísticos no transporte", ["custos logísticos"], 90),
    news(2, "Frete exige controle de custos operacionais", ["custos logísticos"], 86),
  ], [{
    id: 9,
    title: "Como reduzir custos logísticos sem perder eficiência",
    url: "https://transfast.log.br/reduzir-custos-logisticos",
    topics: '["custos logísticos"]',
  }]);
  assert.equal(withoutExisting[0].factors.contentGapScore, 96);
  assert.ok(withExisting[0].factors.contentGapScore < withoutExisting[0].factors.contentGapScore);
  assert.ok(semanticSimilarity(withExisting[0].suggestedTitle, "Como reduzir custos logísticos sem perder eficiência") > .35);
});

test("schema estruturado rejeita análise incompleta do Gemini", () => {
  const valid = {
    items: [{
      candidateKey: "custos-logisticos",
      evergreenPotential: true,
      suggestedTitle: "Como reduzir custos logísticos sem comprometer o serviço",
      topic: "Custos logísticos",
      category: "Gestão Logística",
      relatedIcps: ["Agronegócio"],
      rationale: "Tema recorrente, útil ao planejamento e aderente às operações B2B da TransFAST.",
      transfastRelevance: "A pauta se conecta à eficiência, ao transporte e ao nível de serviço.",
      recurrence: "O assunto apareceu em múltiplas fontes monitoradas.",
      longevity: "A dúvida permanece relevante independentemente do evento atual.",
      primaryKeyword: "reduzir custos logísticos",
      searchIntent: "Informacional, com apoio à decisão de gestores logísticos.",
      strategicScore: 91,
      priority: "high",
      cannibalization: "none",
      recommendation: "create",
    }],
  };
  assert.equal(evergreenOpportunityBatchSchema.safeParse(valid).success, true);
  assert.equal(evergreenOpportunityBatchSchema.safeParse({ items: [{ candidateKey: "x" }] }).success, false);
});

test("job incremental persiste cursor, lease, lock e retomada em lotes pequenos", async () => {
  const jobs = await readFile(new URL("../lib/content-opportunity-jobs.ts", import.meta.url), "utf8");
  assert.match(jobs, /BATCH_SIZE = 3/);
  assert.match(jobs, /FOR UPDATE SKIP LOCKED/);
  assert.match(jobs, /lease_expires_at/);
  assert.match(jobs, /candidate_snapshot/);
  assert.match(jobs, /nextCursor/);
  assert.match(jobs, /status = 'processing'/);
  assert.match(jobs, /status = 'completed'/);
});

test("geração reutiliza o Kit atual, é atômica e bloqueia duplicidade", async () => {
  const [workflow, kit, route] = await Promise.all([
    readFile(new URL("../lib/content-opportunity-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/editorial-kit.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/content-opportunities/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /createEditorialKit/);
  assert.match(workflow, /generated_kit_id/);
  assert.match(workflow, /status = 'generating'/);
  assert.match(kit, /Conteúdo Evergreen/);
  assert.match(kit, /updated_opportunity AS/);
  assert.match(kit, /status = 'in_production'/);
  assert.match(route, /status: 409/);
  assert.doesNotMatch(workflow, /new GoogleGenerativeAI|GoogleGenAI/);
});

test("interface usa dados reais, três estados e navegação para a Biblioteca", async () => {
  const [component, app, library] = await Promise.all([
    readFile(new URL("../app/content-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editorial-intelligence.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /fetch\("\/api\/content-opportunities"/);
  assert.match(component, /Oportunidades/);
  assert.match(component, /Em produção/);
  assert.match(component, /Publicados/);
  assert.match(component, /Gerar Kit Evergreen/);
  assert.match(component, /Nenhuma nova oportunidade encontrada/);
  assert.doesNotMatch(component, /\bmock\b|dados fictícios/i);
  assert.match(app, /Central de Conteúdos/);
  assert.match(library, /Conteúdo Evergreen/);
});
