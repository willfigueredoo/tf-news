import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém a experiência principal e remove o starter", async () => {
  const [page, app, monitoring, sourceManager, history, layout, css, packageJson, viteConfig, vercelConfig, vercelOutputScript, readyRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/monitoring-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/source-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/operations-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ensure-vercel-output.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ready/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /TFNewsApp/);
  assert.match(app, /Monitoramento/);
  assert.match(app, /Criar Conteúdo/);
  assert.match(app, /Configurações/);
  assert.doesNotMatch(app, /DEMO_NEWS|Prévia TF News/);
  assert.match(app, /Testar feed/);
  assert.match(app, /MonitoringWorkspace/);
  assert.match(app, /SourceManager/);
  assert.match(app, /OperationsHistory/);
  assert.match(monitoring, /Exportar CSV/);
  assert.match(monitoring, /Marcar lidas/);
  assert.match(monitoring, /Marcar não lidas/);
  assert.match(monitoring, /Aplicar ICP/);
  assert.match(sourceManager, /Coletar agora/);
  assert.match(sourceManager, /Importar CSV/);
  assert.match(history, /Histórico de coletas/);
  assert.match(app, /Abrir no WordPress/);
  assert.match(layout, /TF News — Inteligência editorial/);
  assert.match(app, /tf-news-icon\.png/);
  assert.match(app, /tf-news-horizontal\.png/);
  assert.match(layout, /favicon\.ico/);
  assert.match(layout, /tf-news-theme/);
  assert.match(css, /#e30613/i);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(packageJson, /build:vercel/);
  assert.match(viteConfig, /nitro\/vite/);
  assert.doesNotMatch(viteConfig, /cloudflare|wrangler/i);
  assert.match(packageJson, /postgres/);
  assert.doesNotMatch(packageJson, /db:migrate:local|@cloudflare\/vite-plugin/);
  assert.match(vercelConfig, /"framework": "nitro"/);
  assert.match(vercelConfig, /npm run build:vercel/);
  assert.match(vercelConfig, /"outputDirectory": null/);
  assert.match(vercelConfig, /api\/cron\/collect/);
  assert.match(vercelConfig, /0 11 \* \* \*/);
  assert.match(vercelOutputScript, /outputConfig\.crons/);
  assert.doesNotMatch(vercelOutputScript, /outputConfig\.crons\s*=/);
  assert.match(vercelOutputScript, /evitar duplica/);
  assert.match(readyRoute, /to_regclass/);
  assert.match(readyRoute, /schema_pending/);
  assert.match(readyRoute, /news_item_history/);
  assert.doesNotMatch(vercelConfig, /\.next/);
  assert.doesNotMatch(`${page}${app}${layout}${packageJson}`, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
