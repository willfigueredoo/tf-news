import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém a experiência principal e remove o starter", async () => {
  const [page, app, editorial, monitoring, sourceManager, history, layout, css, packageJson, viteConfig, vercelConfig, vercelOutputScript, readyRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tf-news-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/editorial-intelligence.tsx", import.meta.url), "utf8"),
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
  assert.match(app, /Visão Executiva/);
  assert.match(app, /Biblioteca/);
  assert.match(app, /Radar/);
  assert.match(app, /Insights/);
  assert.match(app, /EditorialIntelligence/);
  assert.match(editorial, /Por que esta notícia foi escolhida/);
  assert.match(editorial, /additional_confirmation_recommended/);
  assert.doesNotMatch(editorial, /CONFIRMAÇÃO OBRIGATÓRIA/);
  assert.match(editorial, /Empresas potencialmente afetadas/);
  assert.match(editorial, /Selecionando notícia/);
  assert.match(editorial, /Gerando Blog/);
  assert.match(editorial, /Salvando Biblioteca/);
  assert.match(editorial, /Favoritar/);
  assert.match(editorial, /Fixar/);
  assert.match(editorial, /Copiar HTML/);
  assert.match(editorial, /Copiar Markdown/);
  assert.match(editorial, /Artigo Gutenberg/);
  assert.match(editorial, /Copiar Introdução/);
  assert.match(editorial, /Copiar H2/);
  assert.match(editorial, /Copiar Parágrafo/);
  assert.match(editorial, /Copiar Conclusão/);
  assert.match(editorial, /Pré-visualizar/);
  assert.match(editorial, /Salvar revisão/);
  assert.match(editorial, /tf-news-library-preferences/);
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
  assert.doesNotMatch(app, /tf-news-banner-dark\.png|header-banner/);
  assert.match(app, /header-brand-name/);
  assert.match(app, /Painel Executivo/);
  assert.match(layout, /favicon\.ico/);
  assert.match(layout, /tf-news-theme/);
  assert.match(css, /--editorial-red: #d30b1a/i);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /\.library-grid/);
  assert.match(css, /\.generation-progress/);
  assert.match(css, /\.kit-preview-frame/);
  assert.match(css, /\.governance-review_recommended/);
  assert.match(css, /\.governance-additional_confirmation_recommended/);
  assert.match(css, /\.gutenberg-block/);
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
  assert.match(readyRoute, /editorial_kits/);
  assert.doesNotMatch(vercelConfig, /\.next/);
  assert.doesNotMatch(`${page}${app}${layout}${packageJson}`, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});
