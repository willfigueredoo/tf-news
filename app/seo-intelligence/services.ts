import type { SeoApiAction, SeoIntelligenceSnapshot } from "./types.ts";

export interface SeoIntelligenceService {
  loadSnapshot(): Promise<SeoIntelligenceSnapshot>;
  execute<T = Record<string, unknown>>(action: SeoApiAction): Promise<T>;
}

export const seoIntelligenceService: SeoIntelligenceService = {
  async loadSnapshot() {
    const response = await fetch("/api/seo-intelligence", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return parseResponse<SeoIntelligenceSnapshot>(response);
  },

  async execute<T>(action: SeoApiAction) {
    const response = await fetch("/api/seo-intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(action),
    });
    return parseResponse<T>(response);
  },
};

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(payload.error || `A Inteligência SEO não respondeu corretamente (HTTP ${response.status}).`);
  }
  return payload;
}
