import { SEO_INTELLIGENCE_MOCK } from "./mocks.ts";
import type { SeoIntelligenceSnapshot } from "./types.ts";

export interface SeoIntelligenceService {
  loadSnapshot(): Promise<SeoIntelligenceSnapshot>;
}

export const mockSeoIntelligenceService: SeoIntelligenceService = {
  async loadSnapshot() {
    return structuredClone(SEO_INTELLIGENCE_MOCK);
  },
};
