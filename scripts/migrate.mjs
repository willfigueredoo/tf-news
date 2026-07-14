import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL não foi configurada. Nenhuma migration foi executada.");
}

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});

try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrations PostgreSQL aplicadas com sucesso.");
} finally {
  await sql.end();
}
