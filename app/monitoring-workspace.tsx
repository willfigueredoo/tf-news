"use client";

import { useEffect, useMemo, useState } from "react";
import { ICP_CATALOG } from "../lib/editorial";
import { useEscapeKey } from "../lib/use-escape-key";

type News = {
  id: number; title: string; originalUrl: string; sourceId: number; sourceName: string; domain?: string; author?: string | null;
  publishedAt: string; collectedAt: string; excerpt: string; content: string; region: string;
  logisticsImpact: "low" | "medium" | "high"; relevanceScore: number; status: string; topics: string[];
  primaryIcp: string; secondaryIcps: string[]; classificationReason: string; classificationMethod: string;
  read?: boolean; readAt?: string | null; favorite?: boolean; archived?: boolean; internalNotes?: string;
  manualOverride?: boolean; collectionRunId?: string | null;
};
type Source = { id: number; name: string; active: boolean; archivedAt?: string | null };
type History = { id: number; action: string; previousValue: unknown; nextValue: unknown; createdAt: string };
type Props = {
  news: News[]; sources: Source[]; selected: Set<number>; search: string; setSearch: (value: string) => void;
  toggleNews: (id: number) => void; toggleAll: (ids: number[]) => void; refresh: () => Promise<void>;
  notify: (message: string) => void; busy: boolean; setBusy: (value: boolean) => void;
  startContent: () => void; startQueue: () => void; aiConfigured: boolean;
};

const STATUS_LABELS: Record<string, string> = { new: "Nova", analysis: "Em análise", relevant: "Relevante", selected: "Selecionada", discarded: "Descartada", archived: "Arquivada", used: "Utilizada em conteúdo" };
const IMPACT_LABELS = { low: "Baixo", medium: "Médio", high: "Alto" } as const;

export function MonitoringWorkspace(props: Props) {
  const [page, setPage] = useState(1);
  const [source, setSource] = useState(() => storedFilters().source ?? "all");
  const [impact, setImpact] = useState(() => storedFilters().impact ?? "all");
  const [topic, setTopic] = useState(() => storedFilters().topic ?? "all");
  const [region, setRegion] = useState(() => storedFilters().region ?? "all");
  const [status, setStatus] = useState(() => storedFilters().status ?? "all");
  const [read, setRead] = useState(() => storedFilters().read ?? "all");
  const [favorite, setFavorite] = useState(() => storedFilters().favorite ?? "all");
  const [archived, setArchived] = useState(() => storedFilters().archived ?? "active");
  const [minimum, setMinimum] = useState(() => storedFilters().minimum ?? "0");
  const [period, setPeriod] = useState(() => storedFilters().period ?? "3650");
  const [sort, setSort] = useState(() => storedFilters().sort ?? "recent");
  const [detail, setDetail] = useState<News | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [batchIcp, setBatchIcp] = useState("");
  const [batchTag, setBatchTag] = useState("");
  const [referenceTime] = useState(() => Date.now());

  useEscapeKey(() => setDetail(null), Boolean(detail));

  useEffect(() => {
    window.sessionStorage.setItem("tf-news-monitoring-filters", JSON.stringify({ source, impact, topic, region, status, read, favorite, archived, minimum, period, sort }));
  }, [source, impact, topic, region, status, read, favorite, archived, minimum, period, sort]);

  const topics = useMemo(() => [...new Set(props.news.flatMap((item) => item.topics))].sort(), [props.news]);
  const regions = useMemo(() => [...new Set(props.news.map((item) => item.region))].sort(), [props.news]);
  const filtered = useMemo(() => {
    const result = props.news
      .filter((item) => source === "all" || item.sourceId === Number(source))
      .filter((item) => impact === "all" || item.logisticsImpact === impact)
      .filter((item) => topic === "all" || item.topics.includes(topic))
      .filter((item) => region === "all" || item.region === region)
      .filter((item) => status === "all" || item.status === status)
      .filter((item) => read === "all" || Boolean(item.read) === (read === "read"))
      .filter((item) => favorite === "all" || Boolean(item.favorite) === (favorite === "yes"))
      .filter((item) => archived === "all" || Boolean(item.archived) === (archived === "archived"))
      .filter((item) => item.relevanceScore >= Number(minimum))
      .filter((item) => referenceTime - new Date(item.publishedAt).getTime() <= Number(period) * 86_400_000);
    return result.sort((a, b) => sort === "relevance" ? b.relevanceScore - a.relevanceScore : sort === "impact" ? impactWeight(b.logisticsImpact) - impactWeight(a.logisticsImpact) : sort === "source" ? a.sourceName.localeCompare(b.sourceName) : sort === "collected" ? Date.parse(b.collectedAt) - Date.parse(a.collectedAt) : Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }, [props.news, source, impact, topic, region, status, read, favorite, archived, minimum, period, sort, referenceTime]);
  const pageSize = 10; const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedIds = [...props.selected].filter((id) => props.news.some((item) => item.id === id));

  async function mutate(action: string, ids: number[], extra: Record<string, unknown> = {}) {
    if (!ids.length) return;
    props.setBusy(true);
    try {
      const response = await fetch("/api/news", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, newsIds: ids, ...extra }) });
      const data = await response.json() as { error?: string; updated?: number };
      if (!response.ok) throw new Error(data.error ?? "A ação não pôde ser concluída.");
      props.notify(`${data.updated ?? ids.length} notícia(s) atualizada(s).`);
      await props.refresh();
      if (detail && ids.includes(detail.id)) await openDetail(detail.id);
    } catch (error) { props.notify(error instanceof Error ? error.message : "Falha ao atualizar notícias."); }
    finally { props.setBusy(false); }
  }

  async function openDetail(id: number) {
    try {
      const response = await fetch(`/api/news?id=${id}`); const data = await response.json() as { newsItem?: News; history?: History[]; error?: string };
      if (!response.ok || !data.newsItem) throw new Error(data.error ?? "Detalhe indisponível.");
      setDetail(data.newsItem); setHistory(data.history ?? []); setNote(data.newsItem.internalNotes ?? "");
    } catch (error) { props.notify(error instanceof Error ? error.message : "Falha ao abrir notícia."); }
  }

  function clearFilters() {
    props.setSearch(""); setSource("all"); setImpact("all"); setTopic("all"); setRegion("all"); setStatus("all");
    setRead("all"); setFavorite("all"); setArchived("active"); setMinimum("0"); setPeriod("3650"); setSort("recent");
  }

  const exportHref = `/api/news?format=csv&includeArchived=true&includeDiscarded=true${selectedIds.length ? `&ids=${selectedIds.join(",")}` : ""}`;
  return <>
    <div className="section-head"><div><div className="eyebrow">Curadoria de mercado</div><h1>Monitoramento</h1><p className="subtitle">Notícias reais persistidas, com classificação determinística e ações editoriais.</p></div><div className="inline-actions"><a className="secondary" href={exportHref}>Exportar CSV</a></div></div>
    <div className="card toolbar operational-toolbar">
      <input className="search" value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Título, resumo, empresa, tema, domínio ou URL…" aria-label="Buscar notícias" />
      <select className="filter" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">Todas as fontes</option>{props.sources.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <select className="filter" value={impact} onChange={(event) => setImpact(event.target.value)}><option value="all">Todos os impactos</option><option value="high">Impacto alto</option><option value="medium">Impacto médio</option><option value="low">Impacto baixo</option></select>
      <select className="filter" value={topic} onChange={(event) => setTopic(event.target.value)}><option value="all">Todos os temas</option>{topics.map((item) => <option key={item}>{item}</option>)}</select>
      <select className="filter" value={region} onChange={(event) => setRegion(event.target.value)}><option value="all">Todas as regiões</option>{regions.map((item) => <option key={item}>{item}</option>)}</select>
      <select className="filter" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos os status</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <select className="filter" value={read} onChange={(event) => setRead(event.target.value)}><option value="all">Lidas e não lidas</option><option value="read">Lidas</option><option value="unread">Não lidas</option></select>
      <select className="filter" value={favorite} onChange={(event) => setFavorite(event.target.value)}><option value="all">Todas</option><option value="yes">Favoritas</option><option value="no">Não favoritas</option></select>
      <select className="filter" value={archived} onChange={(event) => setArchived(event.target.value)}><option value="active">Não arquivadas</option><option value="archived">Arquivadas</option><option value="all">Todas</option></select>
      <select className="filter" value={minimum} onChange={(event) => setMinimum(event.target.value)}><option value="0">Toda relevância</option><option value="60">Relevância 60+</option><option value="80">Relevância 80+</option></select>
      <select className="filter" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="1">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="3650">Todo o período</option></select>
      <select className="filter" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Mais recentes</option><option value="relevance">Maior relevância</option><option value="impact">Maior impacto</option><option value="source">Fonte</option><option value="collected">Data de coleta</option></select>
      <button className="ghost" onClick={clearFilters}>Limpar filtros</button>
    </div>
    <div className="result-summary"><strong>{filtered.length}</strong> resultado(s) · {selectedIds.length} selecionada(s)</div>
    {!!selectedIds.length && <div className="selection-bar"><span>{selectedIds.length} selecionada(s)</span><div className="inline-actions wrap"><button onClick={() => props.toggleAll([])}>Limpar seleção</button><button disabled={props.busy} onClick={() => void mutate("archive", selectedIds)}>Arquivar</button><button disabled={props.busy} onClick={() => void mutate("discard", selectedIds)}>Descartar</button><select className="compact-select" value={batchIcp} onChange={(event) => setBatchIcp(event.target.value)} aria-label="ICP para seleção"><option value="">Alterar ICP…</option>{ICP_CATALOG.map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select><button disabled={!batchIcp || props.busy} onClick={() => void mutate("setIcp", selectedIds, { primaryIcp: batchIcp })}>Aplicar ICP</button><input className="compact-input" value={batchTag} onChange={(event) => setBatchTag(event.target.value)} placeholder="Tag" aria-label="Tag para seleção" /><button disabled={!batchTag.trim() || props.busy} onClick={() => { void mutate("addTag", selectedIds, { tag: batchTag }); setBatchTag(""); }}>Adicionar tag</button><button className="secondary" disabled={props.busy} onClick={props.startQueue}>Adicionar à Fila Editorial</button><button className="primary" disabled={props.busy || !props.aiConfigured} onClick={() => props.aiConfigured ? props.startContent() : props.notify("A IA não está configurada.")}>Gerar Kit</button></div></div>}
    <div className="card news-table"><div className="table-head"><span /><span>Notícia</span><span>Fonte / Região</span><span>ICPs e temas</span><span>Score</span><span>Impacto</span></div>{visible.length ? visible.map((item) => <div className={`table-item ${props.selected.has(item.id) ? "selected" : ""} ${item.read ? "is-read" : ""}`} key={item.id}><input className="news-check" type="checkbox" checked={props.selected.has(item.id)} onChange={() => props.toggleNews(item.id)} aria-label={`Selecionar ${item.title}`} /><div><button className="item-title detail-trigger" onClick={() => void openDetail(item.id)}>{item.favorite ? "★ " : ""}{item.title}</button><div className="item-excerpt">{item.excerpt}</div><div className="row-actions"><button disabled={props.busy} onClick={() => void mutate(item.read ? "unread" : "read", [item.id])}>{item.read ? "Não lida" : "Lida"}</button><button disabled={props.busy} onClick={() => void mutate(item.favorite ? "unfavorite" : "favorite", [item.id])}>{item.favorite ? "Desfavoritar" : "Favoritar"}</button><a href={item.originalUrl} target="_blank" rel="noopener noreferrer">Fonte ↗</a></div></div><div><div className="source-name">{item.sourceName}</div><div className="source-meta">{item.region} · {relativeDate(item.publishedAt)}</div><span className={`status ${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span></div><div><select className="compact-select" value={item.primaryIcp} onChange={(event) => void mutate("setIcp", [item.id], { primaryIcp: event.target.value })}>{ICP_CATALOG.map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select><div className="tags">{item.topics.slice(0, 2).map((value) => <span className="tag" key={value}>{value}</span>)}</div></div><span className={`score ${item.relevanceScore >= 80 ? "priority" : ""}`}>{item.relevanceScore}</span><span className={`impact-badge ${item.logisticsImpact}`}>{IMPACT_LABELS[item.logisticsImpact]}</span></div>) : <div className="empty"><strong>Nenhuma notícia coletada ainda.</strong>Execute a primeira coleta ou ajuste os filtros.</div>}<div className="pagination"><span>Mostrando {filtered.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, filtered.length)} de {filtered.length}</span><div><button className="page-button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>←</button><span className="page-current">{safePage} / {totalPages}</span><button className="page-button" disabled={safePage === totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}>→</button></div></div></div>
    {detail && <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Detalhe da notícia"><div className="detail-head"><div><span className={`status ${detail.status}`}>{STATUS_LABELS[detail.status] ?? detail.status}</span><h2>{detail.title}</h2></div><button className="ghost" onClick={() => setDetail(null)} aria-label="Fechar detalhe">Fechar</button></div><p className="subtitle">{detail.excerpt}</p><div className="detail-meta"><span><strong>Fonte</strong>{detail.sourceName}</span><span><strong>Publicação</strong>{formatDate(detail.publishedAt)}</span><span><strong>Coleta</strong>{formatDate(detail.collectedAt)}</span><span><strong>Região</strong>{detail.region}</span><span><strong>ICP principal</strong>{detail.primaryIcp}</span><span><strong>Impacto</strong>{IMPACT_LABELS[detail.logisticsImpact]}</span></div><div className="brief-box"><strong>Justificativa determinística</strong><p>{detail.classificationReason}</p><small>{detail.classificationMethod}{detail.manualOverride ? " · ajuste manual prevalente" : ""}</small></div><div className="detail-content"><h3>Conteúdo normalizado</h3><p>{detail.content || "A fonte não disponibilizou conteúdo além do resumo."}</p></div><div className="form-grid"><div className="form-group"><label className="label">ICP secundário</label><select className="field" defaultValue="" onChange={(event) => { if (event.target.value) void mutate("addSecondaryIcp", [detail.id], { secondaryIcp: event.target.value }); }}><option value="">Adicionar…</option>{ICP_CATALOG.filter((icp) => icp.name !== detail.primaryIcp).map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select></div><div className="form-group"><label className="label">Impacto</label><select className="field" value={detail.logisticsImpact} onChange={(event) => void mutate("setImpact", [detail.id], { logisticsImpact: event.target.value })}><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option></select></div><div className="form-group"><label className="label">Relevância</label><input className="field" type="number" min="0" max="100" value={detail.relevanceScore} onChange={(event) => setDetail({ ...detail, relevanceScore: Number(event.target.value) })} onBlur={() => void mutate("setRelevance", [detail.id], { relevanceScore: detail.relevanceScore })} /></div><div className="form-group"><label className="label">Adicionar tema</label><div className="inline-actions"><input className="field" value={tag} onChange={(event) => setTag(event.target.value)} /><button className="secondary" disabled={!tag.trim()} onClick={() => { void mutate("addTag", [detail.id], { tag }); setTag(""); }}>Adicionar</button></div></div><div className="form-group full"><label className="label">Observações internas</label><textarea className="field" value={note} onChange={(event) => setNote(event.target.value)} /><button className="secondary" onClick={() => void mutate("addNote", [detail.id], { note })}>Salvar observação</button></div></div><div className="inline-actions wrap"><button onClick={() => void mutate("analysis", [detail.id])}>Em análise</button><button onClick={() => void mutate("relevant", [detail.id])}>Relevante</button><button onClick={() => void mutate("selected", [detail.id])}>Selecionada</button><button onClick={() => void mutate("archive", [detail.id])}>Arquivar</button><button onClick={() => void mutate("restore", [detail.id])}>Restaurar</button><a className="primary" href={detail.originalUrl} target="_blank" rel="noopener noreferrer">Abrir fonte original ↗</a></div><div className="history"><h3>Histórico de alterações</h3>{history.length ? history.map((entry) => <div className="history-line" key={entry.id}><strong>{entry.action}</strong><span>{formatDate(entry.createdAt)}</span></div>) : <div className="empty"><strong>Sem alterações manuais</strong>As próximas ações serão registradas aqui.</div>}</div></aside></div>}
  </>;
}

function impactWeight(value: News["logisticsImpact"]) { return value === "high" ? 3 : value === "medium" ? 2 : 1; }
function relativeDate(value: string) { const hours = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 3_600_000)); return hours < 1 ? "agora" : hours < 24 ? `há ${hours}h` : `há ${Math.round(hours / 24)}d`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function storedFilters() { if (typeof window === "undefined") return {} as Record<string, string>; try { return JSON.parse(window.sessionStorage.getItem("tf-news-monitoring-filters") ?? "{}") as Record<string, string>; } catch { return {}; } }
