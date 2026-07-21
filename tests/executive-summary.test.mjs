import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  evaluateDominance,
  executiveWindows,
  rankExecutiveNews,
  tieBreakApplied,
} from "../lib/executive-summary.ts";

const reference = new Date("2026-07-21T12:00:00.000Z");

function news(overrides = {}) {
  return {
    id: 1,
    title: "Investimento amplia capacidade logÃ­stica do agronegÃ³cio",
    excerpt: "Empresa anuncia investimento e expansÃ£o de capacidade.",
    content: "O mercado acompanha o investimento em transporte, distribuiÃ§Ã£o e exportaÃ§Ã£o.",
    sourceName: "Reuters",
    originalUrl: "https://example.com/noticia-1",
    publishedAt: "2026-07-21T10:00:00.000Z",
    collectedAt: "2026-07-21T10:05:00.000Z",
    primaryIcp: "AgronegÃ³cio",
    secondaryIcps: ["MÃ¡quinas e Equipamentos Pesados"],
    topics: ["LogÃ­stica", "Investimentos"],
    region: "Brasil",
    logisticsImpact: "high",
    relevanceScore: 91,
    status: "new",
    sourceReliability: 95,
    sourceAuthorityLevel: "high",
    sourcePrimaryOrSecondary: "secondary",
    sourceMinimumConfirmationSources: 1,
    ...overrides,
  };
}

test("janelas executivas usam o mesmo momento de referÃªncia", () => {
  assert.deepEqual(executiveWindows(reference), {
    metrics24h: "2026-07-20T12:00:00.000Z",
    dominance7d: "2026-07-14T12:00:00.000Z",
    trendCurrent7d: "2026-07-14T12:00:00.000Z",
    trendPrevious7d: "2026-07-07T12:00:00.000Z",
    newsCandidates72h: "2026-07-18T12:00:00.000Z",
  });
});

test("dominÃ¢ncia exige amostra mÃ­nima, participaÃ§Ã£o e lideranÃ§a isolada", () => {
  assert.equal(evaluateDominance([{ label: "AÃ§o", count: 2 }], 2), null);
  assert.equal(evaluateDominance([{ label: "AÃ§o", count: 3 }], 40), null);
  assert.equal(evaluateDominance([{ label: "AÃ§o", count: 4 }, { label: "Agro", count: 4 }], 20), null);
  assert.deepEqual(
    evaluateDominance([{ label: "Agro", count: 8 }, { label: "AÃ§o", count: 4 }], 20),
    { label: "Agro", count: 8, share: 40 },
  );
});

test("ranking da NotÃ­cia do Dia Ã© determinÃ­stico e usa desempate estÃ¡vel", () => {
  const input = [news({ id: 7 }), news({ id: 8 })];
  const signals = [{ dimension: "icp", label: "AgronegÃ³cio", currentCount: 8, previousCount: 3 }];
  const first = rankExecutiveNews(input, signals, reference);
  const second = rankExecutiveNews(input, signals, reference);
  assert.deepEqual(first, second);
  assert.equal(first[0].id, 8);
  assert.equal(tieBreakApplied(first), "maior identificador estável");
  assert.equal(Object.keys(first[0].ranking.components).length, 7);
  assert.ok(first[0].finalScore >= 0 && first[0].finalScore <= 100);
});

test("endpoint executivo agrega no PostgreSQL, aplica ICP e nÃ£o permite cache", async () => {
  const route = await readFile(new URL("../app/api/executive-summary/route.ts", import.meta.url), "utf8");
  assert.match(route, /COUNT\(\*\) FILTER/);
  assert.match(route, /GROUP BY/);
  assert.match(route, /jsonb_build_array\(\?::text\)/);
  assert.match(route, /Cache-Control.*private, no-store/);
  assert.match(route, /universeConsidered/);
  assert.match(route, /tieBreakApplied/);
  assert.match(route, /topFive: ranked\.slice\(0, 5\)\.map/);
  assert.match(route, /readingTimeMinutes/);
  assert.doesNotMatch(route, /SELECT n\.\* FROM news_items/);
});

test("Painel nÃ£o depende de focusNewsId nem oferece geraÃ§Ã£o", async () => {
  const app = await readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../app/executive-dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /focusNewsId/);
  assert.doesNotMatch(dashboard, /focusNewsId|generateKit|Gerar Kit|Gerar ConteÃºdo|POST.*editorial-kits/s);
  assert.match(dashboard, /api\/executive-summary\?icp=/);
  assert.doesNotMatch(dashboard, /sem interfer/i);
  assert.ok(dashboard.indexOf('className="card day-story"') < dashboard.indexOf('className="executive-strip"'));
  assert.match(dashboard, /Último Kit gerado no sistema/);
});

test("migration da Fase 1 Ã© somente aditiva e nÃ£o cria a Fila Editorial", async () => {
  const migration = await readFile(new URL("../drizzle/0004_massive_mattie_franklin.sql", import.meta.url), "utf8");
  const statements = migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
  assert.ok(statements.length >= 6);
  for (const statement of statements) assert.match(statement, /^CREATE INDEX /i);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|CREATE TABLE)\b/i);
  assert.doesNotMatch(migration, /editorial_queue|fila_editorial/i);
});
