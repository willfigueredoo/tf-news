import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REEL_IDEA_PILLARS,
  reelIdeaActionSchema,
  reelIdeaPayloadSchema,
  reelIdeaUpdateSchema,
} from "../lib/reel-ideas.ts";

test("migration de Ideias para Reels é estritamente aditiva", async () => {
  const migration = await readFile(new URL("../drizzle/0009_low_bastion.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "reel_ideas"/);
  assert.match(migration, /CREATE TABLE "reel_idea_sources"/);
  assert.match(migration, /reel_ideas_news_unique/);
  assert.match(migration, /FOREIGN KEY \("news_item_id"\).*"news_items"/s);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i);
});

test("contrato da IA entrega somente insumo editorial e seis pilares oficiais", () => {
  assert.equal(REEL_IDEA_PILLARS.length, 6);
  const payload = {
    title: "Como a previsibilidade de fornecedores afeta a produção industrial",
    summary: "A notícia apresenta mudanças recentes na relação entre fornecedores, estoques e continuidade operacional da indústria brasileira.",
    industryRelevance: "O tema interessa a gestores industriais porque falhas no abastecimento afetam capacidade, produtividade e compromissos com clientes.",
    suggestedAngle: "Explicar que previsibilidade na cadeia de fornecedores deve ser tratada como variável estratégica da operação industrial.",
    suggestedCopy: "Muitas interrupções na produção começam antes da fábrica. Quando fornecedores, estoques e operação não compartilham previsões, a indústria perde capacidade de reação. A notícia mostra por que visibilidade da cadeia deixou de ser apenas uma preocupação logística e passou a influenciar produtividade, custos e atendimento ao cliente.",
    primaryPillar: "Supply Chain e gestão de fornecedores",
    secondaryPillar: "Produtividade e eficiência",
    priority: "high",
  };
  assert.equal(reelIdeaPayloadSchema.safeParse(payload).success, true);
  assert.equal(reelIdeaPayloadSchema.safeParse({ ...payload, primaryPillar: "Pilar inventado" }).success, false);
  assert.doesNotMatch(JSON.stringify(payload), /cena|take|câmera|trilha/i);
});

test("conteúdo é imutável e PATCH aceita apenas organização operacional", () => {
  assert.equal(reelIdeaUpdateSchema.safeParse({ id: 1, status: "review", responsible: "Social Media" }).success, true);
  assert.equal(reelIdeaUpdateSchema.safeParse({ id: 1, title: "Alterado" }).success, false);
  assert.equal(reelIdeaUpdateSchema.safeParse({ id: 1, suggestedCopy: "Alterada" }).success, false);
  assert.equal(reelIdeaActionSchema.safeParse({ action: "create", newsId: 9, origin: "monitoring" }).success, true);
  assert.equal(reelIdeaActionSchema.safeParse({ action: "discover" }).success, true);
});

test("API centraliza Gemini, protege duplicidade e persiste fonte rastreável", async () => {
  const [service, route] = await Promise.all([
    readFile(new URL("../lib/reel-ideas.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reel-ideas/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /runStructuredAi/);
  assert.match(service, /operation: "reel_idea_generation"/);
  assert.match(service, /ON CONFLICT \(news_item_id\) DO NOTHING/);
  assert.match(service, /INSERT INTO reel_idea_sources/);
  assert.match(route, /status: 409/);
  assert.doesNotMatch(service, /new GoogleGenerativeAI|GoogleGenAI/);
});

test("interface usa cards, detalhe somente leitura e notícia original", async () => {
  const [component, app, monitoring] = await Promise.all([
    readFile(new URL("../app/reel-ideas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/monitoring-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /reel-ideas-grid/);
  assert.match(component, /conteúdo somente leitura/);
  assert.match(component, /NOTÍCIA REAL/);
  assert.match(component, /Abrir notícia original/);
  assert.match(component, /Visão Executiva/);
  assert.match(component, /Monitoramento/);
  assert.doesNotMatch(component, /textarea/);
  assert.match(app, /Ideias para Reels/);
  assert.match(monitoring, /Criar ideia para Reels/);
});
