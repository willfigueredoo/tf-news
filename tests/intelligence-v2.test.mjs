import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import { buildEditorialIntelligence, isValidEditorialInput, scoreEditorialOpportunity } from "../lib/editorial-intelligence.ts";
import { AiProviderRequestError, normalizeProviderSchema, runStructuredAi } from "../lib/ai.ts";
import { buildGutenbergHtml, createEditorialKit, EDITORIAL_KIT_MAX_OUTPUT_TOKENS, EDITORIAL_KIT_TIMEOUT_MS, normalizeEditorialKitPayload, normalizeGeneratedEditorialKitPayload } from "../lib/editorial-kit.ts";
import { editorialKitPayloadSchema, editorialKitRawPayloadSchema, editorialKitUpdateSchema } from "../lib/operational-schemas.ts";
import { applyPermanentEditorialPolicy, EDITORIAL_TECHNICAL_EDITOR_PROMPT, findEditorialPolicyViolations } from "../lib/editorial-policy.ts";

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
  sourceType: "official",
  sourceAuthorityLevel: "high",
  sourcePrimaryOrSecondary: "primary",
  sourceOfficial: true,
  sourceRequiresCrossCheck: false,
};

const FAILED_PRODUCTION_NEWS = {
  ...NEWS,
  id: 32,
  title: "Preços da soja sobem com Chicago em alta; confira as os números no Brasil",
  excerpt: "Avanço das cotações internacionais, prêmios elevados e dólar praticamente estável garantiram a alta da oleaginosa.",
  content: "Segundo o Canal Rural, a valorização da soja na Bolsa de Chicago, os prêmios firmes e o câmbio praticamente estável sustentaram os preços no mercado físico brasileiro.",
  sourceName: "Canal Rural",
  originalUrl: "https://www.canalrural.com.br/agricultura/projeto-soja-brasil/precos-da-soja-sobem-com-chicago-em-alta-confira-as-os-numeros-no-brasil/",
  primaryIcp: "Agronegócio",
  secondaryIcps: ["Aço", "Nutrição Animal"],
  topics: ["safra", "aço", "portos"],
  region: "Sul",
  logisticsImpact: "medium",
  relevanceScore: 80,
  sourceReliability: 85,
  sourceType: "press",
  sourceAuthorityLevel: "high",
  sourcePrimaryOrSecondary: "secondary",
  sourceOfficial: false,
  sourceRequiresCrossCheck: true,
};

test("prioriza uma oportunidade editorial real e explica o score", () => {
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  assert.ok(decision.editorialScore >= 80);
  assert.equal(decision.classification, "very_relevant");
  assert.equal(decision.produceContent, true);
  assert.match(decision.decisionReason, /Agronegócio/);
  assert.equal(Object.keys(decision.scoreBreakdown).length, 9);
  assert.equal(decision.sourceGovernance.status, "publishable");
  assert.ok(decision.scoreBreakdown.sourceReliability >= 80);
});

test("permite Kit com fonte única de alta autoridade e recomenda revisão", () => {
  for (const sourceName of ["Reuters", "Valor Econômico", "Canal Rural", "Globo Rural", "Notícias Agrícolas", "Broadcast Agro"]) {
    const decision = scoreEditorialOpportunity({ ...NEWS, sourceName, sourceOfficial: false, sourcePrimaryOrSecondary: "secondary", sourceType: "press", sourceRequiresCrossCheck: true }, NOW);
    assert.equal(decision.produceContent, true, sourceName);
    assert.equal(decision.sourceGovernance.status, "review_recommended", sourceName);
    assert.equal(decision.sourceGovernance.notice, "Conteúdo baseado em uma única fonte. Revisão recomendada antes da publicação.");
  }
});

test("recomenda confirmação adicional para tema oficial sem bloquear a geração", () => {
  let pressDecision;
  for (const title of [
    "Medida provisória altera regras para o transporte de cargas",
    "MP 123 altera regras para o transporte de cargas",
    "Nova resolução muda exigências regulatórias",
    "Portaria estabelece procedimento para operadores",
    "Lei redefine obrigações do setor",
    "Estatística do PIB indica mudança na atividade",
    "Ato governamental autoriza nova concessão",
  ]) {
    pressDecision = scoreEditorialOpportunity({
      ...NEWS,
      title,
      content: `${title}. O conteúdo ainda depende de validação no texto oficial.`,
      sourceName: "Reuters",
      sourceOfficial: false,
      sourcePrimaryOrSecondary: "secondary",
      sourceType: "press",
      sourceRequiresCrossCheck: true,
    }, NOW);
    assert.equal(pressDecision.produceContent, true, title);
    assert.equal(pressDecision.sourceGovernance.status, "additional_confirmation_recommended", title);
    assert.equal(pressDecision.sourceGovernance.canGenerate, true, title);
    assert.match(pressDecision.sourceGovernance.notice, /fonte oficial/i);
  }

  const officialDecision = scoreEditorialOpportunity({ ...pressDecision, sourceName: "Diário Oficial da União", sourceOfficial: true, sourcePrimaryOrSecondary: "primary", sourceType: "official", sourceRequiresCrossCheck: false }, NOW);
  assert.equal(officialDecision.produceContent, true);
  assert.equal(officialDecision.sourceGovernance.status, "publishable");
});

test("política permanente orienta imparcialidade sem bloquear heurísticas e preserva rastreabilidade", () => {
  assert.match(EDITORIAL_TECHNICAL_EDITOR_PROMPT, /Editor Técnico/);
  assert.match(EDITORIAL_TECHNICAL_EDITOR_PROMPT, /Nunca produza opiniões próprias/);
  assert.ok(findEditorialPolicyViolations("<p>O governo acertou. O setor cresceu 10%.</p>").length > 0);
  const governed = applyPermanentEditorialPolicy("<h2>Contexto</h2><p>Segundo a fonte oficial, a medida pode alterar o fluxo.</p>", [{ name: "Órgão oficial", title: "Publicação original", url: "https://example.com/publicacao", sourceType: "official", primaryOrSecondary: "primary" }]);
  assert.match(governed, /Fontes consultadas/);
  assert.match(governed, /https:\/\/example\.com\/publicacao/);
  assert.match(governed, /Tipo: Official/);
  assert.match(governed, /Este conteúdo foi elaborado a partir de fontes oficiais/);
  assert.equal((governed.match(/data-tf-news-transparency/g) ?? []).length, 1);
});

test("aceita somente entradas editoriais com conteúdo, fonte e URL válidos", () => {
  assert.equal(isValidEditorialInput(NEWS), true);
  assert.equal(isValidEditorialInput({ ...NEWS, content: "", excerpt: "" }), false);
  assert.equal(isValidEditorialInput({ ...NEWS, sourceName: "" }), false);
  assert.equal(isValidEditorialInput({ ...NEWS, originalUrl: "javascript:alert(1)" }), false);
  const lowScore = scoreEditorialOpportunity({ ...NEWS, relevanceScore: 1, logisticsImpact: "low" }, NOW);
  assert.equal(lowScore.produceContent, true);
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
  const phases = [];
  const fetchImpl = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ responseId: "gemini-request", candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "decisão editorial" }) }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await runStructuredAi({
    db,
    config: { provider: "gemini", apiKey: "secret-test-key", model: "gemini-3.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta", timeoutMs: 1000, maxRetries: 0, dailyCostLimitUsd: 5, dailyRequestLimit: 10, inputCostPerMillion: 0, outputCostPerMillion: 0 },
    operation: "editorial-kit",
    schemaName: "test_schema",
    schema: z.object({ answer: z.string() }),
    system: "Sistema",
    user: "Usuário",
    fetchImpl,
    phaseLogger: (entry) => phases.push(entry),
  });
  assert.equal(result.data.answer, "decisão editorial");
  assert.match(captured.url, /gemini-3\.5-flash:generateContent$/);
  assert.doesNotMatch(captured.url, /secret-test-key/);
  assert.equal(captured.init.headers["x-goog-api-key"], "secret-test-key");
  assert.doesNotMatch(String(captured.init.body), /secret-test-key/);
  const requestBody = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(requestBody).sort(), ["contents", "generationConfig", "systemInstruction"]);
  assert.equal(requestBody.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(requestBody.generationConfig.candidateCount, 1);
  assert.equal("tools" in requestBody, false);
  assert.equal("toolConfig" in requestBody, false);
  assert.deepEqual(phases.map((entry) => entry.phase), ["request_start", "provider_response", "zod_validation_start", "zod_validation_end"]);
  assert.ok(queries.some((query) => query.includes("ai_usage_logs")));
});

test("normaliza o JSON Schema editorial para o subconjunto aceito pelo Gemini", () => {
  const providerSchema = normalizeProviderSchema(z.toJSONSchema(editorialKitRawPayloadSchema, { target: "draft-7" }));
  const positiveIntegerSchema = normalizeProviderSchema(z.toJSONSchema(z.object({ sourceId: z.number().int().positive() }), { target: "draft-7" }));
  const serialized = JSON.stringify(providerSchema);
  const sourceProperties = providerSchema.properties.blog.properties.sources.items.properties;
  const blockType = providerSchema.properties.blog.properties.blocks.items.properties.type;

  assert.deepEqual(Object.keys(sourceProperties).sort(), ["name", "url"]);
  assert.deepEqual(positiveIntegerSchema.properties.sourceId, { type: "integer", minimum: 1, maximum: 9007199254740991 });
  assert.deepEqual(blockType, { type: "string", enum: ["section"] });
  assert.doesNotMatch(serialized, /"(?:exclusiveMinimum|exclusiveMaximum|const|minLength|maxLength|pattern)"/);
  assert.match(serialized, /"response"|"blog"/);
});

test("reproduz a notícia de produção e preserva o erro técnico completo do Gemini", async () => {
  const decision = scoreEditorialOpportunity(FAILED_PRODUCTION_NEWS, NOW);
  const providerLogs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => providerLogs.push(args.join(" "));
  try {
    await assert.rejects(createEditorialKit(fakeAiDb([]), aiConfig({ model: "gemini-3.1-flash-lite", maxRetries: 0 }), decision, {
      now: NOW,
      phaseLogger: () => {},
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: 400,
          message: "Request contains an invalid argument.",
          status: "INVALID_ARGUMENT",
          details: [{ field: "generationConfig.responseJsonSchema", reason: "exclusiveMinimum is not supported" }],
        },
      }), { status: 400, headers: { "Content-Type": "application/json" } }),
    }), (error) => {
      assert.ok(error instanceof AiProviderRequestError);
      assert.equal(error.httpStatus, 400);
      assert.equal(error.providerStatus, "INVALID_ARGUMENT");
      assert.deepEqual(error.details, [{ field: "generationConfig.responseJsonSchema", reason: "exclusiveMinimum is not supported" }]);
      return true;
    });
  } finally {
    console.error = originalConsoleError;
  }

  const technicalLog = providerLogs.join("\n");
  assert.match(technicalLog, /INVALID_ARGUMENT/);
  assert.match(technicalLog, /exclusiveMinimum is not supported/);
  assert.match(technicalLog, /"newsId":32/);
  assert.match(technicalLog, /Preços da soja sobem com Chicago em alta/);
  assert.match(technicalLog, /"x-goog-api-key":"\[REDACTED\]"/);
  assert.doesNotMatch(technicalLog, /test-key/);
});

test("valida o Kit minimalista somente com Blog SEO e WhatsApp", () => {
  const payload = editorialKitPayloadSchema.parse({ ...minimalPayload(), metadata: { legacy: true }, linkedin: { content: "campo descartado" } });
  assert.deepEqual(Object.keys(payload).sort(), ["blog", "whatsapp"]);
  assert.deepEqual(Object.keys(payload.whatsapp), ["text"]);
  assert.equal(payload.whatsapp.text.length >= 400, true);
  assert.equal(payload.whatsapp.text.length <= 700, true);
  assert.equal(EDITORIAL_KIT_MAX_OUTPUT_TOKENS, 1_800);
  assert.equal(EDITORIAL_KIT_TIMEOUT_MS, 54_000);
});

test("modela o artigo como blocos Gutenberg sem repetir o título no corpo", () => {
  const payload = minimalPayload();
  const html = buildGutenbergHtml(payload.blog);
  assert.equal(payload.blog.blocks.length, 4);
  assert.equal((html.match(/<h2>/g) ?? []).length, 5);
  assert.match(html, /^<p>/);
  assert.match(html, /<h2>Conclusão<\/h2>/);
  assert.doesNotMatch(html, new RegExp(payload.blog.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.equal(payload.blog.blocks.some((block) => /^(Impacto Logístico|Impacto no Mercado|Oportunidades|Próximos Passos)$/i.test(block.heading)), false);
  assert.throws(() => editorialKitPayloadSchema.parse({ ...payload, blog: { ...payload.blog, blocks: payload.blog.blocks.map((block, index) => index === 0 ? { ...block, heading: "Impacto Logístico" } : block) } }));
});

test("aceita revisão completa do Kit existente sem alterar o schema do banco", () => {
  const update = editorialKitUpdateSchema.parse({ id: 7, action: "save", payload: minimalPayload() });
  assert.equal(update.action, "save");
  assert.equal(update.id, 7);
  assert.equal(update.payload.blog.seoTitle, minimalPayload().blog.seoTitle);
  assert.throws(() => editorialKitUpdateSchema.parse({ id: 7, action: "save", payload: { blog: minimalPayload().blog } }));
});

test("orienta a experiência editorial para Gutenberg com arquitetura única e WhatsApp natural", async () => {
  const implementation = await readFile(new URL("../lib/editorial-kit.ts", import.meta.url), "utf8");
  assert.match(implementation, /entre 450 e 550 palavras/);
  assert.match(implementation, /entre 4 e 6 blocos/);
  assert.match(implementation, /arquitetura editorial única/);
  assert.match(implementation, /Não use headings genéricos como Impacto Logístico, Impacto no Mercado, Oportunidades ou Próximos Passos/);
  assert.match(implementation, /nunca deve ser repetido na introdução, nos blocos ou na conclusão/);
  assert.match(implementation, /450 a 650 caracteres/);
  assert.match(implementation, /sem tom promocional excessivo/);
  assert.match(implementation, /EDITORIAL_KIT_TIMEOUT_MS = 54_000/);
  assert.match(implementation, /retryPolicy: "high-demand"/);
});

test("normaliza comprimentos, slug e arrays sem cortar palavras", () => {
  const raw = minimalPayload();
  raw.blog.seoTitle = "Mercado de etanol amplia oportunidades logísticas para empresas brasileiras em 2026!!!";
  raw.blog.metaDescription = `${raw.blog.metaDescription} ${"Planejamento logístico preserva eficiência operacional e competitividade. ".repeat(4)}`;
  raw.blog.slug = "  Mercado de Etanol / Expansão & Logística --- " + "planejamento-".repeat(20);
  raw.blog.excerpt = `${raw.blog.excerpt} ${"Empresas devem acompanhar capacidade, prazos e custos logísticos. ".repeat(12)}`;
  raw.blog.tags = [" Etanol ", "etanol", "", "Logística", "logística", "Mercado", "Energia", "Brasil", "Transporte", "Planejamento", "Infraestrutura"];
  raw.blog.secondaryKeywords = [" Transporte ", "transporte", "", "Armazenagem", "Custos", "Eficiência", "Rotas", "Mercado", "Oferta", "Demanda"];
  raw.whatsapp.text = `${raw.whatsapp.text} ${"As empresas precisam revisar rotas e capacidade antes do aumento de demanda. ".repeat(8)}`;

  const normalized = normalizeGeneratedEditorialKitPayload(raw);
  assert.ok(normalized.blog.seoTitle.length <= 70);
  assert.doesNotMatch(normalized.blog.seoTitle, /[,;:!?./–—-]$/u);
  assert.ok(raw.blog.seoTitle.split(/\s+/).some((word) => word.replace(/[!]+$/u, "") === normalized.blog.seoTitle.split(" ").at(-1)));
  assert.ok(normalized.blog.metaDescription.length <= 170);
  assert.ok(normalized.blog.excerpt.length <= 500);
  assert.match(normalized.blog.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(normalized.blog.slug.length <= 140);
  assert.doesNotMatch(normalized.blog.slug, /-$/);
  assert.deepEqual(normalized.blog.tags.slice(0, 3), ["Etanol", "Logística", "Mercado"]);
  assert.equal(new Set(normalized.blog.tags.map((tag) => tag.toLocaleLowerCase("pt-BR"))).size, normalized.blog.tags.length);
  assert.ok(normalized.blog.tags.length <= 8);
  assert.ok(normalized.blog.secondaryKeywords.length <= 8);
  assert.ok(normalized.whatsapp.text.length <= 700);
  assert.match(normalized.whatsapp.text, /[.!?]$/u);
  assert.doesNotThrow(() => editorialKitPayloadSchema.parse(normalized));
});

test("cancela a chamada com AbortController no timeout interno e registra a falha", async () => {
  let aborted = false;
  const queries = [];
  const db = fakeAiDb(queries);
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      aborted = init.signal.aborted;
      reject(new Error("aborted"));
    }, { once: true });
  });
  await assert.rejects(runStructuredAi({
    db,
    config: aiConfig({ timeoutMs: 20 }),
    operation: "editorial-kit",
    schemaName: "timeout_schema",
    schema: z.object({ answer: z.string() }),
    system: "Sistema",
    user: "Usuário",
    fetchImpl,
    phaseLogger: () => {},
  }), /Timeout interno da IA após \d+ ms/);
  assert.equal(aborted, true);
  assert.ok(queries.some((query) => query.includes("ai_usage_logs")));
});

test("não persiste Kit parcial quando a geração falha", async () => {
  const queries = [];
  let requests = 0;
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  await assert.rejects(createEditorialKit(db, aiConfig(), decision, {
    now: NOW,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: "falha controlada" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    },
    phaseLogger: () => {},
    delayImpl: async () => assert.fail("não deve aguardar ou repetir erro sem alta demanda"),
  }), /falha controlada/);
  assert.equal(requests, 1);
  assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
});

test("aguarda 5s e 10s em alta demanda, conclui na terceira tentativa e só então persiste", async () => {
  const queries = [];
  const phases = [];
  const delays = [];
  let requests = 0;
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  const kit = await createEditorialKit(db, aiConfig({ model: "gemini-3.5-flash" }), decision, {
    now: NOW,
    phaseLogger: (entry) => phases.push(entry),
    delayImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      requests += 1;
      if (requests < 3) return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503, headers: { "Content-Type": "application/json" } });
      const overlong = minimalPayload();
      overlong.blog.seoTitle = "Mercado de etanol amplia oportunidades logísticas para empresas brasileiras em 2026";
      overlong.blog.tags = ["Etanol", "etanol", "", "Logística"];
      overlong.blog.sources.push({ name: "Fonte inventada", url: "https://inventada.example/fonte" });
      overlong.whatsapp.text = `${overlong.whatsapp.text} ${"Segundo a fonte consultada, a operação deve acompanhar capacidade e rotas. ".repeat(8)}`;
      return new Response(JSON.stringify({ responseId: "minimal-kit", candidates: [{ content: { parts: [{ text: JSON.stringify(overlong) }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 900 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(kit.id, 123);
  assert.ok(kit.payload.blog.seoTitle.length <= 70);
  assert.ok(kit.payload.whatsapp.text.length <= 700);
  assert.deepEqual(kit.payload.blog.tags, ["Etanol", "Logística"]);
  assert.deepEqual(kit.payload.blog.sources.map((source) => source.url), [NEWS.originalUrl]);
  assert.equal(kit.payload.blog.sources[0].primaryOrSecondary, "primary");
  assert.match(kit.payload.blog.html, /Fontes consultadas/);
  assert.match(kit.payload.blog.html, /data-tf-news-transparency/);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
  assert.deepEqual(phases.map((entry) => entry.phase), ["request_start", "provider_response", "retry_wait", "request_start", "provider_response", "retry_wait", "request_start", "provider_response", "zod_validation_start", "zod_validation_end", "normalization_start", "normalization_end", "zod_final_validation_start", "zod_final_validation_end", "persistence_start", "persistence_end"]);
  assert.ok(queries.some((query) => query.includes("INSERT INTO editorial_kits") && query.includes("INSERT INTO editorial_kit_sources")));
});

test("não bloqueia nem reescreve Kit válido por expressões editoriais permitidas", async () => {
  const queries = [];
  const payload = minimalPayload();
  payload.blog.seoTitle = "Impactos da soja: o que muda para empresas";
  payload.blog.blocks[0].heading = "Reflexos para o setor e pontos de atenção";
  payload.blog.blocks[0].content = "A movimentação pode impactar os fluxos e pode afetar o planejamento das empresas. O cenário exige atenção aos dados divulgados pela fonte consultada, sem antecipar resultados.";
  payload.whatsapp.text = "A movimentação da soja pode impactar os fluxos e pode afetar o planejamento das empresas. O cenário exige atenção aos dados divulgados pelo Canal Rural e aos possíveis reflexos para o setor. Na logística, vale acompanhar prazos, disponibilidade de transporte e comportamento das rotas, sem antecipar resultados. Se o tema fizer parte da sua operação, a TransFAST pode apoiar uma conversa objetiva sobre capacidade e planejamento para os próximos embarques.";
  const decision = scoreEditorialOpportunity(FAILED_PRODUCTION_NEWS, NOW);

  const kit = await createEditorialKit(fakeAiDb(queries), aiConfig({ model: "gemini-3.1-flash-lite" }), decision, {
    now: NOW,
    phaseLogger: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ responseId: "allowed-editorial-language", candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 800 } }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });

  assert.equal(kit.id, 123);
  assert.equal(kit.newsItemId, FAILED_PRODUCTION_NEWS.id);
  assert.match(kit.payload.blog.seoTitle, /Impactos/);
  assert.match(kit.payload.blog.html, /pode impactar/);
  assert.match(kit.payload.whatsapp.text, /pode afetar/);
  assert.ok(queries.some((query) => query.includes("INSERT INTO editorial_kits") && query.includes("INSERT INTO editorial_kit_sources")));
});

test("encerra após a terceira resposta de alta demanda sem persistência parcial", async () => {
  const queries = [];
  const delays = [];
  let requests = 0;
  const db = fakeAiDb(queries);
  const decision = scoreEditorialOpportunity(NEWS, NOW);
  await assert.rejects(createEditorialKit(db, aiConfig({ model: "gemini-3.5-flash" }), decision, {
    now: NOW,
    phaseLogger: () => {},
    delayImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 429, headers: { "Content-Type": "application/json" } });
    },
  }), /high demand/);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
  assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
});

test("rejeita estrutura ausente ou marcação insegura nos blocos sem persistência parcial", async () => {
  for (const invalidPayload of [
    { blog: minimalPayload().blog },
    { ...minimalPayload(), blog: { ...minimalPayload().blog, blocks: minimalPayload().blog.blocks.map((block, index) => index === 0 ? { ...block, content: `<script>alert("inválido")</script>${block.content}` } : block) } },
  ]) {
    const queries = [];
    const db = fakeAiDb(queries);
    const decision = scoreEditorialOpportunity(NEWS, NOW);
    await assert.rejects(createEditorialKit(db, aiConfig({ model: "gemini-3.1-flash-lite" }), decision, {
      now: NOW,
      phaseLogger: () => {},
      fetchImpl: async () => new Response(JSON.stringify({ responseId: "invalid-kit", candidates: [{ content: { parts: [{ text: JSON.stringify(invalidPayload) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    }));
    assert.equal(queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
  }
});

test("normaliza kits antigos para leitura sem alterar os dados persistidos", () => {
  const legacy = {
    strategicIntelligence: { eventSummary: "Resumo preservado do kit anterior." },
    blogSeo: { seoTitle: "Título SEO legado", metaDescription: "Descrição legada", slug: "titulo-legado", cta: "CTA legado", category: "Logística", tags: ["logística", "mercado"], html: "<p>Conteúdo legado</p>" },
    whatsapp: { title: "WhatsApp", content: "Mensagem comercial legada" },
    linkedin: { title: "LinkedIn", content: "Conteúdo legado" },
    newsletter: { title: "Newsletter", content: "Conteúdo legado" },
    reels: { hook: "Gancho legado", scenes: ["Cena 1", "Cena 2", "Cena 3"], caption: "Legenda" },
    imagePrompt: "Prompt legado que permanece intacto no banco",
    sources: [{ name: NEWS.sourceName, url: NEWS.originalUrl }],
  };
  const normalized = normalizeEditorialKitPayload(legacy, { newsId: 1, title: "Kit legado", primaryIcp: NEWS.primaryIcp, editorialScore: 88, createdAt: NOW.toISOString() });
  assert.equal(normalized.blog.seoTitle, "Título SEO legado");
  assert.equal(normalized.whatsapp.text, "Mensagem comercial legada");
  assert.equal("linkedin" in normalized, false);
  assert.equal(legacy.linkedin.content, "Conteúdo legado");
});

test("mantém compatibilidade de leitura com o payload Blog + WhatsApp anterior", () => {
  const previous = {
    metadata: { version: "v1" },
    blog: { ...minimalPayload().blog, cta: "CTA da versão anterior" },
    whatsapp: { content: minimalPayload().whatsapp.text },
  };
  const normalized = normalizeEditorialKitPayload(previous, { newsId: 1, title: "Kit anterior", primaryIcp: NEWS.primaryIcp, editorialScore: 88, createdAt: NOW.toISOString() });
  assert.equal(normalized.whatsapp.text, previous.whatsapp.content);
  assert.ok(normalized.blog.introduction.length > 0);
  assert.ok(normalized.blog.blocks.length >= 1);
  assert.ok(normalized.blog.conclusion.length > 0);
  assert.equal("cta" in normalized.blog, false);
  assert.equal(previous.blog.cta, "CTA da versão anterior");
});

test("migration da Biblioteca é somente aditiva", async () => {
  const migration = await readFile(new URL("../drizzle/0002_overjoyed_gideon.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "editorial_kits"/);
  assert.match(migration, /CREATE INDEX "editorial_kits_news_idx"/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE SET)\b/i);
});

test("endpoint bloqueia geração paga antes de a Biblioteca existir", async () => {
  const route = await readFile(new URL("../app/api/editorial-kits/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("to_regclass('public.editorial_kits')") < route.indexOf("createEditorialKit(db"));
  assert.match(route, /schema_pending/);
  assert.match(route, /input\.action === "save"/);
  assert.match(route, /UPDATE editorial_kits SET title = \?, payload = \?, updated_at = \? WHERE id = \?/);
  assert.match(route, /validation_failed/);
  assert.match(route, /ai_invalid_argument/);
  assert.match(route, /diagnóstico técnico completo foi registrado/);
  assert.match(route, /invalid_editorial_input/);
  assert.doesNotMatch(route, /editorial_policy_failed|official_confirmation_required|pending_confirmation/);
});

function aiConfig(overrides = {}) {
  return { provider: "gemini", apiKey: "test-key", model: "gemini-test", baseUrl: "https://example.test/v1beta", timeoutMs: 1_000, maxRetries: 0, dailyCostLimitUsd: 5, dailyRequestLimit: 10, inputCostPerMillion: 0, outputCostPerMillion: 0, ...overrides };
}

function fakeAiDb(queries) {
  return {
    prepare(query) {
      queries.push(query);
      return {
        bind() { return this; },
        async first() { return { requests: 0, cost: 0 }; },
        async run() { return { results: [], meta: { changes: 1, ...(query.includes("INSERT INTO editorial_kits") ? { last_row_id: 123 } : {}) } }; },
      };
    },
  };
}

function minimalPayload() {
  const introduction = "Segundo a fonte consultada, a expansão produtiva anunciada para o agronegócio no Centro-Oeste amplia a atenção sobre armazenagem, transporte e coordenação entre fornecedores. O movimento ocorre em uma região relevante para o escoamento da produção e exige leitura técnica dos efeitos operacionais já informados. Para empresas do setor, o dado central é a necessidade de acompanhar capacidade, prazos e integração logística sem antecipar consequências que ainda não foram confirmadas. A leitura editorial permanece vinculada aos dados publicados, ao cronograma informado e às atualizações rastreáveis da operação regional.";
  const blocks = [
    { type: "section", heading: "O que sustenta a nova capacidade produtiva", content: "Conforme divulgado pela fonte consultada, o investimento amplia a estrutura destinada à produção regional. A informação permite dimensionar o acontecimento, mas não autoriza projeções próprias sobre volume, receita ou participação de mercado. Esses indicadores dependem de dados posteriores da empresa e de órgãos setoriais." },
    { type: "section", heading: "Como os fluxos regionais entram no planejamento", content: "A localização da operação conecta fornecedores, unidades produtivas, armazéns e destinos de distribuição. Segundo os dados disponíveis, o planejamento logístico deve considerar janelas de carregamento, capacidade de armazenagem e regularidade das rotas, sempre conforme a evolução efetivamente comunicada pela fonte original." },
    { type: "section", heading: "Quais empresas precisam acompanhar o movimento", content: "Produtores, cooperativas, transportadores e operadores de armazenagem estão entre os agentes relacionados ao fluxo descrito. A notícia não confirma aumento automático de demanda para cada empresa, mas apresenta um fato relevante para o acompanhamento de contratos, disponibilidade operacional e coordenação entre elos da cadeia." },
    { type: "section", heading: "Indicadores que ajudam a medir os próximos efeitos", content: "Os próximos comunicados sobre cronograma, capacidade utilizada, origem dos insumos e destinos da produção poderão oferecer parâmetros adicionais. Até que esses dados sejam publicados, a análise permanece vinculada às informações confirmadas e distingue claramente fato, contexto e expectativa atribuída às fontes consultadas." },
  ];
  const conclusion = "A expansão anunciada adiciona um novo elemento ao planejamento das cadeias do agronegócio no Centro-Oeste. O acompanhamento responsável depende de atualizações sobre cronograma e operação, além de dados que confirmem os efeitos sobre transporte e armazenagem. Segundo a fonte consultada, empresas relacionadas podem usar as informações confirmadas para revisar cenários internos, sem tratar estimativas ainda não publicadas como resultados realizados.";
  return {
    blog: {
      title: NEWS.title,
      seoTitle: "Expansão no agro amplia a demanda logística",
      slug: "expansao-agro-demanda-logistica",
      metaDescription: "Nova capacidade produtiva no agronegócio amplia desafios de armazenagem, transporte e planejamento logístico no Centro-Oeste brasileiro.",
      primaryKeyword: "logística no agronegócio",
      secondaryKeywords: ["transporte de cargas", "armazenagem"],
      excerpt: "O novo investimento produtivo altera a demanda regional por armazenagem, transporte e fornecedores especializados em operações do agronegócio.",
      introduction,
      blocks,
      conclusion,
      html: buildGutenbergHtml({ introduction, blocks, conclusion }),
      category: "Agronegócio",
      tags: ["agronegócio", "logística"],
      sources: [{ name: NEWS.sourceName, url: NEWS.originalUrl }],
    },
    whatsapp: { text: "Segundo a fonte consultada, a expansão anunciada para o agronegócio no Centro-Oeste pode elevar a movimentação de insumos e produtos na região. Conforme divulgado, para as empresas do segmento, o ponto de atenção é o planejamento de armazenagem, capacidade de transporte e previsibilidade dos fluxos nos períodos de maior demanda. De acordo com o comunicado, a mudança pode pressionar prazos e exigir rotas mais coordenadas entre fornecedores, fábricas e clientes. A TransFAST acompanha esses movimentos para apoiar operações que buscam segurança e eficiência logística. Se esse cenário impacta sua empresa, podemos conversar sobre alternativas para preparar a operação." },
  };
}
