import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém a experiência principal e remove o starter", async () => {
  const [page, app, layout, css, packageJson, viteConfig, vercelConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
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
  assert.match(packageJson, /build:vercel/);
  assert.match(viteConfig, /nitro\/vite/);
  assert.match(viteConfig, /vercel-cloudflare-workers/);
  assert.match(vercelConfig, /"framework": "nitro"/);
  assert.match(vercelConfig, /npm run build:vercel/);
  assert.match(vercelConfig, /"outputDirectory": null/);
  assert.doesNotMatch(vercelConfig, /\.next/);
  assert.doesNotMatch(`${page}${app}${layout}${packageJson}`, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
