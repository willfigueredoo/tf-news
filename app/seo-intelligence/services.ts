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
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown } & T;
  if (!response.ok) throw new Error(readErrorMessage(payload, response.status));
  return payload;
}

function readErrorMessage(payload: { error?: unknown; message?: unknown }, status: number) {
  for (const value of [payload.error, payload.message]) {
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object") {
      const nested = value as { message?: unknown; code?: unknown };
      if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
      if (typeof nested.code === "string" && nested.code.trim()) return nested.code;
    }
  }
  if (status === 504) return "A etapa atual excedeu o tempo do servidor e será retomada automaticamente.";
  return `A Inteligência SEO não respondeu corretamente (HTTP ${status}).`;
}
