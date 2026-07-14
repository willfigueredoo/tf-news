import { z, type ZodType } from "zod";

export type AiConfig = {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  dailyCostLimitUsd: number;
  dailyRequestLimit: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
};

type AiDb = Pick<D1Database, "prepare">;
type FetchLike = typeof fetch;

type ResponsesPayload = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

export function aiConfigured(config: AiConfig) {
  return config.provider === "openai" && Boolean(config.apiKey && config.model);
}

export async function runStructuredAi<T>(options: {
  db: AiDb;
  config: AiConfig;
  operation: "classification" | "coherence" | "brief" | "article";
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  user: string;
  maxOutputTokens?: number;
  fetchImpl?: FetchLike;
}): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }; requestId: string | null }> {
  const { db, config, operation, schemaName, schema, system, user } = options;
  if (!aiConfigured(config)) throw new Error("A integração de IA ainda não está configurada.");
  await assertDailyLimit(db, config);

  const fetchImpl = options.fetchImpl ?? fetch;
  const started = Date.now();
  let lastError = "Falha desconhecida na IA.";
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const jsonSchema = normalizeOpenAiSchema(z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>);
      delete jsonSchema.$schema;
      const response = await fetchImpl(`${config.baseUrl}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          store: false,
          input: [{ role: "system", content: system }, { role: "user", content: user }],
          max_output_tokens: options.maxOutputTokens ?? 1800,
          text: { format: { type: "json_schema", name: schemaName, strict: true, schema: jsonSchema } },
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        lastError = payload.error?.message || `A IA respondeu com status ${response.status}.`;
        if (attempt < config.maxRetries && retryable(response.status)) {
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw new Error(lastError);
      }
      const refusal = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.refusal)?.refusal;
      if (refusal) throw new Error(`A IA recusou a solicitação: ${refusal}`);
      const outputText = payload.output_text || payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
      if (!outputText) throw new Error("A IA não retornou conteúdo estruturado.");
      const data = schema.parse(JSON.parse(outputText));
      const inputTokens = payload.usage?.input_tokens ?? 0;
      const outputTokens = payload.usage?.output_tokens ?? 0;
      const estimatedCostUsd = estimateCost(inputTokens, outputTokens, config);
      await logUsage(db, { operation, config, status: "success", started, inputTokens, outputTokens, estimatedCostUsd, requestId: payload.id ?? null });
      return { data, usage: { inputTokens, outputTokens, estimatedCostUsd }, requestId: payload.id ?? null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Falha desconhecida na IA.";
      if (attempt < config.maxRetries && /timeout|fetch|network|aborted/i.test(lastError)) {
        await delay(250 * 2 ** attempt);
        continue;
      }
      await logUsage(db, { operation, config, status: "failed", started, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requestId: null, error: lastError });
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

async function assertDailyLimit(db: AiDb, config: AiConfig) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = await db.prepare("SELECT COUNT(*) AS requests, COALESCE(SUM(estimated_cost_usd), 0) AS cost FROM ai_usage_logs WHERE status = 'success' AND created_at >= ?").bind(start.toISOString()).first<{ requests: number; cost: number }>();
  if ((row?.requests ?? 0) >= config.dailyRequestLimit) throw new Error("O limite diário de chamadas de IA foi atingido.");
  if (config.dailyCostLimitUsd > 0 && (row?.cost ?? 0) >= config.dailyCostLimitUsd) throw new Error("O limite diário de custo de IA foi atingido.");
}

async function logUsage(db: AiDb, input: { operation: string; config: AiConfig; status: string; started: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; requestId: string | null; error?: string }) {
  try {
    await db.prepare("INSERT INTO ai_usage_logs (operation, provider, model, status, input_tokens, output_tokens, estimated_cost_usd, latency_ms, request_id, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(input.operation, input.config.provider, input.config.model, input.status, input.inputTokens, input.outputTokens, input.estimatedCostUsd, Date.now() - input.started, input.requestId, input.error?.slice(0, 800) ?? null, new Date().toISOString()).run();
  } catch {
    // Operational logging must never turn a valid editorial response into a failure.
  }
}

function estimateCost(inputTokens: number, outputTokens: number, config: AiConfig) {
  return Number((((inputTokens * config.inputCostPerMillion) + (outputTokens * config.outputCostPerMillion)) / 1_000_000).toFixed(8));
}

async function safeJson(response: Response): Promise<ResponsesPayload> {
  try { return await response.json() as ResponsesPayload; } catch { return {}; }
}

function retryable(status: number) { return [408, 409, 429, 500, 502, 503, 504].includes(status); }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeOpenAiSchema(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value.map((item) => normalizeOpenAiSchema(item)) as unknown as Record<string, unknown>;
  if (!value || typeof value !== "object") return value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "minLength" || key === "maxLength") continue;
    if (key === "format" && !["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"].includes(String(nested))) continue;
    result[key] = Array.isArray(nested) ? nested.map((item) => typeof item === "object" && item !== null ? normalizeOpenAiSchema(item) : item) : typeof nested === "object" && nested !== null ? normalizeOpenAiSchema(nested) : nested;
  }
  return result;
}
