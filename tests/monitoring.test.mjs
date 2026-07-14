import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, toCsv } from "../lib/csv.ts";
import { classifyNews, newsUpdateSchema, sourceInputSchema, sourceUpdateSchema } from "../lib/editorial.ts";
import { inspectFeed } from "../lib/ingestion.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>Mercado real</title><item><title>Aço e máquinas ampliam demanda logística</title><link>https://example.com/mercado</link><description>Portos e transporte recebem novos equipamentos pesados.</description><pubDate>Tue, 14 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

test("exporta e importa CSV preservando vírgulas, aspas e linhas", () => {
  const csv = toCsv([{ name: "Fonte, Brasil", notes: 'Linha 1\nTexto "real"' }], [
    { key: "name", label: "name" },
    { key: "notes", label: "notes" },
  ]);
  assert.deepEqual(parseCsv(csv), [{ name: "Fonte, Brasil", notes: 'Linha 1\nTexto "real"' }]);
});

test("valida cadastro, edição e ações em lote do Monitoramento", () => {
  const source = sourceInputSchema.parse({ name: "Fonte real", feedUrl: "https://example.com/rss" });
  assert.equal(source.collectionFrequencyMinutes, 720);
  assert.equal(source.country, "BR");
  assert.equal(sourceUpdateSchema.parse({ id: 1, action: "pause" }).action, "pause");
  const action = newsUpdateSchema.parse({ action: "setImpact", newsIds: [1, 2], logisticsImpact: "high" });
  assert.deepEqual(action.newsIds, [1, 2]);
});

test("inspeção de feed informa formato, título, conteúdo e HTTPS", async () => {
  const result = await inspectFeed("https://example.com/rss", async () => new Response(RSS, { headers: { "content-type": "application/rss+xml" } }));
  assert.equal(result.status, "valid");
  assert.equal(result.format, "rss");
  assert.equal(result.title, "Mercado real");
  assert.equal(result.itemCount, 1);
  assert.equal(result.usesHttps, true);
});

test("inspeção de feed diferencia formato não suportado e bloqueio", async () => {
  const unsupported = await inspectFeed("https://example.com/rss", async () => Response.json({ error: "sem feed" }));
  assert.equal(unsupported.status, "unsupported");
  const blocked = await inspectFeed("http://127.0.0.1/rss");
  assert.equal(blocked.status, "blocked");
});

test("classificação determinística aceita múltiplos ICPs e explica os termos", () => {
  const result = classifyNews({
    title: "Aço e máquina agrícola elevam fluxo nos portos",
    excerpt: "Siderurgia, trator e transporte pressionam a distribuição no Sul.",
    publishedAt: new Date().toISOString(),
    reliabilityScore: 90,
  });
  assert.ok([result.primaryIcp, ...result.secondaryIcps].includes("Aço"));
  assert.ok([result.primaryIcp, ...result.secondaryIcps].includes("Máquinas e Equipamentos Pesados"));
  assert.match(result.reason, /Aderência a/);
  assert.equal(result.logisticsImpact, "high");
});
