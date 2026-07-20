import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("favicon oficial possui fallback e suporte para dispositivos móveis", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "public", "site.webmanifest"), "utf8"));
  const expectedAssets = [
    "favicon.svg",
    "favicon.ico",
    "apple-touch-icon.png",
    "android-chrome-192x192.png",
    "android-chrome-512x512.png",
  ];

  await Promise.all(expectedAssets.map((asset) => access(path.join(root, "public", asset))));
  assert.equal(manifest.short_name, "TF News");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);

  const layout = await readFile(path.join(root, "app", "layout.tsx"), "utf8");
  assert.match(layout, /manifest: "\/site\.webmanifest"/);
  assert.match(layout, /\/apple-touch-icon\.png/);
  assert.match(layout, /\/favicon\.svg/);
});

test("navegação de marca, tooltips e logos adaptativas permanecem acessíveis", async () => {
  const app = await readFile(path.join(root, "app", "tf-news-app.tsx"), "utf8");
  const styles = await readFile(path.join(root, "app", "globals.css"), "utf8");

  assert.match(app, /aria-label="Ir para Visão Executiva"/);
  assert.match(app, /data-tooltip=/);
  assert.match(app, /tf-news-banner-dark\.png/);
  assert.match(app, /className="sidebar-wordmark"/);
  assert.doesNotMatch(app, /header-logo-light|header-logo-dark/);
  assert.doesNotMatch(app, /sidebar-logo|className="crumb"/);
  assert.match(styles, /\.header-banner \{[^}]*height: 52px;/);
  assert.match(styles, /\.nav-button:hover::after, \.nav-button:focus-visible::after/);
});

test("ESC fecha painéis e respeita a pré-visualização do editor", async () => {
  const hook = await readFile(path.join(root, "lib", "use-escape-key.ts"), "utf8");
  const editor = await readFile(path.join(root, "app", "editorial-intelligence.tsx"), "utf8");
  const monitoring = await readFile(path.join(root, "app", "monitoring-workspace.tsx"), "utf8");

  assert.match(hook, /event\.key !== "Escape"/);
  assert.match(editor, /if \(preview\) setPreview\(false\);\s+else onClose\(\);/);
  assert.match(monitoring, /useEscapeKey\(\(\) => setDetail\(null\), Boolean\(detail\)\)/);
});
