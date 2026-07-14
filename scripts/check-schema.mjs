import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL não foi configurada.");

const expectedTables = [
  "ai_usage_logs",
  "articles",
  "editorial_briefs",
  "job_locks",
  "job_logs",
  "news_items",
  "news_item_history",
  "sources",
  "wordpress_publications",
];
const sql = postgres(connectionString, { max: 1, prepare: false, connect_timeout: 10 });

try {
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_name = any(${expectedTables})
    order by table_name
  `;
  const created = tables.map((row) => row.table_name);
  const missing = expectedTables.filter((table) => !created.includes(table));
  if (missing.length) throw new Error(`Tabelas ausentes: ${missing.join(", ")}`);

  const [{ indexes }] = await sql`
    select count(*)::int as indexes from pg_indexes
    where schemaname = 'public' and tablename = any(${expectedTables})
  `;
  const [{ foreign_keys: foreignKeys }] = await sql`
    select count(*)::int as foreign_keys
    from information_schema.table_constraints
    where constraint_schema = 'public' and constraint_type = 'FOREIGN KEY'
      and table_name = any(${expectedTables})
  `;
  const [{ sources }] = await sql`select count(*)::int as sources from sources`;

  console.log(JSON.stringify({ tables: created, indexes, foreignKeys, sources }, null, 2));
} finally {
  await sql.end();
}
