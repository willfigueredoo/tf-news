import { env } from "cloudflare:workers";

type RuntimeValues = Record<string, string | undefined>;

function runtime(): RuntimeValues {
  return env as unknown as RuntimeValues;
}

function numberValue(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getAiConfig() {
  const values = runtime();
  return {
    provider: values.AI_PROVIDER?.trim().toLowerCase() ?? "",
    apiKey: values.AI_API_KEY?.trim() ?? "",
    model: values.AI_MODEL?.trim() ?? "",
    baseUrl: (values.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    timeoutMs: numberValue(values.AI_TIMEOUT_MS, 45_000),
    maxRetries: Math.min(3, Math.max(0, numberValue(values.AI_MAX_RETRIES, 2))),
    dailyCostLimitUsd: Math.max(0, numberValue(values.AI_DAILY_LIMIT_USD, 5)),
    dailyRequestLimit: Math.max(1, numberValue(values.AI_DAILY_REQUEST_LIMIT, 100)),
    inputCostPerMillion: Math.max(0, numberValue(values.AI_INPUT_COST_PER_1M, 0)),
    outputCostPerMillion: Math.max(0, numberValue(values.AI_OUTPUT_COST_PER_1M, 0)),
  };
}

export function getWordPressConfig() {
  const values = runtime();
  return {
    baseUrl: (values.WORDPRESS_BASE_URL?.trim() ?? "").replace(/\/+$/, ""),
    username: values.WORDPRESS_USERNAME?.trim() ?? "",
    password: values.WORDPRESS_APPLICATION_PASSWORD ?? "",
  };
}

export function getCronSecret() {
  return runtime().CRON_SECRET ?? "";
}
