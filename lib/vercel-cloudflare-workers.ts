type D1Value = string | number | boolean | null;

type D1Meta = {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
};

type D1QueryResult<T = Record<string, unknown>> = {
  success?: boolean;
  results?: T[];
  meta?: D1Meta;
};

type D1ApiResponse<T = Record<string, unknown>> = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: Array<D1QueryResult<T>>;
};

class RemoteD1Statement {
  constructor(
    private readonly database: RemoteD1Database,
    readonly sql: string,
    readonly params: D1Value[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new RemoteD1Statement(
      this.database,
      this.sql,
      values.map(normalizeValue),
    );
  }

  async all<T = Record<string, unknown>>() {
    const result = await this.database.query<T>(this.sql, this.params);
    return {
      success: result.success ?? true,
      results: result.results ?? [],
      meta: result.meta ?? {},
    };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.all<Record<string, unknown>>();
    const row = result.results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run() {
    const result = await this.database.query(this.sql, this.params);
    return {
      success: result.success ?? true,
      results: result.results ?? [],
      meta: result.meta ?? {},
    };
  }
}

class RemoteD1Database {
  private readonly endpoint: string;

  constructor(
    accountId: string,
    databaseId: string,
    private readonly apiToken: string,
  ) {
    this.endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  }

  prepare(sql: string) {
    return new RemoteD1Statement(this, sql);
  }

  async batch(statements: RemoteD1Statement[]) {
    return this.request({
      batch: statements.map((statement) => ({
        sql: statement.sql,
        params: statement.params,
      })),
    });
  }

  async query<T = Record<string, unknown>>(sql: string, params: D1Value[]) {
    const [result] = await this.request<T>({ sql, params });
    if (!result) throw new Error("O D1 não retornou o resultado da consulta.");
    return result;
  }

  private async request<T = Record<string, unknown>>(body: unknown) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json()) as D1ApiResponse<T>;
    const failedQuery = payload.result?.find((result) => result.success === false);
    if (!response.ok || payload.success === false || failedQuery) {
      const detail = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
      throw new Error(detail || `Falha ao consultar o D1 (${response.status}).`);
    }
    return payload.result ?? [];
  }
}

function normalizeValue(value: unknown): D1Value {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function createDatabase() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  return accountId && databaseId && apiToken
    ? new RemoteD1Database(accountId, databaseId, apiToken)
    : undefined;
}

export const env = {
  DB: createDatabase(),
  WORDPRESS_BASE_URL: process.env.WORDPRESS_BASE_URL,
  WORDPRESS_USERNAME: process.env.WORDPRESS_USERNAME,
  WORDPRESS_APPLICATION_PASSWORD: process.env.WORDPRESS_APPLICATION_PASSWORD,
  CRON_SECRET: process.env.CRON_SECRET,
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
  AI_MAX_RETRIES: process.env.AI_MAX_RETRIES,
  AI_DAILY_LIMIT_USD: process.env.AI_DAILY_LIMIT_USD,
  AI_DAILY_REQUEST_LIMIT: process.env.AI_DAILY_REQUEST_LIMIT,
  AI_INPUT_COST_PER_1M: process.env.AI_INPUT_COST_PER_1M,
  AI_OUTPUT_COST_PER_1M: process.env.AI_OUTPUT_COST_PER_1M,
};
