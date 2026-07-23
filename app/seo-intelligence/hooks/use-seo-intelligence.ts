"use client";

import { useCallback, useEffect, useState } from "react";
import { mockSeoIntelligenceService, type SeoIntelligenceService } from "../services.ts";
import type { SeoIntelligenceSnapshot } from "../types.ts";

export function useSeoIntelligence(service: SeoIntelligenceService = mockSeoIntelligenceService) {
  const [data, setData] = useState<SeoIntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await service.loadSnapshot());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a Inteligência SEO.");
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return { data, loading, error, reload };
}
