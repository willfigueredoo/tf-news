import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL não foi configurada.");

const expectedTables = [
  "ai_usage_logs",
  "articles",
  "editorial_briefs",
  "editorial_kit_sources",
  "editorial_kits",
  "editorial_queue",
  "editorial_sources",
  "job_locks",
  "job_logs",
  "news_items",
  "news_item_history",
  "sources",
  "strategic_accounts",
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
  const [{ editorial_sources: editorialSources }] = await sql`select count(*)::int as editorial_sources from editorial_sources`;
  const [editorialSourceMetrics] = await sql`
    select
      count(*) filter (where active_for_collection = true)::int as active,
      count(*) filter (where monitoring_mode = 'reference')::int as reference,
      count(*) filter (where paywall <> 'none')::int as paywall,
      count(*) filter (where requires_cross_check = true)::int as requires_cross_check
    from editorial_sources
  `;
  const duplicateEditorialKeys = await sql`
    select source_key, count(*)::int as occurrences
    from editorial_sources group by source_key having count(*) > 1
  `;
  const duplicateOperationalFeeds = await sql`
    select feed_url, count(*)::int as occurrences
    from sources group by feed_url having count(*) > 1
  `;
  if (duplicateEditorialKeys.length || duplicateOperationalFeeds.length) throw new Error("Foram encontradas fontes duplicadas após o seed.");
  const editorialKitIndexes = await sql`
    select indexname
    from pg_indexes
    where schemaname = 'public' and tablename = 'editorial_kits'
    order by indexname
  `;
  const editorialKitForeignKeys = await sql`
    select constraint_name, delete_rule, update_rule
    from information_schema.referential_constraints
    where constraint_schema = 'public'
      and constraint_name = 'editorial_kits_news_item_id_news_items_id_fk'
  `;
  const editorialQueueIndexes = await sql`
    select indexname
    from pg_indexes
    where schemaname = 'public' and tablename = 'editorial_queue'
    order by indexname
  `;
  const editorialQueueForeignKeys = await sql`
    select tc.constraint_name, rc.delete_rule, rc.update_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_schema = tc.constraint_schema and rc.constraint_name = tc.constraint_name
    where tc.constraint_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
      and tc.table_name = 'editorial_queue'
    order by tc.constraint_name
  `;
  const governanceIndexes = await sql`
    select tablename, indexname
    from pg_indexes
    where schemaname = 'public' and tablename = any(${["editorial_sources", "editorial_kit_sources", "strategic_accounts"]})
    order by tablename, indexname
  `;
  const governanceForeignKeys = await sql`
    select tc.table_name, tc.constraint_name, rc.delete_rule, rc.update_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_schema = tc.constraint_schema and rc.constraint_name = tc.constraint_name
    where tc.constraint_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
      and tc.table_name = any(${["editorial_sources", "editorial_kit_sources"]})
    order by tc.table_name, tc.constraint_name
  `;

  console.log(JSON.stringify({
    tables: created,
    indexes,
    foreignKeys,
    sources,
    editorialSources,
    editorialSourceMetrics,
    duplicates: { editorialKeys: duplicateEditorialKeys.length, operationalFeeds: duplicateOperationalFeeds.length },
    editorialGovernance: {
      indexes: governanceIndexes,
      foreignKeys: governanceForeignKeys,
    },
    editorialKits: {
      indexes: editorialKitIndexes.map((row) => row.indexname),
      foreignKeys: editorialKitForeignKeys,
    },
    editorialQueue: {
      indexes: editorialQueueIndexes.map((row) => row.indexname),
      foreignKeys: editorialQueueForeignKeys,
    },
  }, null, 2));
} finally {
  await sql.end();
}
