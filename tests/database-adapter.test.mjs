import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toPostgresPlaceholders } from "../db/runtime.ts";

test("converte placeholders sem alterar sinais dentro de strings", () => {
  assert.equal(
    toPostgresPlaceholders("SELECT '?' AS literal FROM news_items WHERE id = ? AND title = ?"),
    "SELECT '?' AS literal FROM news_items WHERE id = $1 AND title = $2",
  );
});

test("migrations PostgreSQL são aditivas e não contêm comandos destrutivos", async () => {
  const migrations = await Promise.all([
    readFile(new URL("../drizzle/0000_bumpy_thunderbolt.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_brief_microbe.sql", import.meta.url), "utf8"),
  ]);
  assert.match(migrations[0], /CREATE TABLE "sources"/);
  assert.match(migrations[0], /ON CONFLICT \("feed_url"\) DO NOTHING/);
  assert.match(migrations[1], /CREATE TABLE "news_item_history"/);
  assert.match(migrations[1], /ALTER TABLE "sources" ADD COLUMN "priority"/);
  for (const migration of migrations) {
    assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE)\b/im);
  }
});
