function numberValue(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getAiConfig() {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() ?? "";
  const defaultBaseUrl = provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1";
  return {
    provider,
    apiKey: (provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.AI_API_KEY)?.trim() ?? "",
    model: process.env.AI_MODEL?.trim() ?? "",
    baseUrl: (process.env.AI_BASE_URL?.trim() || defaultBaseUrl).replace(/\/+$/, ""),
    timeoutMs: numberValue(process.env.AI_TIMEOUT_MS, 42_000),
    maxRetries: Math.min(3, Math.max(0, numberValue(process.env.AI_MAX_RETRIES, 0))),
    dailyCostLimitUsd: Math.max(0, numberValue(process.env.AI_DAILY_LIMIT_USD, 5)),
    dailyRequestLimit: Math.max(1, numberValue(process.env.AI_DAILY_REQUEST_LIMIT, 100)),
    inputCostPerMillion: Math.max(0, numberValue(process.env.AI_INPUT_COST_PER_1M, 0)),
    outputCostPerMillion: Math.max(0, numberValue(process.env.AI_OUTPUT_COST_PER_1M, 0)),
  };
}

export function getWordPressConfig() {
  return {
    baseUrl: (process.env.WORDPRESS_BASE_URL?.trim() ?? "").replace(/\/+$/, ""),
    username: process.env.WORDPRESS_USERNAME?.trim() ?? "",
    password: process.env.WORDPRESS_APPLICATION_PASSWORD?.trim() ?? "",
  };
}

export function getCronSecret() {
  return process.env.CRON_SECRET ?? "";
}
