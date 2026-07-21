import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EditorialWorkflowConflictError,
  generateEditorialKitForNews,
  inspectEditorialConflict,
} from "../lib/editorial-workflow.ts";

const NOW = "2026-07-21T12:00:00.000Z";
const newsRow = {
  id: 77,
  title: "Investimento amplia capacidade logistica no agronegocio",
  excerpt: "Empresa anuncia nova capacidade de armazenagem e transporte para o setor.",
  content_text: "O investimento amplia capacidade, armazenagem, distribuicao, transporte e operacao regional do mercado.",
  source_name: "Reuters",
  original_url: "https://example.com/noticia-77",
  published_at: "2026-07-21T10:00:00.000Z",
  collected_at: "2026-07-21T10:05:00.000Z",
  primary_icp: "Agronegocio",
  secondary_icps: "[]",
  topics: '["logistica","investimento"]',
  region: "Brasil",
  logistics_impact: "high",
  relevance_score: 94,
  status: "new",
  reliability_score: 95,
};

test("migration da Fila Editorial e estritamente aditiva", async () => {
  const migration = await readFile(new URL("../drizzle/0005_nostalgic_the_call.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "editorial_queue"/);
  assert.match(migration, /editorial_queue_active_news_unique/);
  assert.match(migration, /FOREIGN KEY \("news_item_id"\).*"news_items"/s);
  assert.match(migration, /FOREIGN KEY \("editorial_kit_id"\).*"editorial_kits"/s);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET)\b/i);
});

test("duplicidade e interceptada antes de qualquer chamada de geracao", async () => {
  let createCalls = 0;
  const db = workflowDb({ conflict: { news_id: 77, queue_id: null, queue_status: null, queue_kit_id: null, kit_id: 15 } });
  await assert.rejects(
    generateEditorialKitForNews(db, 77, {
      config: testConfig(),
      createKit: async () => { createCalls += 1; throw new Error("nao deveria gerar"); },
    }),
    (error) => error instanceof EditorialWorkflowConflictError && error.conflict.code === "existing_kit" && error.conflict.kitId === 15,
  );
  assert.equal(createCalls, 0);
  assert.equal(db.queries.some((query) => query.includes("INSERT INTO editorial_queue")), false);
});

test("falha de geracao devolve pauta para analise sem Kit parcial", async () => {
  const db = workflowDb({ conflict: { news_id: 77, queue_id: null, queue_status: null, queue_kit_id: null, kit_id: null } });
  await assert.rejects(generateEditorialKitForNews(db, 77, {
    config: testConfig(),
    createKit: async () => { throw new Error("falha controlada"); },
  }), /falha controlada/);
  assert.ok(db.queries.some((query) => query.includes("INSERT INTO editorial_queue") && query.includes("'generating'")));
  assert.ok(db.queries.some((query) => query.includes("UPDATE editorial_queue SET status = 'analysis'")));
  assert.equal(db.queries.some((query) => query.includes("INSERT INTO editorial_kits")), false);
});

test("persistencia do Kit e conclusao da pauta compartilham uma unica instrucao atomica", async () => {
  const implementation = await readFile(new URL("../lib/editorial-kit.ts", import.meta.url), "utf8");
  assert.match(implementation, /WITH eligible_queue AS/);
  assert.match(implementation, /inserted_kit AS \(INSERT INTO editorial_kits/);
  assert.match(implementation, /inserted_source AS \(INSERT INTO editorial_kit_sources/);
  assert.match(implementation, /updated_queue AS \(UPDATE editorial_queue/);
  assert.match(implementation, /status = 'ready'/);
  assert.match(implementation, /editorial_kit_id = \(SELECT id FROM inserted_kit\)/);
});

test("conflito ativo oferece abrir pauta ou gerar a pauta existente", async () => {
  const db = workflowDb({ conflict: { news_id: 77, queue_id: 9, queue_status: "approved", queue_kit_id: null, kit_id: null } });
  const conflict = await inspectEditorialConflict(db, 77);
  assert.equal(conflict?.code, "active_queue");
  assert.deepEqual(conflict?.options, ["open_queue", "generate_existing", "cancel"]);
});

test("Monitoramento, Fila e Biblioteca usam o workflow centralizado", async () => {
  const [app, monitoring, queueRoute, kitRoute] = await Promise.all([
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/monitoring-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/editorial-queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/editorial-kits/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(app, /"Fila Editorial"/);
  assert.match(app, /WorkflowConflictModal/);
  assert.match(monitoring, /Adicionar à Fila Editorial/);
  assert.match(monitoring, /!!selectedIds\.length/);
  assert.match(queueRoute, /generateEditorialKitForNews/);
  assert.match(kitRoute, /generateEditorialKitForNews/);
  assert.doesNotMatch(kitRoute, /createEditorialKit\(/);
});

function workflowDb({ conflict }) {
  const queries = [];
  return {
    queries,
    prepare(query) {
      queries.push(query);
      return {
        bind() { return this; },
        async first() {
          if (query.includes("to_regclass('public.editorial_sources')")) return { editorial_sources: null };
          if (query.includes("SELECT n.id AS news_id")) return conflict;
          if (query.includes("FROM editorial_queue WHERE id = ?")) return { id: 91, news_item_id: 77, editorial_kit_id: null, title: newsRow.title, status: "analysis", origin: "monitoring", version: 1, requested_by: null, last_error: null, started_at: NOW, completed_at: null, archived_at: null, created_at: NOW, updated_at: NOW };
          return null;
        },
        async all() {
          if (query.includes("FROM news_items n")) return { results: [newsRow], meta: { changes: 1 } };
          return { results: [], meta: { changes: 0 } };
        },
        async run() {
          if (query.includes("INSERT INTO editorial_queue")) return { results: [{ id: 91 }], meta: { changes: 1, last_row_id: 91 } };
          return { results: [], meta: { changes: 1 } };
        },
      };
    },
  };
}

function testConfig() {
  return { provider: "gemini", apiKey: "test", model: "gemini-test", baseUrl: "https://example.test", timeoutMs: 1000, maxRetries: 0, dailyCostLimitUsd: 1, dailyRequestLimit: 1, inputCostPerMillion: 0, outputCostPerMillion: 0 };
}
