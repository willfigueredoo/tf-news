import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PRIORITY_EDITORIAL_SOURCES } from "../lib/priority-editorial-sources.ts";
import {
  calculateSourceAuthorityScore,
  isRecentFeedItem,
  mergeSeedManagedFields,
  sourceEditorialDisposition,
} from "../lib/source-governance.ts";

test("mantém whitelist prioritária com 35 chaves estáveis e sem fontes fictícias ativas", () => {
  assert.equal(PRIORITY_EDITORIAL_SOURCES.length, 35);
  const keys = PRIORITY_EDITORIAL_SOURCES.map((source) => source.sourceKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(PRIORITY_EDITORIAL_SOURCES.some((source) => source.relatedIcps.includes("Todos os ICPs")), false);
  assert.equal(PRIORITY_EDITORIAL_SOURCES.every((source) => !("activeForCollection" in source)), true);
  assert.equal(PRIORITY_EDITORIAL_SOURCES.every((source) => !("feedUrl" in source)), true);
});

test("trata fontes sem RSS confirmado como referência e candidatos como dados não operacionais", () => {
  const withoutCandidate = PRIORITY_EDITORIAL_SOURCES.filter((source) => source.feedCandidates.length === 0);
  const withValidatedCandidate = PRIORITY_EDITORIAL_SOURCES.filter((source) => source.feedCandidates.length > 0);
  assert.ok(withoutCandidate.length > 0);
  assert.ok(withoutCandidate.every((source) => source.preferredMonitoringMode === "reference"));
  assert.deepEqual(withValidatedCandidate.map((source) => source.sourceKey), [
    "mdic",
    "agencia-noticias-ibge",
    "receita-federal",
    "cemaden",
  ]);
});

test("calcula autoridade com base por tipo e penalidades cumulativas", () => {
  assert.equal(calculateSourceAuthorityScore({ sourceType: "official" }), 90);
  assert.equal(calculateSourceAuthorityScore({ sourceType: "regulator" }), 85);
  assert.equal(calculateSourceAuthorityScore({ sourceType: "association" }), 62);
  assert.equal(calculateSourceAuthorityScore({ sourceType: "press", authorityProfile: "news_agency" }), 70);
  assert.equal(calculateSourceAuthorityScore({ sourceType: "press", authorityProfile: "economic_outlet" }), 68);
  assert.equal(calculateSourceAuthorityScore({
    sourceType: "press",
    publicationAgeDays: 45,
    hasReferenceDate: false,
    hasAuthor: false,
    opinion: true,
    republishedReleaseWithoutOrigin: true,
    contradictsOfficialSource: true,
  }), 0);
  assert.equal(sourceEditorialDisposition(70), "eligible");
  assert.equal(sourceEditorialDisposition(50), "cross_check");
  assert.equal(sourceEditorialDisposition(30), "human_review");
  assert.equal(sourceEditorialDisposition(29), "not_recommended");
});

test("exige publicação recente antes de considerar um feed operacional", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  assert.equal(isRecentFeedItem("2026-07-15T12:00:00.000Z", now), true);
  assert.equal(isRecentFeedItem("2025-01-01T12:00:00.000Z", now), false);
  assert.equal(isRecentFeedItem("data-inválida", now), false);
});

test("upsert conceitual preserva URL, status, notas e histórico configurados manualmente", () => {
  const seed = PRIORITY_EDITORIAL_SOURCES[0];
  const current = {
    sourceKey: seed.sourceKey,
    name: "Nome antigo",
    feedUrl: "https://correcao-manual.example/feed.xml",
    baseUrl: "https://correcao-manual.example",
    status: "paused",
    editorialNotes: "Nota editorial do usuário",
    lastSuccessfulCollectionAt: "2026-07-16T10:00:00.000Z",
  };
  const merged = mergeSeedManagedFields(current, seed);
  assert.equal(merged.name, seed.name);
  assert.equal(merged.feedUrl, current.feedUrl);
  assert.equal(merged.baseUrl, current.baseUrl);
  assert.equal(merged.status, current.status);
  assert.equal(merged.editorialNotes, current.editorialNotes);
  assert.equal(merged.lastSuccessfulCollectionAt, current.lastSuccessfulCollectionAt);
});

test("migration editorial é estritamente aditiva", async () => {
  const sql = await readFile(new URL("../drizzle/0003_clean_mathemanic.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "editorial_sources"/);
  assert.match(sql, /CREATE TABLE "editorial_kit_sources"/);
  assert.match(sql, /CREATE TABLE "strategic_accounts"/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i);
  assert.doesNotMatch(sql, /drizzle-kit\s+push/i);
});

test("seed usa transação e conflito idempotente sem apagar ou sobrescrever configuração operacional", async () => {
  const implementation = await readFile(new URL("../scripts/seed-editorial-sources.mjs", import.meta.url), "utf8");
  assert.match(implementation, /sql\.begin/);
  assert.match(implementation, /ON CONFLICT \(source_key\) DO UPDATE SET/);
  assert.match(implementation, /ON CONFLICT \(feed_url\) DO NOTHING/);
  assert.doesNotMatch(implementation, /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
  const updateClause = implementation.split("ON CONFLICT (source_key) DO UPDATE SET")[1];
  assert.doesNotMatch(updateClause, /\b(?:feed_url|base_url|status|editorial_notes|last_verified_at|active_for_collection|monitoring_mode)\s*=/i);
});

test("fontes secundárias e com interesse institucional exigem transparência ou cruzamento", () => {
  const reuters = PRIORITY_EDITORIAL_SOURCES.find((source) => source.sourceKey === "reuters");
  const valor = PRIORITY_EDITORIAL_SOURCES.find((source) => source.sourceKey === "valor-economico");
  const cnt = PRIORITY_EDITORIAL_SOURCES.find((source) => source.sourceKey === "cnt");
  assert.equal(reuters.requiresCrossCheck, true);
  assert.equal(valor.requiresCrossCheck, true);
  assert.equal(valor.paywall, "partial");
  assert.ok(cnt.biasOrInterestDisclosure.length > 0);
});
