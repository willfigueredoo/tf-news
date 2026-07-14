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

test("migration PostgreSQL é aditiva e não contém comandos destrutivos", async () => {
  const migration = await readFile(
    new URL("../drizzle/0000_bumpy_thunderbolt.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "sources"/);
  assert.match(migration, /ON CONFLICT \("feed_url"\) DO NOTHING/);
  assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
});
