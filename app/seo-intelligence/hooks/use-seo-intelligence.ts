"use client";

import { useCallback, useEffect, useState } from "react";
import { seoIntelligenceService, type SeoIntelligenceService } from "../services.ts";
import type { SeoApiAction, SeoIntelligenceSnapshot } from "../types.ts";

export function useSeoIntelligence(service: SeoIntelligenceService = seoIntelligenceService) {
  const [data, setData] = useState<SeoIntelligenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
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

  const execute = useCallback(async <T,>(action: SeoApiAction, options: { reload?: boolean } = {}) => {
    setBusyAction(action.action);
    setError(null);
    try {
      const result = await service.execute<T>(action);
      if (options.reload !== false) setData(await service.loadSnapshot());
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "A ação de Inteligência SEO não foi concluída.";
      setError(message);
      throw cause;
    } finally {
      setBusyAction(null);
    }
  }, [service]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    const activeJob = data?.syncJobs.find((job) => ["queued", "processing", "retry"].includes(job.status));
    if (!activeJob) return;
    const timer = window.setTimeout(() => { void reload(); }, 1_500);
    return () => window.clearTimeout(timer);
  }, [data, reload]);

  return { data, loading, busyAction, error, reload, execute };
}
