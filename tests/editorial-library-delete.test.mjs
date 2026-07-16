import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteEditorialKit, isEditorialDeleteAuthorized } from "../lib/editorial-kit-delete.ts";
import { editorialKitDeleteSchema } from "../lib/operational-schemas.ts";

test("exige ID válido e confirmação explícita para exclusão permanente", () => {
  assert.deepEqual(editorialKitDeleteSchema.parse({ id: 7, confirmation: "delete_permanently" }), { id: 7, confirmation: "delete_permanently" });
  assert.throws(() => editorialKitDeleteSchema.parse({ id: 7 }));
  assert.throws(() => editorialKitDeleteSchema.parse({ id: 0, confirmation: "delete_permanently" }));
  assert.throws(() => editorialKitDeleteSchema.parse({ id: 7, confirmation: "yes" }));
});

test("autoriza usuário autenticado, rejeita produção anônima e mantém localhost funcional", () => {
  const authenticated = new Request("https://tf-news.example/api/editorial-kits", { headers: { "oai-authenticated-user-email": "editor@example.com" } });
  assert.equal(isEditorialDeleteAuthorized(authenticated, "production"), true);
  assert.equal(isEditorialDeleteAuthorized(new Request("https://tf-news.example/api/editorial-kits"), "production"), false);
  assert.equal(isEditorialDeleteAuthorized(new Request("http://localhost:3000/api/editorial-kits"), "development"), true);
});

test("exclusão confirmada remove Kit e relações sem tocar notícia ou fontes", async () => {
  const fixture = deletionDatabase();
  const result = await deleteEditorialKit(fixture.db, 7);

  assert.deepEqual(result, { deleted: true, kitId: 7, newsItemId: 101, removedRelations: 2 });
  assert.equal(fixture.state.kits.has(7), false);
  assert.equal([...fixture.state.kitSources.values()].some((relation) => relation.editorialKitId === 7), false);
  assert.equal(fixture.state.newsItems.has(101), true);
  assert.equal(fixture.state.editorialSources.has(301), true);
  assert.equal(fixture.state.editorialSources.has(302), true);
  assert.equal(fixture.batchCalls(), 1);
  assert.equal(fixture.queries.some((query) => /DELETE FROM (?:news_items|editorial_sources)/i.test(query)), false);
});

test("Kit inexistente não inicia transação nem altera registros", async () => {
  const fixture = deletionDatabase();
  const before = snapshot(fixture.state);
  const result = await deleteEditorialKit(fixture.db, 999);
  assert.deepEqual(result, { deleted: false, kitId: 999, newsItemId: null, removedRelations: 0 });
  assert.deepEqual(snapshot(fixture.state), before);
  assert.equal(fixture.batchCalls(), 0);
});

test("falha transacional preserva Kit, relações, notícia e fontes sem órfãos", async () => {
  const fixture = deletionDatabase({ failTransaction: true });
  const before = snapshot(fixture.state);
  await assert.rejects(deleteEditorialKit(fixture.db, 7), /falha transacional controlada/);
  assert.deepEqual(snapshot(fixture.state), before);
  assert.equal([...fixture.state.kitSources.values()].every((relation) => fixture.state.kits.has(relation.editorialKitId)), true);
});

test("cancelamento fecha o modal sem disparar exclusão e confirmação atualiza a Biblioteca", async () => {
  const [source, route] = await Promise.all([
    readFile(new URL("../app/editorial-intelligence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/editorial-kits/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /Excluir conteúdo permanentemente\?/);
  assert.match(source, /Esta ação removerá definitivamente este Kit Editorial e seus dados relacionados\. Não será possível desfazer\./);
  assert.match(source, /<button className="secondary" disabled=\{pending\} onClick=\{onCancel\}>Cancelar<\/button>/);
  assert.match(source, /confirmation: "delete_permanently"/);
  assert.match(source, /setKits\(\(current\) => current\.filter\(\(kit\) => kit\.id !== deletedId\)\)/);
  assert.match(source, /Conteúdo excluído permanentemente\./);
  assert.match(source, /Não foi possível excluir o conteúdo\. Nenhuma alteração foi realizada\./);
  assert.match(source, /filter === "all" && !kit\.archivedAt/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /isEditorialDeleteAuthorized/);
  assert.match(route, /editorialKitDeleteSchema\.parse/);
  assert.match(route, /deleteEditorialKit\(db, input\.id\)/);
});

function deletionDatabase(options = {}) {
  const state = {
    kits: new Map([[7, { id: 7, newsItemId: 101 }]]),
    kitSources: new Map([[1, { id: 1, editorialKitId: 7, editorialSourceId: 301 }], [2, { id: 2, editorialKitId: 7, editorialSourceId: 302 }]]),
    newsItems: new Set([101]),
    editorialSources: new Set([301, 302]),
  };
  const queries = [];
  let batches = 0;

  class Statement {
    constructor(query) { this.query = query; this.values = []; queries.push(query); }
    bind(...values) { this.values = values; return this; }
    async first() {
      const kit = state.kits.get(Number(this.values[0]));
      return kit ? { id: kit.id, news_item_id: kit.newsItemId } : null;
    }
  }

  const db = {
    prepare(query) { return new Statement(query); },
    async batch(statements) {
      batches += 1;
      const before = cloneState(state);
      try {
        const relationStatement = statements[0];
        const kitId = Number(relationStatement.values[0]);
        const relationIds = [...state.kitSources.values()].filter((relation) => relation.editorialKitId === kitId).map((relation) => relation.id);
        relationIds.forEach((id) => state.kitSources.delete(id));
        if (options.failTransaction) throw new Error("falha transacional controlada");
        const existed = state.kits.delete(kitId);
        return [
          { results: relationIds.map((id) => ({ id })), meta: { changes: relationIds.length } },
          { results: existed ? [{ id: kitId }] : [], meta: { changes: existed ? 1 : 0 } },
        ];
      } catch (error) {
        restoreState(state, before);
        throw error;
      }
    },
  };

  return { db, state, queries, batchCalls: () => batches };
}

function cloneState(state) {
  return {
    kits: new Map(state.kits),
    kitSources: new Map(state.kitSources),
    newsItems: new Set(state.newsItems),
    editorialSources: new Set(state.editorialSources),
  };
}

function restoreState(state, saved) {
  state.kits = saved.kits;
  state.kitSources = saved.kitSources;
  state.newsItems = saved.newsItems;
  state.editorialSources = saved.editorialSources;
}

function snapshot(state) {
  return {
    kits: [...state.kits.entries()],
    kitSources: [...state.kitSources.entries()],
    newsItems: [...state.newsItems],
    editorialSources: [...state.editorialSources],
  };
}
