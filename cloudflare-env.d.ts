declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    WORDPRESS_BASE_URL?: string;
    WORDPRESS_USERNAME?: string;
    WORDPRESS_APPLICATION_PASSWORD?: string;
    CRON_SECRET?: string;
    AI_PROVIDER?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
    AI_BASE_URL?: string;
    AI_TIMEOUT_MS?: string;
    AI_MAX_RETRIES?: string;
    AI_DAILY_LIMIT_USD?: string;
    AI_DAILY_REQUEST_LIMIT?: string;
    AI_INPUT_COST_PER_1M?: string;
    AI_OUTPUT_COST_PER_1M?: string;
  }
}
