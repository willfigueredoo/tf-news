"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "../lib/use-escape-key";

type ReelIdeaStatus = "new" | "scripting" | "review" | "approved" | "recorded" | "archived";
type ReelIdeaPriority = "high" | "medium" | "low";
type ReelIdea = {
  id: number;
  newsItemId: number;
  title: string;
  summary: string;
  industryRelevance: string;
  suggestedAngle: string;
  suggestedCopy: string;
  primaryPillar: string;
  secondaryPillar: string | null;
  priority: ReelIdeaPriority;
  status: ReelIdeaStatus;
  originType: "monitoring" | "executive";
  editorialScore: number;
  responsible: string | null;
  provider: string;
  model: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  news: {
    title: string;
    originalUrl: string;
    sourceName: string;
    publishedAt: string;
    collectedAt: string;
    excerpt: string;
    primaryIcp: string;
    secondaryIcps: string[];
    topics: string[];
    region: string;
    logisticsImpact: string;
    relevanceScore: number;
  };
  sources: Array<{ newsId: number; title: string; sourceName: string; originalUrl: string; publishedAt: string; isPrimary: boolean }>;
};

type Props = {
  initialIdeaId?: number | null;
  onOpenMonitoring: () => void;
  notify: (message: string) => void;
};

const STATUS_LABELS: Record<ReelIdeaStatus, string> = {
  new: "Nova",
  scripting: "Em roteiro",
  review: "Em aprovação",
  approved: "Aprovada",
  recorded: "Gravada",
  archived: "Arquivada",
};
const PRIORITY_LABELS: Record<ReelIdeaPriority, string> = { high: "Alta", medium: "Média", low: "Baixa" };
const PILLARS = [
  "Inteligência de mercado industrial",
  "Produtividade e eficiência",
  "Tecnologia e futuro da indústria",
  "Supply Chain e gestão de fornecedores",
  "Gestão, liderança e negócios",
  "Logística sob a perspectiva da indústria",
];

export function ReelIdeas({ initialIdeaId = null, onOpenMonitoring, notify }: Props) {
  const [ideas, setIdeas] = useState<ReelIdea[]>([]);
  const [activeId, setActiveId] = useState<number | null>(initialIdeaId);
  const [search, setSearch] = useState("");
  const [pillar, setPillar] = useState("all");
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/reel-ideas?includeArchived=true", { cache: "no-store" });
      const data = await response.json() as { ideas?: ReelIdea[]; aiConfigured?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar o banco de ideias.");
      setIdeas(data.ideas ?? []);
      setAiConfigured(Boolean(data.aiConfigured));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o banco de ideias.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEscapeKey(() => closeIdea(), Boolean(activeId));

  const active = ideas.find((idea) => idea.id === activeId) ?? null;
  const visible = useMemo(() => ideas.filter((idea) => {
    const text = `${idea.title} ${idea.summary} ${idea.primaryPillar} ${idea.news.title} ${idea.news.sourceName}`.toLocaleLowerCase("pt-BR");
    const statusMatch = status === "all" || status === "active" && idea.status !== "archived" || idea.status === status;
    return statusMatch
      && (pillar === "all" || idea.primaryPillar === pillar || idea.secondaryPillar === pillar)
      && (!search.trim() || text.includes(search.trim().toLocaleLowerCase("pt-BR")));
  }), [ideas, pillar, search, status]);

  async function discover() {
    if (busy || !aiConfigured) return notify("A IA ainda não está configurada.");
    setBusy(true);
    try {
      const response = await fetch("/api/reel-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover" }),
      });
      const data = await response.json() as { idea?: ReelIdea; error?: string; ideaId?: number };
      if (response.status === 409 && data.ideaId) {
        await load();
        openIdea(data.ideaId);
        return notify("Esta notícia já estava no banco de ideias.");
      }
      if (!response.ok || !data.idea) throw new Error(data.error ?? "Nenhuma ideia foi criada.");
      await load();
      openIdea(data.idea.id);
      notify("Nova ideia criada a partir da inteligência editorial.");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Não foi possível criar a ideia.");
    } finally {
      setBusy(false);
    }
  }

  async function updateIdea(changes: Partial<Pick<ReelIdea, "status" | "priority" | "responsible">>) {
    if (!active || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/reel-ideas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id, ...changes }),
      });
      const data = await response.json() as { idea?: ReelIdea; error?: string };
      if (!response.ok || !data.idea) throw new Error(data.error ?? "A organização da ideia não foi atualizada.");
      setIdeas((current) => current.map((idea) => idea.id === data.idea!.id ? data.idea! : idea));
      notify(changes.status === "archived" ? "Ideia arquivada." : "Organização da ideia atualizada.");
      if (changes.status === "archived") closeIdea();
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Não foi possível atualizar a ideia.");
    } finally {
      setBusy(false);
    }
  }

  function openIdea(id: number) {
    setActiveId(id);
    if (window.location.pathname !== `/reel-ideas/${id}`) window.history.pushState({}, "", `/reel-ideas/${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeIdea() {
    setActiveId(null);
    if (window.location.pathname !== "/reel-ideas") window.history.pushState({}, "", "/reel-ideas");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copiada.`);
    } catch {
      notify("Não foi possível copiar automaticamente.");
    }
  }

  if (active) return <IdeaDetail
    idea={active}
    busy={busy}
    onBack={closeIdea}
    onMonitor={onOpenMonitoring}
    onUpdate={updateIdea}
    onCopy={copy}
  />;

  return <>
    <div className="section-head reel-ideas-head">
      <div>
        <div className="eyebrow">Inteligência para comunicação executiva</div>
        <h1>Ideias para Reels</h1>
        <p className="subtitle">Notícias reais transformadas em insumos para a social media desenvolver conteúdos do CEO.</p>
      </div>
      <div className="inline-actions">
        <span className="source-meta">{ideas.filter((idea) => idea.status !== "archived").length} ideia(s) ativa(s)</span>
        <button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy || !aiConfigured} onClick={() => void discover()}>
          {busy ? "Buscando…" : "Buscar próxima ideia"}
        </button>
      </div>
    </div>

    <div className="card reel-ideas-toolbar">
      <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nas ideias…" aria-label="Buscar ideias" />
      <select className="filter" value={pillar} onChange={(event) => setPillar(event.target.value)} aria-label="Filtrar por pilar">
        <option value="all">Todos os pilares</option>
        {PILLARS.map((item) => <option key={item}>{item}</option>)}
      </select>
      <select className="filter" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status">
        <option value="active">Ideias ativas</option>
        <option value="all">Todos os status</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
    </div>

    {error && <div className="notice content-center-error"><span>{error}</span><button className="ghost" onClick={() => void load()}>Tentar novamente</button></div>}
    {loading ? <div className="reel-ideas-grid" aria-label="Carregando ideias">{[1, 2, 3].map((item) => <div className="card reel-idea-card skeleton" key={item} />)}</div>
      : visible.length ? <div className="reel-ideas-grid">{visible.map((idea) => <article className="card reel-idea-card" key={idea.id}>
        <div className="reel-idea-card-top">
          <span className="reel-pillar">{idea.primaryPillar}</span>
          <span className={`status reel-status-${idea.status}`}>{STATUS_LABELS[idea.status]}</span>
        </div>
        <button className="reel-card-title" onClick={() => openIdea(idea.id)}>{idea.title}</button>
        <p>{idea.summary}</p>
        <div className="reel-card-tags">
          <span className={`reel-priority ${idea.priority}`}>{PRIORITY_LABELS[idea.priority]}</span>
          <span>{idea.news.sourceName}</span>
          <span>Score {idea.editorialScore}</span>
        </div>
        <div className="reel-card-footer">
          <div><small>ORIGEM</small><strong>{idea.originType === "executive" ? "Visão Executiva" : "Monitoramento"}</strong></div>
          <div><small>CRIAÇÃO</small><strong>{formatDate(idea.createdAt)}</strong></div>
          <button className="secondary" onClick={() => openIdea(idea.id)}>Abrir ideia</button>
        </div>
      </article>)}</div>
      : <div className="card empty reel-ideas-empty"><strong>Nenhuma ideia encontrada.</strong><span>Selecione uma notícia no Monitoramento ou busque a próxima oportunidade editorial.</span><div className="inline-actions"><button className="secondary" onClick={onOpenMonitoring}>Abrir Monitoramento</button><button className="primary" disabled={!aiConfigured || busy} onClick={() => void discover()}>Buscar próxima ideia</button></div></div>}
  </>;
}

function IdeaDetail({ idea, busy, onBack, onMonitor, onUpdate, onCopy }: {
  idea: ReelIdea;
  busy: boolean;
  onBack: () => void;
  onMonitor: () => void;
  onUpdate: (changes: Partial<Pick<ReelIdea, "status" | "priority" | "responsible">>) => Promise<void>;
  onCopy: (label: string, value: string) => Promise<void>;
}) {
  const copyAll = [
    idea.title,
    `Resumo do acontecimento\n${idea.summary}`,
    `Por que importa para a indústria\n${idea.industryRelevance}`,
    `Abordagem sugerida para o CEO\n${idea.suggestedAngle}`,
    `Sugestão de copy\n${idea.suggestedCopy}`,
    `Fonte\n${idea.news.sourceName} — ${idea.news.title}\n${idea.news.originalUrl}`,
  ].join("\n\n");
  return <div className="reel-idea-detail">
    <div className="reel-detail-topbar">
      <button className="ghost" onClick={onBack}>← Voltar para Ideias</button>
      <div className="inline-actions">
        <button className="secondary" onClick={() => void onCopy("Conteúdo", copyAll)}>Copiar tudo</button>
        <button className="danger-ghost" disabled={busy} onClick={() => void onUpdate({ status: "archived" })}>Arquivar</button>
      </div>
    </div>
    <div className="reel-detail-layout">
      <main className="reel-detail-content">
        <div className="eyebrow">Ideia para Reels · conteúdo somente leitura</div>
        <h1>{idea.title}</h1>
        <div className="reel-detail-chips"><span>{idea.primaryPillar}</span>{idea.secondaryPillar && <span>{idea.secondaryPillar}</span>}<span>Score editorial {idea.editorialScore}/100</span></div>

        <section className="reel-readonly-section"><div><span>RESUMO DO ACONTECIMENTO</span><button onClick={() => void onCopy("Resumo", idea.summary)}>Copiar</button></div><p>{idea.summary}</p></section>
        <section className="reel-readonly-section"><div><span>POR QUE IMPORTA PARA A INDÚSTRIA</span><button onClick={() => void onCopy("Relevância", idea.industryRelevance)}>Copiar</button></div><p>{idea.industryRelevance}</p></section>
        <section className="reel-readonly-section"><div><span>ABORDAGEM SUGERIDA PARA O CEO</span><button onClick={() => void onCopy("Abordagem", idea.suggestedAngle)}>Copiar</button></div><p>{idea.suggestedAngle}</p></section>
        <section className="reel-readonly-section reel-copy-section"><div><span>SUGESTÃO DE COPY</span><button onClick={() => void onCopy("Copy", idea.suggestedCopy)}>Copiar</button></div><p>{idea.suggestedCopy}</p></section>

        <section className="reel-source-panel">
          <div className="reel-source-heading"><div><span>NOTÍCIA REAL</span><h2>{idea.news.title}</h2></div><span className="reel-origin-label">{idea.originType === "executive" ? "Visão Executiva" : "Monitoramento"}</span></div>
          <p>{idea.news.excerpt}</p>
          <dl><div><dt>Veículo</dt><dd>{idea.news.sourceName}</dd></div><div><dt>Publicação</dt><dd>{formatDateTime(idea.news.publishedAt)}</dd></div><div><dt>Coleta</dt><dd>{formatDateTime(idea.news.collectedAt)}</dd></div><div><dt>ICP</dt><dd>{idea.news.primaryIcp}</dd></div><div><dt>Região</dt><dd>{idea.news.region}</dd></div><div><dt>Relevância</dt><dd>{idea.news.relevanceScore}/100</dd></div></dl>
          <div className="inline-actions"><a className="primary" href={idea.news.originalUrl} target="_blank" rel="noopener noreferrer">Abrir notícia original ↗</a><button className="secondary" onClick={onMonitor}>Ver no Monitoramento</button></div>
        </section>
      </main>

      <aside className="reel-detail-properties">
        <div className="eyebrow">Propriedades</div>
        <label><span>Status</span><select value={idea.status} disabled={busy} onChange={(event) => void onUpdate({ status: event.target.value as ReelIdeaStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Prioridade</span><select value={idea.priority} disabled={busy} onChange={(event) => void onUpdate({ priority: event.target.value as ReelIdeaPriority })}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Responsável</span><input defaultValue={idea.responsible ?? ""} disabled={busy} placeholder="Não definido" onBlur={(event) => { const next = event.target.value.trim() || null; if (next !== idea.responsible) void onUpdate({ responsible: next }); }} /></label>
        <div className="reel-property-static"><span>Pilar principal</span><strong>{idea.primaryPillar}</strong></div>
        <div className="reel-property-static"><span>Origem</span><strong>{idea.originType === "executive" ? "Visão Executiva" : "Monitoramento"}</strong></div>
        <div className="reel-property-static"><span>Fonte</span><strong>{idea.news.sourceName}</strong></div>
        <div className="reel-property-static"><span>Criada em</span><strong>{formatDateTime(idea.createdAt)}</strong></div>
        <div className="reel-readonly-notice">O título e os textos permanecem bloqueados para preservar a rastreabilidade da notícia e da análise editorial.</div>
      </aside>
    </div>
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
