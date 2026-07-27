"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type QueueStatus = "new" | "analysis" | "approved" | "generating" | "ready" | "published" | "archived";
export type EditorialQueueItem = {
  id: number; newsItemId: number; kitId: number | null; title: string; status: QueueStatus; origin: string; version: number;
  lastError: string | null; startedAt: string | null; completedAt: string | null; archivedAt: string | null;
  createdAt: string; updatedAt: string; sourceName?: string; primaryIcp?: string; relevanceScore?: number; publishedAt?: string;
  originType?: "monitoring" | "competitive";
  competitorArticleTitle?: string | null;
  competitorArticleUrl?: string | null;
  competitorName?: string | null;
};

const STATUS_LABELS: Record<QueueStatus, string> = {
  new: "Nova", analysis: "Em anÃ¡lise", approved: "Aprovada", generating: "Gerando Kit",
  ready: "Pronta", published: "Publicada", archived: "Arquivada",
};

export function EditorialQueue({ initialQueueId, onOpenKit, notify }: {
  initialQueueId?: number | null;
  onOpenKit: (kitId: number) => void;
  notify: (message: string) => void;
}) {
  const [items, setItems] = useState<EditorialQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [originFilter, setOriginFilter] = useState<"monitoring" | "competitive">("monitoring");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/editorial-queue?includeArchived=${filter === "archived"}`, { cache: "no-store" });
      const data = await response.json() as { queue?: EditorialQueueItem[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "NÃ£o foi possÃ­vel carregar a Fila Editorial.");
      const loaded = data.queue ?? [];
      setItems(loaded);
      const focused = initialQueueId ? loaded.find((item) => item.id === initialQueueId) : null;
      if (focused) setOriginFilter(isCompetitive(focused) ? "competitive" : "monitoring");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao carregar a Fila Editorial."); }
    finally { setLoading(false); }
  }, [filter, initialQueueId, notify]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const visible = useMemo(() => items.filter((item) => {
    const matchesStatus = filter === "archived" ? item.status === "archived" : item.status !== "archived";
    const matchesOrigin = originFilter === "competitive" ? isCompetitive(item) : !isCompetitive(item);
    return matchesStatus && matchesOrigin;
  }), [filter, items, originFilter]);
  const originCounts = useMemo(() => ({
    monitoring: items.filter((item) => !isCompetitive(item) && (filter === "archived" ? item.status === "archived" : item.status !== "archived")).length,
    competitive: items.filter((item) => isCompetitive(item) && (filter === "archived" ? item.status === "archived" : item.status !== "archived")).length,
  }), [filter, items]);

  async function transition(item: EditorialQueueItem, target: QueueStatus) {
    setBusyId(item.id);
    try {
      const response = await fetch("/api/editorial-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "transition", id: item.id, target }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "A pauta nÃ£o pÃ´de ser atualizada.");
      notify(`Pauta atualizada para ${STATUS_LABELS[target]}.`); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao atualizar a pauta."); }
    finally { setBusyId(null); }
  }

  async function generate(item: EditorialQueueItem) {
    setBusyId(item.id);
    try {
      const response = await fetch("/api/editorial-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", newsId: item.newsItemId, queueId: item.id }) });
      const data = await response.json() as { kit?: { id: number }; error?: string };
      if (!response.ok || !data.kit) throw new Error(data.error ?? "A geraÃ§Ã£o nÃ£o foi concluÃ­da.");
      notify("Kit Editorial gerado e salvo na Biblioteca."); onOpenKit(data.kit.id);
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao gerar o Kit Editorial."); await load(); }
    finally { setBusyId(null); }
  }

  return <>
    <div className="section-head">
      <div><div className="eyebrow">OrganizaÃ§Ã£o editorial</div><h1>Fila Editorial</h1><p className="subtitle">Pautas independentes entre o Monitoramento e o acervo publicado.</p></div>
      <div className="inline-actions"><button className={filter === "active" ? "secondary active" : "ghost"} onClick={() => setFilter("active")}>Ativas</button><button className={filter === "archived" ? "secondary active" : "ghost"} onClick={() => setFilter("archived")}>Arquivadas</button></div>
    </div>
    <div className="editorial-origin-tabs" role="tablist" aria-label="Origem das pautas">
      <button type="button" role="tab" aria-selected={originFilter === "monitoring"} className={originFilter === "monitoring" ? "active" : ""} onClick={() => setOriginFilter("monitoring")}><strong>Monitoramento</strong><span>NotÃ­cias e sinais editoriais</span><i>{originCounts.monitoring}</i></button>
      <button type="button" role="tab" aria-selected={originFilter === "competitive"} className={originFilter === "competitive" ? "active" : ""} onClick={() => setOriginFilter("competitive")}><strong>InteligÃªncia Competitiva</strong><span>Pautas inspiradas em concorrentes</span><i>{originCounts.competitive}</i></button>
    </div>
    {loading ? <div className="card empty"><strong>Atualizando a Fila Editorialâ€¦</strong></div> : !visible.length ? <div className="card empty"><strong>Nenhuma pauta neste estado</strong>{originFilter === "competitive" ? "Use Criar pauta inspirada em um artigo de concorrente para iniciar esta fila." : "Adicione notÃ­cias pelo Monitoramento para organizar a produÃ§Ã£o."}</div> : <div className="queue-list">
      {visible.map((item) => <article className={`card queue-item ${item.id === initialQueueId ? "highlight" : ""}`} key={item.id}>
        <div>
          <div className="content-meta">{isCompetitive(item) ? `Inspirada em ${item.competitorName ?? "concorrente"}` : item.sourceName ?? "Fonte monitorada"} Â· {item.primaryIcp ?? "ICP classificado"} Â· versÃ£o {item.version}</div>
          <h2>{item.competitorArticleTitle ?? item.title}</h2>
          {isCompetitive(item) && <div className="queue-origin-context"><span>Base factual: {item.sourceName ?? "fonte independente do Monitoramento"}</span>{item.competitorArticleUrl && <a href={item.competitorArticleUrl} target="_blank" rel="noopener noreferrer">Abrir referÃªncia â†—</a>}</div>}
          <div className="content-meta">Atualizada {formatDate(item.updatedAt)}{typeof item.relevanceScore === "number" ? ` Â· score ${item.relevanceScore}` : ""}</div>
          {item.lastError && <div className="notice">{item.lastError}</div>}
        </div>
        <span className={`status queue-${item.status}`}>{STATUS_LABELS[item.status]}</span>
        <div className="inline-actions wrap">
          {(item.status === "new" || item.status === "analysis") && <button className="ghost" disabled={busyId === item.id} onClick={() => void transition(item, "approved")}>Aprovar</button>}
          {(["new", "analysis", "approved"] as QueueStatus[]).includes(item.status) && <button className="primary" disabled={busyId !== null} onClick={() => void generate(item)}>{busyId === item.id ? "Gerandoâ€¦" : "Gerar Kit"}</button>}
          {item.kitId && <button className="secondary" onClick={() => onOpenKit(item.kitId!)}>Abrir Kit</button>}
          {item.status !== "archived" && item.status !== "generating" && <button className="ghost danger-text" disabled={busyId === item.id} onClick={() => void transition(item, "archived")}>Arquivar</button>}
        </div>
      </article>)}
    </div>}
  </>;
}

function isCompetitive(item: EditorialQueueItem) {
  return item.originType === "competitive" || item.origin.startsWith("seo_competitor_article:");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
