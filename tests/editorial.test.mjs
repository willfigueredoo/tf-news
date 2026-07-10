import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, classifyNews, isSafeHttpUrl, parseFeed } from "../lib/editorial.ts";

test("canonicaliza URL e remove parâmetros de rastreamento", () => {
  assert.equal(canonicalizeUrl("HTTPS://EXAMPLE.COM/noticia/?utm_source=x&b=2&a=1#top"), "https://example.com/noticia?a=1&b=2");
});

test("bloqueia destinos privados explícitos", () => {
  assert.equal(isSafeHttpUrl("http://127.0.0.1/feed"), false);
  assert.equal(isSafeHttpUrl("http://192.168.1.5/rss"), false);
  assert.equal(isSafeHttpUrl("https://example.com/feed"), true);
});

test("interpreta RSS e ignora item sem URL pública", () => {
  const items = parseFeed(`<?xml version="1.0"?><rss><channel><item><title>Safra exige atenção logística</title><link>https://example.com/safra</link><description><![CDATA[Transporte e armazenagem no Centro-Oeste.]]></description><pubDate>Fri, 10 Jul 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Safra exige atenção logística");
});

test("classifica notícia em múltiplas dimensões", () => {
  const result = classifyNews({ title: "Safra amplia demanda por fertilizantes", excerpt: "Portos, transporte e armazenagem no Centro-Oeste", publishedAt: new Date().toISOString(), reliabilityScore: 90 });
  assert.equal(result.primaryIcp, "Agronegócio");
  assert.equal(result.logisticsImpact, "high");
  assert.ok(result.relevanceScore >= 60);
  assert.ok(result.topics.includes("safra"));
});

