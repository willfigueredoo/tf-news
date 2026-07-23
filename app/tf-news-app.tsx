"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ICP_CATALOG } from "../lib/editorial";
import { useEscapeKey } from "../lib/use-escape-key";
import { EditorialIntelligence } from "./editorial-intelligence";
import { EditorialQueue } from "./editorial-queue";
import { ExecutiveDashboard } from "./executive-dashboard";
import { MonitoringWorkspace } from "./monitoring-workspace";
import { OperationsHistory } from "./operations-history";
import { SeoIntelligence } from "./seo-intelligence/seo-intelligence";
import { SourceManager } from "./source-manager";

type View = "Visão Executiva" | "Monitoramento" | "Fila Editorial" | "Biblioteca" | "Inteligência SEO" | "Radar" | "Insights" | "Configurações" | "Criar Conteúdo" | "Conteúdos";
type WorkflowConflict = { code: string; newsId: number; queueId: number | null; queueStatus: string | null; kitId: number | null; options: string[] };
type News = { id: number; title: string; originalUrl: string; sourceId: number; sourceName: string; domain?: string; author?: string | null; publishedAt: string; collectedAt: string; excerpt: string; content: string; region: string; logisticsImpact: "low" | "medium" | "high"; relevanceScore: number; status: string; topics: string[]; icps: string[]; primaryIcp: string; secondaryIcps: string[]; classificationReason: string; classificationMethod: string; read?: boolean; readAt?: string | null; favorite?: boolean; archived?: boolean; archivedAt?: string | null; internalNotes?: string; manualOverride?: boolean; collectionRunId?: string | null };
type Source = { id: number; name: string; domain: string; feedUrl: string; websiteUrl: string | null; type?: string; status?: string; reliabilityScore: number; active: boolean; health?: string; priority?: number; collectionFrequencyMinutes?: number; language?: string; country?: string; region?: string; relatedIcps?: string[]; notes?: string; lastCollectedAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; lastStatus: string; lastDurationMs: number | null; lastHttpStatus: number | null; lastItemCount: number; consecutiveFailures: number; nextCollectionAt?: string | null; archivedAt?: string | null; totalNewsCollected?: number; averageResponseMs?: number };
type Brief = { id: number; title: string; summary: string; mainEvent: string; primaryIcp: string; secondaryIcps: string[]; topics: string[]; regions: string[]; importance: string; opportunity: string; logisticsImpact: string; suggestedTitle: string; alternativeTitles: string[]; structure: string[]; cta: string; warnings: string[] };
type Article = { id: number; briefId: number; title: string; slug: string; excerpt: string; content: string; primaryKeyword: string; status: string; qualityScore: number; createdAt: string; updatedAt: string; wordpressPostId?: number | null; wordpressUrl?: string | null; wordpressEditUrl?: string | null; wordpressStatus?: string | null };
type AiStatus = { configured: boolean; provider: string | null; model: string | null; dailyCostLimitUsd: number; dailyRequestLimit: number; costTrackingConfigured: boolean };
type OperationalLogs = { jobs: Array<Record<string, unknown>>; ai: Array<Record<string, unknown>>; collectionRuns?: Array<Record<string, unknown>>; dashboard?: Record<string, unknown> };

const VIEWS: { name: View; icon: string }[] = [
  { name: "Visão Executiva", icon: "⌂" }, { name: "Monitoramento", icon: "◉" }, { name: "Fila Editorial", icon: "◫" }, { name: "Biblioteca", icon: "▤" },
  { name: "Inteligência SEO", icon: "◈" }, { name: "Radar", icon: "⌁" }, { name: "Insights", icon: "✦" }, { name: "Configurações", icon: "⚙" },
];

const VIEW_TITLES: Record<View, string> = {
  "Visão Executiva": "Painel Executivo",
  Monitoramento: "Radar de Notícias",
  "Fila Editorial": "Fila Editorial",
  Biblioteca: "Biblioteca Editorial",
  "Inteligência SEO": "Inteligência SEO",
  Radar: "Arquitetura SEO",
  Insights: "Insights",
  Configurações: "Configurações",
  "Criar Conteúdo": "Estúdio Editorial",
  Conteúdos: "Conteúdos",
};

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function currentTime() { return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); }
function relativeDate(value: string) { const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000)); return hours < 1 ? "agora" : hours < 24 ? `há ${hours}h` : `há ${Math.round(hours / 24)}d`; }
function impactLabel(value: News["logisticsImpact"]) { return value === "high" ? "Alto" : value === "medium" ? "Médio" : "Baixo"; }

export function TFNewsApp({ userName, userEmail, initialUpdatedAt }: { userName: string; userEmail: string; initialUpdatedAt: string }) {
  const [view, setView] = useState<View>("Visão Executiva");
  const [globalIcp, setGlobalIcp] = useState("Todos os ICPs");
  const [news, setNews] = useState<News[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState("Fontes operacionais");
  const [wpConfigured, setWpConfigured] = useState(false);
  const [wordpressBaseUrl, setWordpressBaseUrl] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [logs, setLogs] = useState<OperationalLogs>({ jobs: [], ai: [] });
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(initialUpdatedAt);
  const [objective, setObjective] = useState("Analisar o acontecimento e explicar impactos para operação, distribuição e transporte.");
  const [keyword, setKeyword] = useState("logística B2B");
  const [libraryKitId, setLibraryKitId] = useState<number | null>(null);
  const [queueFocusId, setQueueFocusId] = useState<number | null>(null);
  const [workflowConflict, setWorkflowConflict] = useState<WorkflowConflict | null>(null);

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(null), 5000); }, []);
  const refreshAll = useCallback(async () => {
    try {
      const responses = await Promise.all([fetch("/api/news?pageSize=100&includeDiscarded=true&includeArchived=true"), fetch("/api/sources?includeArchived=true"), fetch("/api/content"), fetch("/api/wordpress"), fetch("/api/ai/status"), fetch("/api/logs")]);
      if (!responses[0].ok || !responses[1].ok || !responses[2].ok) throw new Error("O banco de dados não respondeu corretamente.");
      setNews(((await responses[0].json()) as { news: News[] }).news);
      setSources(((await responses[1].json()) as { sources: Source[] }).sources);
      setArticles(((await responses[2].json()) as { articles: Article[] }).articles);
      if (responses[3].ok) {
        const wordpress = await responses[3].json() as { configured: boolean; baseUrl: string | null };
        setWpConfigured(wordpress.configured);
        setWordpressBaseUrl(wordpress.baseUrl);
      }
      if (responses[4].ok) setAiStatus(await responses[4].json() as AiStatus);
      if (responses[5].ok) setLogs(await responses[5].json() as OperationalLogs);
      setDataError(null);
    } catch (error) { setDataError(error instanceof Error ? error.message : "Não foi possível carregar os dados persistentes."); }
    finally { setLastUpdated(currentTime()); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void refreshAll(); }, 0); return () => window.clearTimeout(timer); }, [refreshAll]);

  const filteredNews = useMemo(() => news.filter((item) => {
    const matchesIcp = globalIcp === "Todos os ICPs" || item.icps.includes(globalIcp) || item.primaryIcp === globalIcp;
    const text = `${item.title} ${item.excerpt} ${item.content} ${item.sourceName} ${item.domain ?? ""} ${item.originalUrl} ${item.topics.join(" ")}`.toLowerCase();
    return matchesIcp && (!search || text.includes(search.toLowerCase()));
  }), [news, globalIcp, search]);
  const liveSelected = [...selected].filter((id) => news.some((item) => item.id === id));

  function chooseView(next: View) { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function toggleTheme() { const root = document.documentElement; const next = root.dataset.theme === "dark" ? "light" : "dark"; root.dataset.theme = next; root.style.colorScheme = next; window.localStorage.setItem("tf-news-theme", next); }
  function toggleNews(id: number) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function startContent() {
    if (!liveSelected.length || busy) return notify("Selecione ao menos uma notícia real no Monitoramento.");
    setBusy(true);
    try {
      const prepared = await fetch("/api/editorial-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare", newsIds: liveSelected }) });
      const preparation = await prepared.json() as { items?: Array<{ newsId: number; conflict: WorkflowConflict | null }>; error?: string };
      if (!prepared.ok) throw new Error(preparation.error ?? "Não foi possível preparar a geração editorial.");
      const conflict = preparation.items?.find((item) => item.conflict)?.conflict;
      if (conflict) { setWorkflowConflict(conflict); return; }

      let lastKitId: number | null = null; let completed = 0; const failures: string[] = [];
      for (const newsId of liveSelected) {
        try {
          const response = await fetch("/api/editorial-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", newsId }) });
          const data = await response.json() as { kit?: { id: number }; conflict?: WorkflowConflict; error?: string };
          if (response.status === 409 && data.conflict) { setWorkflowConflict(data.conflict); break; }
          if (!response.ok || !data.kit) throw new Error(data.error ?? `Falha ao gerar a pauta ${newsId}.`);
          lastKitId = data.kit.id; completed += 1;
        } catch (error) { failures.push(error instanceof Error ? error.message : `Falha na pauta ${newsId}.`); }
      }
      if (lastKitId) {
        setSelected(new Set());
        openLibraryKit(lastKitId);
        notify(`${completed} Kit(s) gerado(s), registrado(s) na Fila e salvo(s) na Biblioteca.${failures.length ? ` ${failures.length} pauta(s) retornaram para revisão.` : ""}`);
      } else if (failures.length) throw new Error(failures[0]);
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao gerar o Kit Editorial."); }
    finally { setBusy(false); }
  }

  async function addToEditorialQueue() {
    if (!liveSelected.length || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/editorial-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "enqueue", newsIds: liveSelected }) });
      const data = await response.json() as { created?: Array<{ id: number }>; conflicts?: WorkflowConflict[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível criar as pautas.");
      if (data.conflicts?.length) setWorkflowConflict(data.conflicts[0]);
      if (data.created?.length) {
        setSelected(new Set()); setQueueFocusId(data.created[0].id); chooseView("Fila Editorial");
        notify(`${data.created.length} pauta(s) adicionada(s) à Fila Editorial.`);
      }
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao adicionar à Fila Editorial."); }
    finally { setBusy(false); }
  }

  async function resolveGenerationConflict(mode: "existing" | "new_version") {
    if (!workflowConflict || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/editorial-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", newsId: workflowConflict.newsId, ...(mode === "existing" ? { queueId: workflowConflict.queueId } : { mode: "new_version" }) }) });
      const data = await response.json() as { kit?: { id: number }; error?: string };
      if (!response.ok || !data.kit) throw new Error(data.error ?? "A geração não foi concluída.");
      setWorkflowConflict(null); setSelected(new Set()); openLibraryKit(data.kit.id); notify("Nova versão gerada e salva na Biblioteca.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao resolver a duplicidade editorial."); }
    finally { setBusy(false); }
  }
  function openLibraryKit(kitId: number) { setLibraryKitId(kitId); chooseView("Biblioteca"); }
  function openQueueItem(queueId: number) { setWorkflowConflict(null); setQueueFocusId(queueId); chooseView("Fila Editorial"); }

  // Kept temporarily for the legacy monitor while the operational workspace is stabilized.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function updateNews(action: "setIcp" | "relevant" | "discard" | "restore", newsIds: number[], primaryIcp?: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/news", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, newsIds, primaryIcp }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao atualizar a notícia.");
      if (action === "discard") setSelected((current) => new Set([...current].filter((id) => !newsIds.includes(id))));
      notify(action === "discard" ? "Notícia descartada." : action === "relevant" ? "Notícia marcada como relevante." : "Classificação atualizada.");
      await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao atualizar a notícia."); } finally { setBusy(false); }
  }

  async function generateBrief() {
    if (!liveSelected.length) return notify("Selecione notícias reais coletadas de uma fonte RSS.");
    setBusy(true);
    try {
      const response = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "brief", newsIds: liveSelected, icp: globalIcp, objective, primaryKeyword: keyword }) });
      const data = await response.json() as { brief?: Brief; error?: string; coherence?: { suggestedGroups?: Array<{ label: string; newsIds: number[] }> } };
      if (!response.ok || !data.brief) {
        const groups = data.coherence?.suggestedGroups?.map((group) => `${group.label} (${group.newsIds.length})`).join("; ");
        throw new Error(groups ? `${data.error} Sugestão: ${groups}.` : data.error ?? "Não foi possível gerar o briefing.");
      }
      setBrief(data.brief); notify("Briefing editorial criado por IA com fontes rastreáveis.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao gerar briefing."); } finally { setBusy(false); }
  }

  async function generateArticle() {
    if (!brief) return;
    setBusy(true);
    try {
      const response = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "article", briefId: brief.id, newsIds: liveSelected, icp: globalIcp, objective, primaryKeyword: keyword }) });
      const data = await response.json() as { article?: Article; error?: string };
      if (!response.ok || !data.article) throw new Error(data.error ?? "Não foi possível gerar o artigo.");
      setArticle(data.article); notify("Artigo original criado como rascunho interno."); await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao gerar artigo."); } finally { setBusy(false); }
  }

  async function saveArticle() {
    if (!article) return;
    setBusy(true);
    try {
      const response = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", articleId: article.id, newsIds: [], title: article.title, content: article.content }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar.");
      notify("Rascunho revisado e salvo."); await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar."); } finally { setBusy(false); }
  }

  async function sendWordPress(articleId: number) {
    setBusy(true);
    try {
      const response = await fetch("/api/wordpress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", articleId }) });
      const data = await response.json() as { error?: string; postId?: number; editUrl?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao enviar.");
      notify(`Rascunho #${data.postId} confirmado no WordPress.`); await refreshAll();
      if (data.editUrl) window.open(data.editUrl, "_blank", "noopener,noreferrer");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha no WordPress."); } finally { setBusy(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar"><button className="sidebar-brand" type="button" onClick={() => chooseView("Visão Executiva")} aria-label="Ir para Painel Executivo"><span className="sidebar-brand-name"><strong>TF</strong><em>NEWS</em></span><small>Editorial Intelligence</small></button><nav className="nav" aria-label="Navegação principal">{VIEWS.map((item) => <button key={item.name} className={`nav-button ${view === item.name ? "active" : ""}`} onClick={() => chooseView(item.name)} aria-label={VIEW_TITLES[item.name]} data-tooltip={VIEW_TITLES[item.name]}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-text">{item.name}</span></button>)}</nav><div className="sidebar-foot"><div className="live-status"><span className="live-dot" /> Monitoramento operacional</div><div className="source-meta" style={{ marginTop: 8 }}>{sources.length} fonte(s) cadastrada(s)</div></div></aside>
    <main className="main"><header className="topbar"><div className="header-context"><button className="header-brand" type="button" onClick={() => chooseView("Visão Executiva")} aria-label="Ir para Painel Executivo"><span className="header-brand-name"><strong>TF</strong><em>NEWS</em></span><span className="header-brand-rule" aria-hidden="true" /></button><div className="header-copy"><div className="page-name">{VIEW_TITLES[view]}</div><div className="update-time">Atualizado às {lastUpdated}</div></div></div><div className="top-actions"><select className="global-select" value={globalIcp} onChange={(event) => setGlobalIcp(event.target.value)} aria-label="Filtrar todo o sistema por ICP"><option>Todos os ICPs</option>{ICP_CATALOG.map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select><button className="theme-toggle" onClick={toggleTheme} aria-label="Alternar entre modo claro e escuro" title="Alternar tema"><span className="theme-icon-light" aria-hidden="true">☼</span><span className="theme-icon-dark" aria-hidden="true">◐</span></button><div className="user-chip" title={userEmail}><div className="avatar">{initials(userName)}</div><div className="user-copy"><strong>{userName}</strong><span>Editor</span></div></div></div></header>
      <div className="content">{dataError && <div className="notice">{dataError}</div>}
        {view === "Visão Executiva" && <ExecutiveDashboard globalIcp={globalIcp} onMonitor={() => chooseView("Monitoramento")} onLibrary={openLibraryKit} notify={notify} />}
        {view === "Monitoramento" && <MonitoringWorkspace news={filteredNews} sources={sources} selected={selected} search={search} setSearch={setSearch} toggleNews={toggleNews} toggleAll={(ids) => setSelected(new Set(ids))} startContent={() => void startContent()} startQueue={() => void addToEditorialQueue()} refresh={refreshAll} notify={notify} busy={busy} setBusy={setBusy} aiConfigured={Boolean(aiStatus?.configured)} />}
        {view === "Fila Editorial" && <EditorialQueue initialQueueId={queueFocusId} onOpenKit={openLibraryKit} notify={notify} />}
        {view === "Biblioteca" && <EditorialIntelligence mode="library" wordpressBaseUrl={wordpressBaseUrl} initialKitId={libraryKitId} onMonitor={() => chooseView("Monitoramento")} notify={notify} />}
        {view === "Inteligência SEO" && <SeoIntelligence globalIcp={globalIcp} notify={notify} />}
        {view === "Radar" && <EditorialIntelligence mode="radar" wordpressBaseUrl={wordpressBaseUrl} onMonitor={() => chooseView("Monitoramento")} notify={notify} />}
        {view === "Insights" && <EditorialIntelligence mode="insights" wordpressBaseUrl={wordpressBaseUrl} onMonitor={() => chooseView("Monitoramento")} notify={notify} />}
        {view === "Criar Conteúdo" && <CreateContent selectedCount={liveSelected.length} brief={brief} article={article} setArticle={setArticle} objective={objective} setObjective={setObjective} keyword={keyword} setKeyword={setKeyword} busy={busy} aiConfigured={Boolean(aiStatus?.configured)} generateBrief={generateBrief} generateArticle={generateArticle} saveArticle={saveArticle} onChooseNews={() => chooseView("Monitoramento")} />}
        {view === "Conteúdos" && <Contents articles={articles} busy={busy} wpConfigured={wpConfigured} openArticle={(item) => { setArticle(item); chooseView("Criar Conteúdo"); }} sendWordPress={sendWordPress} />}
        {view === "Configurações" && <Settings tab={settingsTab} setTab={setSettingsTab} sources={sources} wpConfigured={wpConfigured} aiStatus={aiStatus} logs={logs} busy={busy} setBusy={setBusy} notify={notify} refresh={refreshAll} />}
      </div></main>
    <nav className="mobile-nav" aria-label="Navegação móvel">{VIEWS.map((item) => <button key={item.name} className={view === item.name ? "active" : ""} onClick={() => chooseView(item.name)} aria-label={item.name}><span aria-hidden="true">{item.icon}</span>{item.name === "Visão Executiva" ? "Visão" : item.name === "Fila Editorial" ? "Fila" : item.name === "Inteligência SEO" ? "SEO" : item.name}</button>)}</nav>{workflowConflict && <WorkflowConflictModal conflict={workflowConflict} busy={busy} onCancel={() => setWorkflowConflict(null)} onOpenQueue={openQueueItem} onOpenKit={(kitId) => { setWorkflowConflict(null); openLibraryKit(kitId); }} onGenerate={(mode) => void resolveGenerationConflict(mode)} />}{toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function WorkflowConflictModal({ conflict, busy, onCancel, onOpenQueue, onOpenKit, onGenerate }: {
  conflict: WorkflowConflict; busy: boolean; onCancel: () => void; onOpenQueue: (id: number) => void;
  onOpenKit: (id: number) => void; onGenerate: (mode: "existing" | "new_version") => void;
}) {
  useEscapeKey(onCancel, !busy);
  const generating = conflict.code === "generation_in_progress";
  return <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-conflict-title"><div className="eyebrow">Rastreabilidade editorial</div><h2 id="workflow-conflict-title">Este conteúdo já possui uma jornada ativa</h2><p>{generating ? "Já existe uma geração em andamento. Aguarde a conclusão ou abra a pauta existente." : conflict.code === "existing_kit" ? "Já existe um Kit concluído para esta notícia. Escolha como deseja continuar." : "Já existe uma pauta ativa para esta notícia."}</p><div className="inline-actions wrap">{conflict.queueId && <button className="secondary" onClick={() => onOpenQueue(conflict.queueId!)}>Abrir pauta existente</button>}{conflict.kitId && <button className="secondary" onClick={() => onOpenKit(conflict.kitId!)}>Abrir Kit existente</button>}{conflict.code === "active_queue" && !conflict.kitId && <button className="primary" disabled={busy} onClick={() => onGenerate("existing")}>Gerar pauta existente</button>}{conflict.code === "existing_kit" && <button className="primary" disabled={busy} onClick={() => onGenerate("new_version")}>Gerar nova versão</button>}<button className="ghost" disabled={busy} onClick={onCancel}>Cancelar</button></div></section></div>;
}

// Legacy operational dashboard retained for rollback compatibility.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Dashboard({ news, sources, logs, loading, referenceDate, onMonitor }: { news: News[]; sources: Source[]; logs: OperationalLogs; loading: boolean; referenceDate: string; onMonitor: () => void }) {
  const high = news.filter((item) => item.relevanceScore >= 80).length;
  const today = referenceDate.slice(0, 10);
  const collectedToday = news.filter((item) => item.collectedAt.startsWith(today)).length;
  const duplicates = Number((logs.dashboard as { duplicates?: number } | undefined)?.duplicates ?? 0);
  const metrics = [
    { label: "Notícias monitoradas", value: news.length, foot: "Registros persistidos", trend: "Dados reais" },
    { label: "Coletadas hoje", value: collectedToday, foot: "Entradas desde 00:00 UTC", trend: "Coleta" },
    { label: "Notícias novas", value: news.filter((item) => item.status === "new").length, foot: "Aguardando curadoria", trend: "Operação" },
    { label: "Alta relevância", value: high, foot: "Score 80 ou mais", trend: "Prioridade" },
    { label: "Fontes ativas", value: sources.filter((source) => source.active && !source.archivedAt).length, foot: "Feeds em operação", trend: "Fontes" },
    { label: "Fontes saudáveis", value: sources.filter((source) => source.health === "healthy").length, foot: "Última coleta concluída", trend: "Saúde" },
    { label: "Fontes com erro", value: sources.filter((source) => source.health === "failed").length, foot: "Três ou mais falhas", trend: "Atenção" },
    { label: "Duplicadas", value: duplicates, foot: "Detectadas nas execuções", trend: "Deduplicação" },
  ];
  const days = Array.from({ length: 7 }, (_, index) => new Date(Date.parse(referenceDate) - (6 - index) * 86_400_000).toISOString().slice(0, 10));
  const bars = days.map((day) => news.filter((item) => item.collectedAt.startsWith(day)).length);
  const maxBar = Math.max(1, ...bars);
  return <><section className="dashboard-hero"><div className="hero-copy"><div className="eyebrow"><span className="signal-pulse" /> Visão executiva</div><h1>Mercado em movimento.</h1><p className="subtitle">Transformando sinais dos seus mercados em oportunidades de conteúdo.</p></div><button className="primary" onClick={onMonitor}>Explorar monitoramento <span aria-hidden="true">→</span></button></section>
    {!news.length && <div className="notice">Ainda não há notícias reais. Cadastre ou colete uma fonte RSS em Configurações.</div>}
    <div className="metrics">{metrics.map((metric) => <div className={`card metric ${loading ? "skeleton-card" : ""}`} key={metric.label}><div className="metric-top"><span>{metric.label}</span><span className="metric-trend">{metric.trend}</span></div><div className="metric-value">{metric.value}</div><div className="metric-foot">{metric.foot}</div></div>)}</div>
    <div className="dashboard-grid"><section className="card panel"><div className="panel-title"><h2>Volume de coleta</h2><small>Distribuição por período</small></div><div className="bars">{bars.map((count, index) => <div className="bar-wrap" key={index}><div className={`bar ${count === maxBar && count > 0 ? "hot" : ""}`} style={{ height: `${Math.max(3, (count / maxBar) * 100)}%` }} /><span className="bar-label">{index + 1}</span></div>)}</div></section>
      <section className="card panel"><div className="panel-title"><h2>Fontes</h2><small>{sources.length} cadastradas</small></div>{sources.length ? sources.slice(0, 4).map((source) => <div className="source-line" key={source.id}><div className="source-logo">{initials(source.name)}</div><div><div className="source-name">{source.name}</div><div className="source-meta">{source.domain} · {source.lastStatus}</div></div><span className="source-state">{source.lastError ? "ATENÇÃO" : "ATIVA"}</span></div>) : <div className="empty"><strong>Nenhuma fonte ainda</strong>Cadastre o primeiro feed RSS.</div>}</section>
      <section className="card panel"><div className="panel-title"><h2>Alta relevância</h2><small>Prioridades reais</small></div><div className="news-list">{news.slice(0, 5).map((item) => <div className="news-row" key={item.id}><span className={`impact-dot ${item.logisticsImpact === "high" ? "high" : ""}`} /><div><div className="news-title">{item.title}</div><div className="news-meta">{item.sourceName} · {relativeDate(item.publishedAt)}</div></div><span className={`score ${item.relevanceScore >= 80 ? "priority" : ""}`}>{item.relevanceScore}</span></div>)}</div></section>
      <section className="card panel"><div className="panel-title"><h2>Temas em evidência</h2><small>Por recorrência</small></div><div className="tags">{[...new Set(news.flatMap((item) => item.topics))].slice(0, 12).map((topic, index) => <span className={`tag ${index < 3 ? "red" : ""}`} key={topic}>{topic}</span>)}</div></section></div></>;
}

export function LegacyMonitoring({ news, sources, selected, search, setSearch, toggleNews, toggleAll, startContent, updateNews, busy }: { news: News[]; sources: Source[]; selected: Set<number>; search: string; setSearch: (value: string) => void; toggleNews: (id: number) => void; toggleAll: (ids: number[]) => void; startContent: () => void; updateNews: (action: "setIcp" | "relevant" | "discard" | "restore", newsIds: number[], primaryIcp?: string) => Promise<void>; busy: boolean }) {
  const [page, setPage] = useState(1); const [impact, setImpact] = useState("all"); const [source, setSource] = useState("all"); const [period, setPeriod] = useState("30"); const [minimum, setMinimum] = useState("0"); const [topic, setTopic] = useState("all");
  const [referenceTime] = useState(() => Date.now());
  const topics = [...new Set(news.flatMap((item) => item.topics))].sort();
  const filtered = news.filter((item) => impact === "all" || item.logisticsImpact === impact).filter((item) => source === "all" || item.sourceId === Number(source)).filter((item) => topic === "all" || item.topics.includes(topic)).filter((item) => item.relevanceScore >= Number(minimum)).filter((item) => referenceTime - new Date(item.publishedAt).getTime() <= Number(period) * 86_400_000);
  const pageSize = 8; const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); const safePage = Math.min(page, totalPages); const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return <><div className="section-head"><div><div className="eyebrow">Curadoria de mercado</div><h1>Monitoramento</h1><p className="subtitle">Dados reais coletados, classificados e persistidos.</p></div><button className="primary" disabled={!selected.size} onClick={startContent}>Gerar conteúdo <span className="button-count">{selected.size}</span></button></div>
    <div className="card toolbar"><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, tema ou palavra-chave…" aria-label="Buscar notícias" /><select className="filter" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="all">Todas as fontes</option>{sources.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select className="filter" value={impact} onChange={(event) => setImpact(event.target.value)}><option value="all">Todos os impactos</option><option value="high">Impacto alto</option><option value="medium">Impacto médio</option><option value="low">Impacto baixo</option></select><select className="filter" value={topic} onChange={(event) => setTopic(event.target.value)}><option value="all">Todos os temas</option>{topics.map((item) => <option key={item}>{item}</option>)}</select><select className="filter" value={minimum} onChange={(event) => setMinimum(event.target.value)}><option value="0">Toda relevância</option><option value="60">Relevância 60+</option><option value="80">Relevância 80+</option></select><select className="filter" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="1">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="3650">Todo o período</option></select></div>
    {!!filtered.length && <div className="selection-bar"><span>{selected.size} selecionada(s)</span><div className="inline-actions"><button className="ghost" onClick={() => toggleAll(selected.size === filtered.length ? [] : filtered.map((item) => item.id))}>{selected.size === filtered.length ? "Limpar seleção" : "Selecionar resultados"}</button><button className="primary" disabled={!selected.size} onClick={startContent}>Criar pauta →</button></div></div>}
    <div className="card news-table"><div className="table-head"><span /><span>Notícia</span><span>Fonte / Região</span><span>ICPs e temas</span><span>Score</span><span>Impacto</span></div>{visible.length ? visible.map((item) => <div className={`table-item ${selected.has(item.id) ? "selected" : ""}`} key={item.id} title={item.classificationReason}><input className="news-check" type="checkbox" checked={selected.has(item.id)} onChange={() => toggleNews(item.id)} aria-label={`Selecionar ${item.title}`} /><div><a className="item-title item-title-link" href={item.originalUrl} target="_blank" rel="noopener noreferrer">{item.title} ↗</a><div className="item-excerpt">{item.excerpt}</div><div className="row-actions"><button disabled={busy} onClick={() => void updateNews("relevant", [item.id])}>Relevante</button><button disabled={busy} onClick={() => void updateNews("discard", [item.id])}>Descartar</button></div></div><div><div className="source-name">{item.sourceName}</div><div className="source-meta">{item.region} · {relativeDate(item.publishedAt)}</div></div><div><select className="compact-select" value={item.primaryIcp} onChange={(event) => void updateNews("setIcp", [item.id], event.target.value)} aria-label={`Alterar ICP de ${item.title}`}>{ICP_CATALOG.map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select><div className="tags">{item.topics.slice(0, 2).map((value) => <span className="tag" key={value}>{value}</span>)}</div></div><span className={`score ${item.relevanceScore >= 80 ? "priority" : ""}`}>{item.relevanceScore}</span><span className={`impact-badge ${item.logisticsImpact}`}>{impactLabel(item.logisticsImpact)}</span></div>) : <div className="empty"><strong>Nenhuma notícia real encontrada</strong>Ajuste os filtros ou colete uma fonte RSS.</div>}<div className="pagination"><span>Mostrando {filtered.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, filtered.length)} de {filtered.length}</span><div><button className="page-button" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))}>←</button><span className="page-current">{safePage} / {totalPages}</span><button className="page-button" disabled={safePage === totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}>→</button></div></div></div></>;
}

function CreateContent({ selectedCount, brief, article, setArticle, objective, setObjective, keyword, setKeyword, busy, aiConfigured, generateBrief, generateArticle, saveArticle, onChooseNews }: { selectedCount: number; brief: Brief | null; article: Article | null; setArticle: (value: Article) => void; objective: string; setObjective: (value: string) => void; keyword: string; setKeyword: (value: string) => void; busy: boolean; aiConfigured: boolean; generateBrief: () => void; generateArticle: () => void; saveArticle: () => void; onChooseNews: () => void }) {
  return <><div className="section-head"><div><div className="eyebrow">Fluxo editorial</div><h1>Criar conteúdo</h1><p className="subtitle">Do fato confirmado ao rascunho original, com contexto setorial e foco logístico.</p></div><button className="secondary" onClick={onChooseNews}>← Escolher notícias</button></div>
    {!aiConfigured && <div className="notice">A geração está bloqueada até configurar a integração real de IA.</div>}
    <div className="editorial-progress" aria-label="Progresso editorial"><div className="progress-step complete"><span>01</span><div><strong>Fontes</strong><small>{selectedCount} selecionada(s)</small></div></div><span className="progress-connector">↓</span><div className={`progress-step ${brief ? "complete" : "current"}`}><span>02</span><div><strong>Briefing</strong><small>{brief ? "Estrutura aprovada" : "Próxima etapa"}</small></div></div><span className="progress-connector">↓</span><div className={`progress-step ${article ? "complete" : brief ? "current" : ""}`}><span>03</span><div><strong>Artigo</strong><small>{article ? "Rascunho criado" : "Geração original"}</small></div></div><span className="progress-connector">↓</span><div className={`progress-step ${article ? "current" : ""}`}><span>04</span><div><strong>WordPress</strong><small>Envio como draft</small></div></div></div>
    <div className="workspace"><section className="card form-card"><div className="form-intro"><span>02</span><div><h2>Briefing editorial</h2><p>Defina o foco antes de transformar as fontes em conteúdo.</p></div></div><div className="form-grid"><div className="form-group full"><label className="label" htmlFor="objective">Objetivo editorial</label><textarea id="objective" className="field" value={objective} onChange={(event) => setObjective(event.target.value)} /></div><div className="form-group"><label className="label" htmlFor="keyword">Palavra-chave principal</label><input id="keyword" className="field" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div><div className="form-group"><label className="label" htmlFor="tone">Tom</label><select id="tone" className="field"><option>Executivo e acessível</option><option>Analítico</option><option>Notícia comentada</option></select></div><div className="form-group full"><button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy || !selectedCount || !aiConfigured} onClick={generateBrief}>{busy ? "Processando…" : brief ? "Regenerar briefing" : "Gerar briefing editorial"}</button></div></div>
      {brief && <div className="brief-box" style={{ marginTop: 18 }}><h3>{brief.suggestedTitle}</h3><p>{brief.mainEvent || brief.summary}</p><div className="tags">{brief.topics.map((topic) => <span className="tag" key={topic}>{topic}</span>)}</div><p><strong>Ângulo editorial:</strong> {brief.opportunity}</p><p><strong>Impacto logístico:</strong> {brief.logisticsImpact}</p><p><strong>Regiões:</strong> {brief.regions.join(", ")}</p><button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy} onClick={generateArticle}>{busy ? "Gerando…" : "Aprovar briefing e gerar artigo"}</button></div>}
      {article && <div style={{ marginTop: 20 }}><div className="form-group"><label className="label" htmlFor="article-title">Título</label><input id="article-title" className="field" value={article.title} onChange={(event) => setArticle({ ...article, title: event.target.value })} /></div><div className="form-group" style={{ marginTop: 12 }}><label className="label" htmlFor="article-content">Conteúdo HTML</label><textarea id="article-content" className="field editor" value={article.content} onChange={(event) => setArticle({ ...article, content: event.target.value })} /></div><div className="inline-actions" style={{ marginTop: 12 }}><button className="primary" disabled={busy} onClick={saveArticle}>Salvar revisão</button><span className="status review">Qualidade {article.qualityScore}/100</span></div></div>}
    </section><aside className="card aside-note"><h3>Checklist editorial</h3>{["Fontes rastreáveis presentes", "Fatos separados de análise", "Sem reprodução integral", "CTA contextual e discreto", "Envio protegido como rascunho"].map((item) => <div className="check" key={item}>{item}</div>)}{brief?.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}</aside></div></>;
}

function Contents({ articles, busy, wpConfigured, openArticle, sendWordPress }: { articles: Article[]; busy: boolean; wpConfigured: boolean; openArticle: (article: Article) => void; sendWordPress: (id: number) => void }) {
  return <><div className="section-head"><div><div className="eyebrow">Produção editorial</div><h1>Conteúdos</h1><p className="subtitle">Rascunhos, revisões e envios ao WordPress em um único histórico.</p></div></div><div className="status-legend"><span className="status draft">Rascunho</span><span className="status review">Em revisão</span><span className="status sent">Enviado como draft</span><span className="status error">Erro</span></div><div className="content-list">{articles.length ? articles.map((item) => <article className="card content-item" key={item.id}><div><div className="content-title">{item.title}</div><div className="content-meta">{item.primaryKeyword} · atualizado {relativeDate(item.updatedAt)} · qualidade {item.qualityScore}/100</div><div style={{ marginTop: 8 }}><span className={`status ${item.wordpressPostId ? "sent" : item.status === "review" ? "review" : "draft"}`}>{item.wordpressPostId ? `WordPress draft #${item.wordpressPostId}` : item.status === "review" ? "Em revisão" : "Rascunho interno"}</span></div></div><div className="content-actions"><button className="secondary" onClick={() => openArticle(item)}>Editar</button>{item.wordpressEditUrl && <a className="secondary" href={item.wordpressEditUrl} target="_blank" rel="noopener noreferrer">Abrir no WordPress ↗</a>}<button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy || !wpConfigured || Boolean(item.wordpressPostId)} onClick={() => sendWordPress(item.id)}>{item.wordpressPostId ? "Enviado" : "Enviar como draft"}</button></div></article>) : <div className="card empty"><strong>Nenhum conteúdo gerado</strong>Selecione notícias no Monitoramento e crie o primeiro briefing.</div>}</div></>;
}

function Settings({ tab, setTab, sources, wpConfigured, aiStatus, logs, busy, setBusy, notify, refresh }: { tab: string; setTab: (value: string) => void; sources: Source[]; wpConfigured: boolean; aiStatus: AiStatus | null; logs: OperationalLogs; busy: boolean; setBusy: (value: boolean) => void; notify: (value: string) => void; refresh: () => Promise<void> }) {
  const tabs = ["Fontes operacionais", "ICPs", "Histórico", "Automação", "WordPress", "Inteligência artificial", "Logs"];
  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const formElement = event.currentTarget; const form = new FormData(formElement); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; const action = submitter?.value === "test" ? "test" : "save";
    try {
      const response = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, name: form.get("name"), feedUrl: form.get("feedUrl"), websiteUrl: form.get("websiteUrl"), reliabilityScore: Number(form.get("reliabilityScore")) }) });
      const data = await response.json() as { source?: Source; test?: { itemCount: number }; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Falha ao validar a fonte.");
      if (action === "test") { notify(`Feed válido: ${data.test?.itemCount ?? 0} item(ns) encontrado(s).`); return; }
      if (!data.source) throw new Error("A fonte não foi salva.");
      const collected = await fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: data.source.id }) });
      const result = await collected.json() as { created?: number; duplicates?: number; error?: string };
      if (!collected.ok) throw new Error(result.error ?? "Fonte salva, mas a coleta falhou.");
      notify(`${result.created ?? 0} notícia(s) nova(s); ${result.duplicates ?? 0} duplicada(s) ignorada(s).`); formElement.reset(); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao cadastrar fonte."); } finally { setBusy(false); }
  }
  async function collect(sourceId: number) { setBusy(true); try { const response = await fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId }) }); const data = await response.json() as { created?: number; duplicates?: number; error?: string }; if (!response.ok) throw new Error(data.error ?? "Falha na coleta."); notify(`${data.created} nova(s); ${data.duplicates} duplicada(s) ignorada(s).`); await refresh(); } catch (error) { notify(error instanceof Error ? error.message : "Falha na coleta."); } finally { setBusy(false); } }
  async function testWordPress() { setBusy(true); try { const connection = await fetch("/api/wordpress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) }); const data = await connection.json() as { user?: string; error?: string }; if (!connection.ok) throw new Error(data.error ?? "Falha na conexão."); const taxonomies = await fetch("/api/wordpress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "taxonomies" }) }); const lists = await taxonomies.json() as { categories?: unknown[]; tags?: unknown[]; error?: string }; if (!taxonomies.ok) throw new Error(lists.error ?? "Falha ao listar categorias e tags."); notify(`WordPress conectado como ${data.user}: ${lists.categories?.length ?? 0} categorias e ${lists.tags?.length ?? 0} tags.`); } catch (error) { notify(error instanceof Error ? error.message : "Falha na conexão."); } finally { setBusy(false); } }
  return <><div className="section-head"><div><div className="eyebrow">Administração</div><h1>Configurações</h1><p className="subtitle">Fontes, segmentos e integrações do fluxo editorial.</p></div></div><div className="settings-grid"><nav className="card settings-nav" aria-label="Seções de configuração">{tabs.map((item) => <button className={`settings-tab ${tab === item ? "active" : ""}`} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav><section className="card form-card">
    {tab === "Fontes operacionais" && <SourceManager sources={sources} busy={busy} setBusy={setBusy} notify={notify} refresh={refresh} />}
    {tab === "Histórico" && <OperationsHistory runs={logs.collectionRuns} />}
    {tab === "Fontes" && <><div className="panel-title"><h2>Cadastrar fonte RSS ou Atom</h2><small>Teste antes de salvar</small></div><form className="form-grid" onSubmit={submitSource}><div className="form-group"><label className="label" htmlFor="source-name">Nome</label><input required minLength={2} id="source-name" name="name" className="field" /></div><div className="form-group"><label className="label" htmlFor="feed-url">URL do feed</label><input required type="url" id="feed-url" name="feedUrl" className="field" /></div><div className="form-group"><label className="label" htmlFor="site-url">Site da fonte</label><input type="url" id="site-url" name="websiteUrl" className="field" /></div><div className="form-group"><label className="label" htmlFor="reliability">Confiabilidade</label><input id="reliability" name="reliabilityScore" type="number" min="0" max="100" defaultValue="75" className="field" /></div><div className="form-group full inline-actions"><button className="secondary" name="action" value="test" disabled={busy}>Testar feed</button><button className="primary" name="action" value="save" disabled={busy}>{busy ? "Processando…" : "Cadastrar e coletar"}</button></div></form><div style={{ marginTop: 24 }}><div className="panel-title"><h2>Fontes cadastradas</h2><small>{sources.length} total</small></div>{sources.map((item) => <div className="source-line" key={item.id}><div className="source-logo">{initials(item.name)}</div><div><div className="source-name">{item.name}</div><div className="source-meta">{item.feedUrl} · {item.lastStatus} · {item.lastItemCount} itens</div>{item.lastError && <div className="source-meta source-error">{item.lastError}</div>}</div><button className="secondary" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void collect(item.id)}>Coletar agora</button></div>)}</div></>}
    {tab === "ICPs" && <><div className="panel-title"><h2>Segmentos monitorados</h2><small>{ICP_CATALOG.length} ativos</small></div>{ICP_CATALOG.map((icp) => <div className="source-line" key={icp.slug}><div className="source-logo">{initials(icp.name)}</div><div><div className="source-name">{icp.name}</div><div className="source-meta">{icp.keywords.slice(0, 5).join(" · ")}</div></div><span className="source-state">ATIVO</span></div>)}</>}
    {tab === "WordPress" && <><div className="panel-title"><h2>WordPress REST API</h2><span className={`status ${wpConfigured ? "sent" : "review"}`}>{wpConfigured ? "Configurado" : "Pendente"}</span></div><div className="notice">Todo envio é forçado para <strong>draft</strong>. O teste também valida categorias e tags.</div><div className="brief-box"><code>WORDPRESS_BASE_URL</code><br /><code>WORDPRESS_USERNAME</code><br /><code>WORDPRESS_APPLICATION_PASSWORD</code></div><button className="primary" style={{ marginTop: 14 }} disabled={!wpConfigured || busy} onClick={() => void testWordPress()}>Testar conexão real</button></>}
    {tab === "Inteligência artificial" && <><div className="panel-title"><h2>Camada editorial real</h2><span className={`status ${aiStatus?.configured ? "sent" : "review"}`}>{aiStatus?.configured ? "Configurada" : "Pendente"}</span></div><p className="subtitle">O Kit Editorial V1 gera Blog SEO e WhatsApp Comercial somente mediante ação explícita do usuário. Ranking, Radar e Insights permanecem determinísticos.</p><div className="check">Respostas estruturadas e validadas com Zod</div><div className="check">Pensamento mínimo e saída de até 1.800 tokens</div><div className="check">Retry seletivo para alta demanda: 5s e 10s, no máximo 3 tentativas</div><div className="check">Timeout total de até 54 segundos com cancelamento</div><div className="check">Logs de tokens, latência, validação, persistência e custo</div><div className="check">Limite diário de {aiStatus?.dailyRequestLimit ?? 100} chamadas e US$ {aiStatus?.dailyCostLimitUsd ?? 5}</div>{aiStatus?.configured && <div className="notice">Modelo ativo: {aiStatus.model}. Custeio {aiStatus.costTrackingConfigured ? "configurado" : "sem tarifas configuradas"}.</div>}</>}
    {tab === "Automação" && <><div className="panel-title"><h2>Coleta agendada</h2><span className="status sent">1 vez por dia</span></div><p className="subtitle">Execução às 08:00 de Brasília, compatível com o plano Hobby atual, com segredo, lock, idempotência, retries e logs.</p><div className="check">Uma falha de fonte não interrompe as demais</div><div className="check">Bloqueio contra execuções concorrentes e idempotência</div><div className="check">CRON_SECRET obrigatório</div></>}
    {tab === "Logs" && <><div className="panel-title"><h2>Histórico operacional</h2><small>{logs.jobs.length} jobs · {logs.ai.length} chamadas de IA</small></div>{logs.jobs.length ? logs.jobs.slice(0, 30).map((log, index) => <div className="log-line" key={String(log.id ?? index)}><strong>{String(log.job_type ?? "job")}</strong><span className={`status ${log.status === "success" ? "sent" : log.status === "failed" ? "error" : "review"}`}>{String(log.status)}</span><small>{String(log.started_at ?? "")}</small>{Boolean(log.error_message) && <p>{String(log.error_message)}</p>}</div>) : <div className="empty"><strong>Nenhuma execução registrada</strong>Os próximos jobs e envios aparecerão aqui.</div>}</>}
  </section></div></>;
}
