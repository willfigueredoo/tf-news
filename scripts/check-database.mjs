import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL não foi configurada.");
}

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

try {
  const [{ current_database: database }] = await sql`select current_database()`;
  const marker = `db-check:${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const [created] = await sql.begin(async (transaction) => {
    const inserted = await transaction`
      insert into job_logs (job_type, status, started_at, finished_at, processed_items, metadata)
      values ('database-check', 'success', ${now}, ${now}, 1, ${marker})
      returning id
    `;
    const rows = await transaction`
      select id from job_logs where id = ${inserted.id} and metadata = ${marker}
    `;
    await transaction`delete from job_logs where id = ${inserted.id}`;
    return rows;
  });

  if (!created?.id) throw new Error("A verificação de leitura e escrita não foi concluída.");
  console.log(`PostgreSQL pronto: leitura e escrita confirmadas em ${database}.`);
} finally {
  await sql.end();
}
