import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildManusResearchPrompt,
  createManusResearchTask,
  manusResearchJsonSchema,
  manusResearchSchema,
  verifyManusWebhook,
} from "../lib/manus.ts";

const config = {
  apiKey: "test-key",
  baseUrl: "https://api.manus.ai",
  agentProfile: "lite",
  webhookPublicKey: "",
  timeoutMs: 5_000,
};

const input = {
  title: "Indústria amplia investimentos em automação logística",
  excerpt: "Empresas anunciaram projetos para integrar produção, estoque e transporte.",
  content: "A notícia apresenta dados atribuídos às empresas e ao órgão regulador.",
  sourceName: "Fonte Industrial",
  originalUrl: "https://example.com/noticia",
  publishedAt: "2026-09-28T10:00:00.000Z",
  topics: ["indústria", "tecnologia", "logística"],
  primaryIcp: "Máquinas e Equipamentos Pesados",
};

test("Manus cria tarefa assíncrona privada com structured output compatível", async () => {
  let request;
  const task = await createManusResearchTask(config, input, {
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(String(options.body)) };
      return Response.json({ request_id: "req-1", task: { id: "task-1", task_url: "https://manus.im/app/task-1" } });
    },
  });
  assert.equal(task.taskId, "task-1");
  assert.equal(request.url, "https://api.manus.ai/v2/task.create");
  assert.equal(request.options.headers["x-manus-api-key"], "test-key");
  assert.equal(request.body.interactive_mode, false);
  assert.equal(request.body.hide_in_task_list, true);
  assert.equal(request.body.share_visibility, "private");
  assert.equal(request.body.agent_profile, "lite");
  assert.deepEqual(request.body.structured_output_schema, manusResearchJsonSchema);
});

test("schema enviado ao Manus não contém palavras-chave incompatíveis", () => {
  const serialized = JSON.stringify(manusResearchJsonSchema);
  assert.doesNotMatch(serialized, /"(?:minLength|maxLength|minItems|maxItems|uniqueItems|pattern|format|minimum|maximum|oneOf|allOf|not)"/);
  const prompt = buildManusResearchPrompt(input);
  assert.match(prompt, /Não escreva o conteúdo final/i);
  assert.match(prompt, /Não invente fatos/i);
});

test("resultado de pesquisa exige fatos atribuídos e URLs rastreáveis", () => {
  const valid = {
    summary: "A automação industrial está sendo adotada para integrar produção e logística, conforme as fontes consultadas e os anúncios atribuídos.",
    verifiedFacts: [{ fact: "A empresa anunciou a implantação de uma nova plataforma de visibilidade operacional.", attribution: "Empresa citada", sourceUrl: "https://example.com/fato" }],
    industrialContext: "O investimento se insere no movimento de digitalização da cadeia industrial e depende de cronogramas divulgados pelas organizações envolvidas.",
    operationalImpacts: ["A integração pode ampliar a visibilidade sobre estoques e transporte conforme o projeto anunciado."],
    executiveAngles: ["Como dados compartilhados conectam decisões de produção, fornecedores e logística."],
    uncertainties: ["O prazo final ainda depende de confirmação pela empresa."],
    consultedSources: [{ name: "Fonte Industrial", url: "https://example.com/fato", type: "imprensa especializada" }],
  };
  assert.equal(manusResearchSchema.safeParse(valid).success, true);
  assert.equal(manusResearchSchema.safeParse({ ...valid, verifiedFacts: [{ ...valid.verifiedFacts[0], sourceUrl: "inventada" }] }).success, false);
});

test("webhook Manus valida timestamp e assinatura RSA-SHA256", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rawBody = JSON.stringify({ event_id: "event-1", event_type: "task_stopped" });
  const url = "https://tf-news-one.vercel.app/api/webhooks/manus";
  const timestamp = "1790580000";
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const signer = createSign("RSA-SHA256");
  signer.update(`${timestamp}.${url}.${digest}`);
  signer.end();
  const headers = new Headers({
    "X-Webhook-Timestamp": timestamp,
    "X-Webhook-Signature": signer.sign(privateKey, "base64"),
  });
  assert.equal(await verifyManusWebhook({ ...config, webhookPublicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }, url, rawBody, headers, { now: Number(timestamp) * 1_000 }), true);
  assert.equal(await verifyManusWebhook({ ...config, webhookPublicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }, url, `${rawBody} `, headers, { now: Number(timestamp) * 1_000 }), false);
});

test("migration Manus é estritamente aditiva e preserva notícia e ideia", async () => {
  const migration = await readFile(new URL("../drizzle/0011_great_mauler.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "reel_idea_research_jobs"/);
  assert.match(migration, /reel_idea_research_jobs_active_news_unique/);
  assert.match(migration, /FOREIGN KEY \("news_item_id"\).*"news_items"/s);
  assert.match(migration, /FOREIGN KEY \("reel_idea_id"\).*"reel_ideas"/s);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i);
});

test("integração mantém Gemini como editor final e o frontend não aguarda a pesquisa", async () => {
  const [research, ideas, route, webhook, component] = await Promise.all([
    readFile(new URL("../lib/reel-idea-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/reel-ideas.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reel-ideas/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhooks/manus/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/reel-ideas.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(research, /generateReelIdea/);
  assert.match(ideas, /runStructuredAi/);
  assert.match(ideas, /externalResearch/);
  assert.match(route, /status: 202/);
  assert.match(webhook, /verifyManusWebhook/);
  assert.doesNotMatch(webhook, /generateReelIdea|runStructuredAi/);
  assert.match(component, /setInterval/);
  assert.match(component, /Você pode continuar usando o TF News/);
});
