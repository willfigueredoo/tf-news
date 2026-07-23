import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SEO_INTELLIGENCE_MOCK } from "../app/seo-intelligence/mocks.ts";
import { mockSeoIntelligenceService } from "../app/seo-intelligence/services.ts";

test("snapshot mockado responde às três perguntas editoriais sem portais de notícia", async () => {
  const snapshot = await mockSeoIntelligenceService.loadSnapshot();
  assert.equal(snapshot.authority.value, 91);
  assert.deepEqual(snapshot.authority.signals.map((item) => item.label), ["Google Signals", "Gemini AI", "TF News Engine"]);
  assert.ok(snapshot.competitors.length >= 4);
  assert.ok(snapshot.opportunities.length >= 4);
  assert.ok(snapshot.unexploredTopics.includes("Logística Farmacêutica"));
  assert.notEqual(snapshot, SEO_INTELLIGENCE_MOCK);
  assert.equal(snapshot.competitors.some((item) => /Globo Rural|Canal Rural|Reuters|Valor/i.test(item.name)), false);
});

test("módulo mantém tipos, mocks, serviço, hook e componentes separados", async () => {
  const [types, mocks, service, hook, module, overview, competitors, opportunities] = await Promise.all([
    readFile(new URL("../app/seo-intelligence/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/mocks.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/services.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/hooks/use-seo-intelligence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/seo-intelligence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/components/authority-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/components/competitors-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seo-intelligence/components/opportunities-view.tsx", import.meta.url), "utf8"),
  ]);
  for (const name of ["AuthorityScore", "Competitor", "CompetitorArticle", "SeoOpportunity", "AuthorityInsight"]) {
    assert.match(types, new RegExp(`interface ${name}`));
  }
  assert.match(mocks, /SEO_INTELLIGENCE_MOCK/);
  assert.match(service, /SeoIntelligenceService/);
  assert.doesNotMatch(service, /fetch\(|\/api\//);
  assert.match(hook, /useSeoIntelligence/);
  assert.match(module, /Visão Geral/);
  assert.match(module, /Concorrentes/);
  assert.match(module, /Oportunidades/);
  assert.match(overview, /TF Authority Score/);
  assert.match(competitors, /Criar pauta semelhante/);
  assert.match(opportunities, /Potencial SEO/);
});

test("navegação integra Inteligência SEO e mantém ações como demonstração", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Inteligência SEO/);
  assert.match(app, /SeoIntelligence/);
  assert.match(css, /\.seo-authority-card/);
  assert.match(css, /\.seo-competitor-table/);
  assert.match(css, /\.seo-opportunity-grid/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
