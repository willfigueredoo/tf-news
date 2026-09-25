import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REEL_IDEA_PILLARS,
  buildReelIdeaRelevance,
  reelIdeaActionSchema,
  reelIdeaPayloadSchema,
  reelIdeaUpdateSchema,
} from "../lib/reel-ideas.ts";
import { selectEvergreenCandidate, selectNewsCandidate } from "../lib/reel-idea-automation.ts";
import { scoreEditorialOpportunity } from "../lib/editorial-intelligence.ts";

test("migration de Ideias para Reels é estritamente aditiva", async () => {
  const [initial, automation] = await Promise.all([
    readFile(new URL("../drizzle/0009_low_bastion.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_past_young_avengers.sql", import.meta.url), "utf8"),
  ]);
  assert.match(initial, /CREATE TABLE "reel_ideas"/);
  assert.match(initial, /CREATE TABLE "reel_idea_sources"/);
  assert.match(initial, /reel_ideas_news_unique/);
  assert.match(initial, /FOREIGN KEY \("news_item_id"\).*"news_items"/s);
  assert.match(automation, /ADD COLUMN "content_type"/);
  assert.match(automation, /ADD COLUMN "relevance_breakdown"/);
  assert.match(automation, /reel_ideas_automation_idx/);
  assert.doesNotMatch(`${initial}\n${automation}`, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i);
});

test("seleção automática usa sete dias e só expande para 14 quando permitido", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const recent = newsFixture(1, "Produção industrial amplia demanda logística", "2026-09-23T12:00:00.000Z");
  const older = newsFixture(2, "Fornecedores revisam redes de abastecimento", "2026-09-15T12:00:00.000Z");
  const invalid = newsFixture(3, "Notícia sem data confiável", "sem-data");
  const primary = selectNewsCandidate([older, invalid, recent], [], {
    now, primaryWindowDays: 7, fallbackWindowDays: 14, minimumRelevance: 55, allowFallback: true,
  });
  assert.equal(primary?.decision.id, 1);
  assert.equal(primary?.windowDays, 7);
  const blockedFallback = selectNewsCandidate([older], [], {
    now, primaryWindowDays: 7, fallbackWindowDays: 14, minimumRelevance: 55, allowFallback: false,
  });
  assert.equal(blockedFallback, null);
  const fallback = selectNewsCandidate([older], [], {
    now, primaryWindowDays: 7, fallbackWindowDays: 14, minimumRelevance: 55, allowFallback: true,
  });
  assert.equal(fallback?.decision.id, 2);
  assert.equal(fallback?.fallback, true);
});

test("evergreen usa sinais reais e score de relevância soma 100 pontos possíveis", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const seed = newsFixture(4, "Tecnologia melhora previsibilidade da indústria", "2026-09-20T12:00:00.000Z");
  const related = newsFixture(5, "Dados conectam fornecedores e produção", "2026-09-18T12:00:00.000Z", { sourceName: "Outra Fonte" });
  const candidate = selectEvergreenCandidate([seed, related], [], { now, minimumRelevance: 55 });
  assert.equal(candidate?.decision.id, 4);
  assert.equal(candidate?.related.length, 1);
  const relevance = buildReelIdeaRelevance(scoreEditorialOpportunity(seed, now), "evergreen", 2);
  assert.equal(Object.values(relevance.components).reduce((sum, item) => sum + item.max, 0), 100);
  assert.equal(Object.values(relevance.components).reduce((sum, item) => sum + item.score, 0), relevance.score);
  assert.ok(["strategic", "high", "medium"].includes(relevance.level));
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
  assert.match(component, /Relevância \{idea\.relevanceScore\}\/100/);
  assert.match(component, /Evergreen/);
  assert.doesNotMatch(component, /textarea/);
  assert.match(app, /Ideias para Reels/);
  assert.match(monitoring, /Criar ideia para Reels/);
});

test("cron protegido distribui atualidade e evergreen em execuções independentes", async () => {
  const [route, vercel, automation] = await Promise.all([
    readFile(new URL("../app/api/cron/reel-ideas/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/reel-idea-automation.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /getCronSecret/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.equal((vercel.match(/api\/cron\/reel-ideas\?mode=news/g) ?? []).length, 3);
  assert.equal((vercel.match(/api\/cron\/reel-ideas\?mode=evergreen/g) ?? []).length, 1);
  assert.match(automation, /acquireJobLock/);
  assert.match(automation, /job_logs/);
  assert.match(automation, /weekly_limit/);
  assert.match(automation, /daily_limit/);
});

function newsFixture(id, title, publishedAt, overrides = {}) {
  return {
    id,
    title,
    excerpt: "A indústria acompanha mudanças em produção, fornecedores, tecnologia, eficiência e transporte de cargas.",
    content: "Empresas industriais revisam capacidade, custos, abastecimento e integração logística para sustentar a produção.",
    sourceName: "Fonte Industrial",
    originalUrl: `https://example.com/noticia-${id}`,
    publishedAt,
    collectedAt: "2026-09-25T11:00:00.000Z",
    primaryIcp: "Máquinas e Equipamentos Pesados",
    secondaryIcps: ["Aço", "Indústria Química"],
    topics: ["indústria", "fornecedores", "logística"],
    region: "Brasil",
    logisticsImpact: "high",
    relevanceScore: 90,
    status: "new",
    sourceReliability: 90,
    sourceAuthorityLevel: "high",
    sourcePrimaryOrSecondary: "primary",
    sourceOfficial: false,
    sourceRequiresCrossCheck: false,
    sourceMinimumConfirmationSources: 1,
    ...overrides,
  };
}
