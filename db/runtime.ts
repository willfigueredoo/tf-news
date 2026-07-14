import { getSqlClient } from "./index.ts";

export type QueryMeta = {
  changes: number;
  last_row_id?: number;
};

export type QueryResult<T = Record<string, unknown>> = {
  results: T[];
  meta: QueryMeta;
};

export interface DatabaseStatement {
  bind(...values: unknown[]): DatabaseStatement;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<QueryResult>;
}

export interface Database {
  prepare(query: string): DatabaseStatement;
  batch(statements: DatabaseStatement[]): Promise<QueryResult[]>;
}

type SqlExecutor = {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<Array<Record<string, unknown>> & { count?: number }>;
};

function normalizeValue(value: unknown) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function toPostgresPlaceholders(query: string) {
  let parameter = 0;
  let quote: "'" | '"' | null = null;
  let result = "";

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    if (quote) {
      result += character;
      if (character === quote) {
        if (query[index + 1] === quote) {
          result += query[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      result += character;
    } else if (character === "?") {
      parameter += 1;
      result += `$${parameter}`;
    } else {
      result += character;
    }
  }

  return result;
}

class PostgresStatement implements DatabaseStatement {
  private values: unknown[] = [];
  private readonly database: PostgresDatabase;
  private readonly query: string;

  constructor(database: PostgresDatabase, query: string) {
    this.database = database;
    this.query = query;
  }

  bind(...values: unknown[]) {
    this.values = values.map(normalizeValue);
    return this;
  }

  private async execute(executor: SqlExecutor) {
    return executor.unsafe(toPostgresPlaceholders(this.query), this.values);
  }

  private meta(rows: Array<Record<string, unknown>> & { count?: number }): QueryMeta {
    const firstId = rows[0]?.id;
    return {
      changes: typeof rows.count === "number" ? rows.count : rows.length,
      ...(typeof firstId === "number" ? { last_row_id: firstId } : {}),
    };
  }

  async all<T = Record<string, unknown>>() {
    const rows = await this.execute(this.database.sql);
    return { results: Array.from(rows) as T[], meta: this.meta(rows) };
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const rows = await this.execute(this.database.sql);
    const row = rows[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run() {
    const rows = await this.execute(this.database.sql);
    return { results: Array.from(rows), meta: this.meta(rows) };
  }

  async runWith(executor: SqlExecutor) {
    const rows = await this.execute(executor);
    return { results: Array.from(rows), meta: this.meta(rows) };
  }
}

class PostgresDatabase implements Database {
  readonly sql: ReturnType<typeof getSqlClient>;

  constructor(sql: ReturnType<typeof getSqlClient>) {
    this.sql = sql;
  }

  prepare(query: string) {
    return new PostgresStatement(this, query);
  }

  async batch(statements: DatabaseStatement[]) {
    return this.sql.begin(async (transaction) => {
      const results: QueryResult[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresStatement)) {
          throw new Error("Statement incompatível com o adaptador PostgreSQL.");
        }
        results.push(await statement.runWith(transaction));
      }
      return results;
    });
  }
}

let database: PostgresDatabase | null = null;

export async function getRuntimeDb(): Promise<Database> {
  database ??= new PostgresDatabase(getSqlClient());
  return database;
}

export function rowsOf<T>(result: { results?: T[] }) {
  return result.results ?? [];
}
