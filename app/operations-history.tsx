"use client";

import { useMemo, useState } from "react";

type Run = { id: number; type: string; origin: string; sourceId: number | null; sourceName: string; startedAt: string; finishedAt: string | null; durationMs: number; status: string; found: number; newItems: number; duplicates: number; ignored: number; errors: number; errorMessage: string | null; runId: string | null; details?: unknown };

export function OperationsHistory({ runs = [] }: { runs?: Array<Record<string, unknown>> }) {
  const typed = runs as unknown as Run[];
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  const sources = useMemo(() => [...new Set(typed.map((run) => run.sourceName))].sort(), [typed]);
  const visible = typed.filter((run) => status === "all" || run.status === status).filter((run) => source === "all" || run.sourceName === source);
  return <>
    <div className="panel-title"><div><h2>Histórico de coletas</h2><small>{visible.length} execução(ões)</small></div><div className="inline-actions"><select className="filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="success">Concluídas</option><option value="partial">Parciais</option><option value="failed">Falhas</option></select><select className="filter" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">Todas as fontes</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></div></div>
    {visible.length ? <div className="run-list">{visible.map((run) => <div className="run-card" key={run.id}><button className="run-summary" onClick={() => setOpen(open === run.id ? null : run.id)}><span><strong>#{run.id} · {run.sourceName}</strong><small>{run.origin === "automatic" ? "Automática" : "Manual"} · {formatDate(run.startedAt)}</small></span><span className={`status ${run.status === "success" ? "sent" : run.status === "failed" ? "error" : "review"}`}>{run.status}</span><span><strong>{run.newItems}</strong><small>novas</small></span><span><strong>{run.duplicates}</strong><small>duplicadas</small></span><span><strong>{formatDuration(run.durationMs)}</strong><small>duração</small></span></button>{open === run.id && <div className="run-details"><span><strong>Encontradas</strong>{run.found}</span><span><strong>Novas</strong>{run.newItems}</span><span><strong>Duplicadas</strong>{run.duplicates}</span><span><strong>Ignoradas</strong>{run.ignored}</span><span><strong>Erros</strong>{run.errors}</span><span><strong>Fim</strong>{run.finishedAt ? formatDate(run.finishedAt) : "Em execução"}</span>{run.errorMessage && <p className="source-error">{run.errorMessage}</p>}</div>}</div>)}</div> : <div className="empty"><strong>Nenhuma execução registrada.</strong>As coletas manuais e automáticas aparecerão aqui.</div>}
  </>;
}

function formatDuration(ms: number) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
