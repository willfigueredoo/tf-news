import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { runStructuredAi } from "../lib/ai.ts";
import { appendTraceableSources, sanitizeWordPressHtml, validateArticleHtml } from "../lib/article-html.ts";
import { deterministicCoherence } from "../lib/editorial-ai.ts";
import { collectSource, testFeed } from "../lib/ingestion.ts";
import { createWordPressDraft, listWordPressTaxonomies } from "../lib/wordpress.ts";

const RSS = `<?xml version="1.0"?><rss><channel><item><title>Safra recorde amplia demanda por transporte</title><link>https://news.example.com/safra?utm_source=rss</link><guid>item-123</guid><description>Conab estima 360 milhões de toneladas e maior fluxo nos portos.</description><content:encoded><![CDATA[<p>A produção cresce e exige planejamento de armazenagem, rodovias e exportação.</p>]]></content:encoded><pubDate>Tue, 14 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

test("valida feed realista e rejeita resposta que não é RSS", async () => {
  const valid = await testFeed("https://feeds.example.com/rss", async () => new Response(RSS, { headers: { "content-type": "application/rss+xml" } }));
  assert.equal(valid.itemCount, 1);
  await assert.rejects(() => testFeed("https://feeds.example.com/rss", async () => new Response("<html>erro</html>", { headers: { "content-type": "text/html" } })), /Nenhuma notícia válida/);
});

test("coleta persiste uma vez e bloqueia duplicidade na segunda execução", async () => {
  const db = new FakeD1();
  const source = { id: 1, name: "Fonte real", feed_url: "https://feeds.example.com/rss", reliability_score: 90 };
  const config = { provider: "", apiKey: "", model: "", baseUrl: "https://api.openai.com/v1", timeoutMs: 1000, maxRetries: 0, dailyCostLimitUsd: 5, dailyRequestLimit: 100, inputCostPerMillion: 1, outputCostPerMillion: 6 };
  const fetchImpl = async () => new Response(RSS, { headers: { "content-type": "application/rss+xml" } });
  const first = await collectSource(db, source, config, { fetchImpl });
  const second = await collectSource(db, source, config, { fetchImpl });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.duplicates, 1);
});

test("detecta seleção desconectada e sugere conteúdos separados", () => {
  const base = { sourceName: "Fonte", originalUrl: "https://example.com/a", publishedAt: new Date().toISOString(), content: "", region: "Brasil", logisticsImpact: "low", icps: [], primaryIcp: "Mercado e Logística" };
  const result = deterministicCoherence([
    { ...base, id: 1, title: "Safra de soja avança", excerpt: "Colheita no campo", topics: ["safra"], icps: ["Agronegócio"], primaryIcp: "Agronegócio" },
    { ...base, id: 2, title: "Novo pigmento para tintas", excerpt: "Indústria química lança produto", topics: ["tintas"], icps: ["Tintas"], primaryIcp: "Tintas", originalUrl: "https://example.com/b" },
  ]);
  assert.equal(result.coherent, false);
  assert.equal(result.suggestedGroups.length, 2);
});

test("sanitiza HTML, exige estrutura editorial e anexa fontes rastreáveis", () => {
  const body = `<script>alert(1)</script><p>${"Análise factual e contexto setorial. ".repeat(30)}</p><h2>O que aconteceu</h2><p>Fatos confirmados.</p><h3>Leitura do mercado</h3><p>Análise.</p><ul><li>Ponto de atenção</li></ul>`;
  const html = appendTraceableSources(sanitizeWordPressHtml(body), [{ sourceName: "Fonte", title: "Notícia", originalUrl: "https://example.com/noticia" }]);
  assert.doesNotMatch(html, /script/i);
  assert.match(html, /Fontes consultadas/);
  assert.equal(validateArticleHtml(html), true);
});

test("IA usa resposta estruturada, valida com Zod e registra custo", async () => {
  const schema = z.object({ result: z.string() });
  const db = new FakeAiDb();
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return Response.json({ error: { message: "rate limit" } }, { status: 429 });
    return Response.json({ id: "resp_1", output_text: JSON.stringify({ result: "ok" }), usage: { input_tokens: 1000, output_tokens: 500 } });
  };
  const response = await runStructuredAi({ db, config: { provider: "openai", apiKey: "test-only", model: "test-model", baseUrl: "https://api.openai.com/v1", timeoutMs: 1000, maxRetries: 1, dailyCostLimitUsd: 5, dailyRequestLimit: 100, inputCostPerMillion: 1, outputCostPerMillion: 6 }, operation: "brief", schemaName: "test_schema", schema, system: "system", user: "user", fetchImpl });
  assert.equal(response.data.result, "ok");
  assert.equal(response.usage.estimatedCostUsd, .004);
  assert.equal(db.logged, true);
});

test("WordPress lista taxonomias, cria somente draft e recupera duplicado pelo slug", async () => {
  const config = { baseUrl: "https://cms.example.com", username: "editor", password: "application-password" };
  const taxonomyFetch = async (url) => Response.json(String(url).includes("categories") ? [{ id: 1, name: "Mercado", slug: "mercado" }] : [{ id: 2, name: "Logística", slug: "logistica" }]);
  const taxonomies = await listWordPressTaxonomies(config, taxonomyFetch);
  assert.equal(taxonomies.categories.length, 1);
  let postedBody;
  const createFetch = async (_url, init) => {
    if (init.method === "GET") return Response.json([]);
    postedBody = JSON.parse(init.body);
    return Response.json({ id: 42, status: "draft", link: "https://cms.example.com/?p=42" });
  };
  const created = await createWordPressDraft(config, { title: "Título", slug: "titulo", excerpt: "Resumo", content: "<p>Conteúdo</p>" }, createFetch);
  assert.equal(postedBody.status, "draft");
  assert.equal(created.postId, 42);
  const duplicate = await createWordPressDraft(config, { title: "Título", slug: "titulo", excerpt: "Resumo", content: "<p>Conteúdo</p>" }, async () => Response.json([{ id: 42, status: "draft", link: "https://cms.example.com/?p=42" }]));
  assert.equal(duplicate.existed, true);
});

class FakeStatement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new FakeStatement(this.db, this.sql, params); }
  async first() { if (this.sql.startsWith("SELECT id FROM news_items")) return this.db.duplicate ? { id: 1 } : null; return null; }
  async all() { return { results: [], meta: {} }; }
  async run() { if (this.sql.startsWith("INSERT INTO news_items")) { if (this.db.duplicate) return { meta: { changes: 0 } }; this.db.duplicate = true; return { meta: { changes: 1, last_row_id: 1 } }; } return { meta: { changes: 1 } }; }
}
class FakeD1 {
  duplicate = false;
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}
class FakeAiDb {
  logged = false;
  prepare(sql) {
    return { bind() { return this; }, async first() { return { requests: 0, cost: 0 }; }, run: async () => { if (sql.startsWith("INSERT INTO ai_usage_logs")) this.logged = true; return { meta: { changes: 1 } }; } };
  }
}
