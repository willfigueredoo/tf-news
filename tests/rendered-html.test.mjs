import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém a experiência principal e remove o starter", async () => {
  const [page, app, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /TFNewsApp/);
  assert.match(app, /Monitoramento/);
  assert.match(app, /Criar Conteúdo/);
  assert.match(app, /Configurações/);
  assert.match(layout, /TF News — Inteligência editorial/);
  assert.match(app, /tf-news-icon\.png/);
  assert.match(app, /tf-news-horizontal\.png/);
  assert.match(layout, /favicon\.ico/);
  assert.match(layout, /tf-news-theme/);
  assert.match(css, /#e30613/i);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.doesNotMatch(`${page}${app}${layout}${packageJson}`, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
