declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    WORDPRESS_BASE_URL?: string;
    WORDPRESS_USERNAME?: string;
    WORDPRESS_APPLICATION_PASSWORD?: string;
    CRON_SECRET?: string;
  }
}

