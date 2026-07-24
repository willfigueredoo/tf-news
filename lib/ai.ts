import { z, type ZodType } from "zod";
import type { Database } from "../db/runtime.ts";

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

type AiDb = Pick<Database, "prepare">;
type FetchLike = typeof fetch;
export type AiPhase = "request_start" | "provider_response" | "retry_wait" | "zod_validation_start" | "zod_validation_end" | "normalization_start" | "normalization_end" | "zod_final_validation_start" | "zod_final_validation_end" | "persistence_start" | "persistence_end";
export type AiPhaseLog = { phase: AiPhase; operation: string; provider: string; model: string; elapsedMs: number; attempt?: number; delayMs?: number; status?: "success" | "failed" };
export type AiPhaseLogger = (entry: AiPhaseLog) => void;
type RetryPolicy = "default" | "high-demand";
type ProviderPayload = {
  id?: string;
  responseId?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { code?: number; message?: string; status?: string; details?: unknown[] };
};

export class AiProviderRequestError extends Error {
  readonly httpStatus: number;
  readonly providerCode: number | null;
  readonly providerStatus: string | null;
  readonly details: unknown[];

  constructor(
    message: string,
    httpStatus: number,
    providerCode: number | null,
    providerStatus: string | null,
    details: unknown[],
  ) {
    super(message);
    this.name = "AiProviderRequestError";
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.providerStatus = providerStatus;
    this.details = details;
  }
}

export function aiConfigured(config: AiConfig) {
  return ["openai", "gemini"].includes(config.provider) && Boolean(config.apiKey && config.model);
}

export async function runStructuredAi<T>(options: {
  db: AiDb;
  config: AiConfig;
  operation:
    | "classification"
    | "coherence"
    | "brief"
    | "article"
    | "editorial-kit"
    | "seo_authority_summary"
    | "seo_competitor_analysis"
    | "seo_opportunity_ranking"
    | "seo_topic_classification";
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  user: string;
  maxOutputTokens?: number;
  fetchImpl?: FetchLike;
  phaseLogger?: AiPhaseLogger;
  retryPolicy?: RetryPolicy;
  retryDelaysMs?: number[];
  delayImpl?: (ms: number) => Promise<void>;
  diagnosticContext?: Record<string, string | number | boolean | null>;
}): Promise<{ data: T; usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }; requestId: string | null }> {
  const { db, config, operation, schemaName, schema, system, user } = options;
  if (!aiConfigured(config)) throw new Error("A integração de IA ainda não está configurada.");
  await assertDailyLimit(db, config);

  const fetchImpl = options.fetchImpl ?? fetch;
  const phaseLogger = options.phaseLogger ?? logAiPhase;
  const retryPolicy = options.retryPolicy ?? "default";
  const delayImpl = options.delayImpl ?? delay;
  const started = Date.now();
  let lastError = "Falha desconhecida na IA.";
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const jsonSchema = normalizeProviderSchema(z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>);
      delete jsonSchema.$schema;
      phaseLogger({ phase: "request_start", operation, provider: config.provider, model: config.model, elapsedMs: Date.now() - started, attempt: attempt + 1 });
      const remainingTimeoutMs = Math.max(1, config.timeoutMs - (Date.now() - started));
      const response = await requestProvider(fetchImpl, { ...config, timeoutMs: remainingTimeoutMs }, { schemaName, jsonSchema, system, user, maxOutputTokens: options.maxOutputTokens ?? 1800 });
      phaseLogger({ phase: "provider_response", operation, provider: config.provider, model: config.model, elapsedMs: Date.now() - started, attempt: attempt + 1 });
      const payload = await safeJson(response);
      if (!response.ok) {
        lastError = payload.error?.message || `A IA respondeu com status ${response.status}.`;
        logProviderError({
          operation,
          provider: config.provider,
          model: config.model,
          attempt: attempt + 1,
          httpStatus: response.status,
          error: payload.error,
          schemaName,
          jsonSchema,
          systemLength: system.length,
          userLength: user.length,
          maxOutputTokens: options.maxOutputTokens ?? 1800,
          diagnosticContext: options.diagnosticContext,
        });
        const retryDelay = responseRetryDelay(retryPolicy, response.status, lastError, attempt, config.maxRetries, options.retryDelaysMs);
        if (retryDelay !== null && (Date.now() - started) + retryDelay < config.timeoutMs) {
          phaseLogger({ phase: "retry_wait", operation, provider: config.provider, model: config.model, elapsedMs: Date.now() - started, attempt: attempt + 1, delayMs: retryDelay });
          await delayImpl(retryDelay);
          continue;
        }
        throw new AiProviderRequestError(
          lastError,
          response.status,
          payload.error?.code ?? null,
          payload.error?.status ?? null,
          payload.error?.details ?? [],
        );
      }
      const refusal = payload.output?.flatMap((item) => item.content ?? []).find((item) => item.refusal)?.refusal;
      if (refusal) throw new Error(`A IA recusou a solicitação: ${refusal}`);
      const outputText = extractOutputText(payload, config.provider);
      if (!outputText) throw new Error("A IA não retornou conteúdo estruturado.");
      phaseLogger({ phase: "zod_validation_start", operation, provider: config.provider, model: config.model, elapsedMs: Date.now() - started, attempt: attempt + 1 });
      let data: T;
      try {
        data = schema.parse(JSON.parse(outputText));
        phaseLogger({ phase: "zod_validation_end", operation, provider: config.provider, model: config.model, elapsedMs: Date.now() - started, attempt: attempt + 1, status: "success" });
      } catch (error) {
        phaseLogger({ phase: "zod_validation_end", operation, provider: config.provider, model: config.model, elapsedMs: Date.now() - started, attempt: attempt + 1, status: "failed" });
        throw error;
      }
      const inputTokens = payload.usage?.input_tokens ?? payload.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = payload.usage?.output_tokens ?? payload.usageMetadata?.candidatesTokenCount ?? 0;
      const estimatedCostUsd = estimateCost(inputTokens, outputTokens, config);
      const requestId = payload.id ?? payload.responseId ?? response.headers.get("x-request-id");
      await logUsage(db, { operation, config, status: "success", started, inputTokens, outputTokens, estimatedCostUsd, requestId });
      return { data, usage: { inputTokens, outputTokens, estimatedCostUsd }, requestId };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Falha desconhecida na IA.";
      if (retryPolicy === "default" && attempt < config.maxRetries && /timeout|fetch|network|aborted/i.test(lastError)) {
        await delayImpl(250 * 2 ** attempt);
        continue;
      }
      await logUsage(db, { operation, config, status: "failed", started, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requestId: null, error: lastError });
      if (error instanceof AiProviderRequestError) throw error;
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

async function requestProvider(fetchImpl: FetchLike, config: AiConfig, input: { schemaName: string; jsonSchema: Record<string, unknown>; system: string; user: string; maxOutputTokens: number }) {
  if (config.provider === "gemini") {
    const model = config.model.replace(/^models\//, "");
    const thinkingConfig = /^gemini-3(?:[.-]|$)/i.test(model) ? { thinkingLevel: "minimal" } : undefined;
    return fetchWithTimeout(fetchImpl, `${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: input.jsonSchema,
          maxOutputTokens: input.maxOutputTokens,
          candidateCount: 1,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      }),
    }, config.timeoutMs);
  }
  return fetchWithTimeout(fetchImpl, `${config.baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      store: false,
      input: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
      max_output_tokens: input.maxOutputTokens,
      text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.jsonSchema } },
    }),
  }, config.timeoutMs);
}

export function logAiPhase(entry: AiPhaseLog) {
  console.info("[ai-phase]", JSON.stringify(entry));
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Timeout interno da IA após ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractOutputText(payload: ProviderPayload, provider: string) {
  if (provider === "gemini") return payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? "").join("") || undefined;
  return payload.output_text || payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
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
    // Logging operacional não deve invalidar uma resposta editorial válida.
  }
}

function estimateCost(inputTokens: number, outputTokens: number, config: AiConfig) {
  return Number((((inputTokens * config.inputCostPerMillion) + (outputTokens * config.outputCostPerMillion)) / 1_000_000).toFixed(8));
}

async function safeJson(response: Response): Promise<ProviderPayload> {
  try { return await response.json() as ProviderPayload; } catch { return {}; }
}

function retryable(status: number) { return [408, 409, 429, 500, 502, 503, 504].includes(status); }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function responseRetryDelay(policy: RetryPolicy, status: number, message: string, attempt: number, maxRetries: number, configuredDelays?: number[]) {
  if (attempt >= maxRetries) return null;
  if (policy === "high-demand") {
    if (status !== 429 && !/high demand/i.test(message)) return null;
    return configuredDelays?.[attempt] ?? [5_000, 10_000][attempt] ?? 10_000;
  }
  return retryable(status) ? 250 * 2 ** attempt : null;
}

const GEMINI_SCHEMA_KEYS = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items", "prefixItems",
  "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties", "additionalProperties", "required", "propertyOrdering",
]);
const GEMINI_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);

export function normalizeProviderSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return normalizeSchemaNode(value as Record<string, unknown>);
}

function normalizeSchemaNode(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const schemaType = value.type;

  for (const [key, nested] of Object.entries(value)) {
    if (key === "const") {
      if (!("enum" in value)) result.enum = [nested];
      continue;
    }
    if (key === "exclusiveMinimum") {
      if (schemaType === "integer" && typeof nested === "number") result.minimum = Math.floor(nested) + 1;
      continue;
    }
    if (key === "exclusiveMaximum") {
      if (schemaType === "integer" && typeof nested === "number") result.maximum = Math.ceil(nested) - 1;
      continue;
    }
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "format" && !GEMINI_FORMATS.has(String(nested))) continue;
    if (key === "properties" || key === "$defs") {
      result[key] = Object.fromEntries(Object.entries(nested as Record<string, unknown>).map(([name, child]) => [name, normalizeSchemaNode(child as Record<string, unknown>)]));
      continue;
    }
    if (key === "items" || key === "additionalProperties") {
      result[key] = typeof nested === "object" && nested !== null ? normalizeSchemaNode(nested as Record<string, unknown>) : nested;
      continue;
    }
    if (key === "prefixItems" || key === "anyOf" || key === "oneOf") {
      result[key] = Array.isArray(nested) ? nested.map((child) => normalizeSchemaNode(child as Record<string, unknown>)) : nested;
      continue;
    }
    result[key] = nested;
  }
  return result;
}

function logProviderError(input: {
  operation: string;
  provider: string;
  model: string;
  attempt: number;
  httpStatus: number;
  error?: ProviderPayload["error"];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  systemLength: number;
  userLength: number;
  maxOutputTokens: number;
  diagnosticContext?: Record<string, string | number | boolean | null>;
}) {
  console.error("[ai-provider-error]", JSON.stringify({
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    attempt: input.attempt,
    httpStatus: input.httpStatus,
    providerError: input.error ?? null,
    request: {
      endpoint: `/models/${input.model.replace(/^models\//, "")}:generateContent`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": "[REDACTED]" },
      body: {
        systemInstruction: `[REDACTED ${input.systemLength} chars]`,
        contents: `[REDACTED ${input.userLength} chars]`,
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: input.jsonSchema,
          maxOutputTokens: input.maxOutputTokens,
          candidateCount: 1,
          thinkingConfig: /^gemini-3(?:[.-]|$)/i.test(input.model) ? { thinkingLevel: "minimal" } : undefined,
        },
      },
      schemaName: input.schemaName,
    },
    context: input.diagnosticContext ?? null,
  }));
}
