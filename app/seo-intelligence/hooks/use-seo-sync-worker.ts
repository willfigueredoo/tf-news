"use client";

import { useEffect } from "react";

type ActiveJob = { id: number; status: string };

export function useSeoSyncWorker() {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let running = false;

    const schedule = (delay: number) => {
      if (!cancelled) timer = window.setTimeout(() => void tick(), delay);
    };
    const tick = async () => {
      if (cancelled || running || document.visibilityState === "hidden") {
        schedule(5_000);
        return;
      }
      running = true;
      try {
        const response = await fetch("/api/seo-sync-jobs", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) {
          schedule(8_000);
          return;
        }
        const payload = await response.json() as { jobs?: ActiveJob[] };
        const job = payload.jobs?.[0];
        if (!job) {
          schedule(10_000);
          return;
        }
        await fetch("/api/seo-sync-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ jobId: job.id }),
        });
        schedule(500);
      } catch {
        schedule(8_000);
      } finally {
        running = false;
      }
    };

    const resume = () => {
      window.clearTimeout(timer);
      schedule(100);
    };
    document.addEventListener("visibilitychange", resume);
    schedule(1_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
}
