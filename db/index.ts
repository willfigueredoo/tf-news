import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";

type SqlClient = ReturnType<typeof postgres>;

const globalForDatabase = globalThis as typeof globalThis & {
  __tfNewsSql?: SqlClient;
};

export function getSqlClient() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL não foi configurada.");
  }

  if (!globalForDatabase.__tfNewsSql) {
    const requestedPoolSize = Number(process.env.DATABASE_POOL_MAX ?? 5);
    const max = Number.isFinite(requestedPoolSize)
      ? Math.min(10, Math.max(1, Math.trunc(requestedPoolSize)))
      : 5;

    globalForDatabase.__tfNewsSql = postgres(connectionString, {
      max,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
  }

  return globalForDatabase.__tfNewsSql;
}

export function getDb() {
  return drizzle(getSqlClient(), { schema });
}
