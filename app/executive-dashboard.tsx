"use client";

import { useCallback, useEffect, useState } from "react";

type Dominance = { label: string; count: number; share: number } | null;
type ExecutiveDecision = {
  id: number;
  title: string;
  excerpt: string;
  sourceName: string;
  originalUrl: string;
  publishedAt: string;
  primaryIcp: string;
  region: string;
  readingTimeMinutes: number;
  finalScore: number;
  decisionReason: string;
  opportunity: string;
  commercialImpact: string;
  logisticsReason: string;
  displayLabel?: string;
  ranking: {
    components: {
      editorialScore: number;
      recency: number;
      sourceAuthority: number;
      logisticsImpact: number;
      icpRelevance: number;
      reliability: number;
      trend: number;
    };
  };
};
type ExecutiveOpportunity = Pick<ExecutiveDecision, "id" | "title" | "sourceName" | "primaryIcp" | "finalScore" | "opportunity">;
type ExecutiveSummary = {
  calculatedAt: string;
  scope: { icp: string; filtered: boolean };
  periods: { analyzed: string; relevant: string; highPriority: string; dominance: string; trend: string; newsOfTheDay: string };
  kpis: { analyzed: number; relevant: number; highPriority: number; dominantIcp: Dominance; dominantTopic: Dominance; recurringSource: Dominance };
  newsOfTheDay: ExecutiveDecision | null;
  topFive: ExecutiveOpportunity[];
  decisionMetadata: { deterministic: boolean; calculatedAt: string; universeConsidered: number; temporalWindow: string; scopeIcp: string; excludedStatuses: string[]; tieBreakApplied: string };
  lastKit: { id: number; title: string; status: string; createdAt: string; updatedAt: string; archivedAt: string | null; label: string } | null;
};

export function ExecutiveDashboard({ globalIcp, onMonitor, onLibrary, notify }: {
  globalIcp: string;
  onMonitor: () => void;
  onLibrary: (kitId: number) => void;
  notify: (message: string) => void;
}) {
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/executive-summary?icp=${encodeURIComponent(globalIcp)}`, { cache: "no-store" });
      const data = await response.json() as ExecutiveSummary & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível calcular o Painel Executivo.");
      setSummary(data);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao atualizar o Painel Executivo.");
    } finally {
      setLoading(false);
    }
  }, [globalIcp, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  if (loading && !summary) return <div className="card empty"><strong>Calculando a inteligência editorial…</strong>Consultando o estado atual do Monitoramento.</div>;
  if (!summary) return <div className="card empty"><strong>Painel indisponível</strong>Tente atualizar novamente em instantes.</div>;

  const story = summary.newsOfTheDay;
  const metrics = [
    ["Notícias analisadas", summary.kpis.analyzed, summary.periods.analyzed],
    ["Relevantes", summary.kpis.relevant, summary.periods.relevant],
    ["Alta prioridade", summary.kpis.highPriority, summary.periods.highPriority],
  ] as const;

  return <>
    <section className="dashboard-hero editorial-hero">
      <div>
        <div className="eyebrow"><span className="signal-pulse" /> Inteligência editorial calculada</div>
        <div className="hero-news-label">Notícia do Dia</div>
        <h1>{story?.title ?? "Nenhuma oportunidade editorial no momento"}</h1>
        <p className="subtitle">Selecionada automaticamente com base em impacto, relevância, autoridade da fonte e tendência.</p>
        <p className="hero-scope">Escopo: {summary.scope.icp} <span aria-hidden="true">•</span> Atualizado às {formatTime(summary.calculatedAt)}</p>
      </div>
      <button className="secondary" onClick={onMonitor}>Abrir Monitoramento</button>
    </section>

    <div className="executive-strip">
      {metrics.map(([label, value, period]) => <div key={label}><strong>{value}</strong><span>{label}</span><small>{period}</small></div>)}
      <DominanceMetric label="ICP dominante" value={summary.kpis.dominantIcp} period={summary.periods.dominance} />
      <DominanceMetric label="Tema dominante" value={summary.kpis.dominantTopic} period={summary.periods.dominance} />
      <DominanceMetric label="Fonte mais recorrente" value={summary.kpis.recurringSource} period={summary.periods.dominance} />
    </div>

    {story ? <section className="card day-story">
      <div className="day-story-main">
        <div className="story-kicker"><span>{formatDay(story.publishedAt)}</span><span>{formatTime(story.publishedAt)}</span><span>{story.readingTimeMinutes} min de leitura</span></div>
        <p className="story-deck">{story.excerpt}</p>
        <div className="story-context-grid">
          <div><small>Por que foi escolhida</small><p>{story.decisionReason}</p></div>
          <div><small>Universo considerado</small><p>{summary.decisionMetadata.universeConsidered} candidata(s) · janela de {summary.decisionMetadata.temporalWindow}</p></div>
          <div><small>Critério de desempate</small><p>{summary.decisionMetadata.tieBreakApplied}</p></div>
        </div>
        <div className="decision-grid">
          <div><small>Oportunidade editorial</small><p>{story.opportunity}</p></div>
          <div><small>Impacto comercial</small><p>{story.commercialImpact}</p></div>
          <div><small>Impacto logístico</small><p>{story.logisticsReason}</p></div>
          <div><small>Fonte</small><p>{story.sourceName} · {story.region || "Abrangência nacional"}</p></div>
        </div>
        <div className="inline-actions story-actions">
          <button className="secondary" onClick={onMonitor}>Ver no Monitoramento</button>
          <a className="secondary" href={story.originalUrl} target="_blank" rel="noopener noreferrer">Abrir fonte original ↗</a>
        </div>
      </div>
      <ScoreBreakdown decision={story} />
    </section> : <div className="card empty"><strong>Nenhuma Notícia do Dia no escopo selecionado</strong>Não há candidata válida nas últimas 72 horas.</div>}

    <div className="executive-secondary-grid">
      <section className="editorial-section">
        <div className="panel-title"><h2>Top 5 oportunidades editoriais</h2><small>{summary.periods.newsOfTheDay}</small></div>
        <div className="opportunity-list">{summary.topFive.map((item, index) => <article className="card opportunity-card" key={item.id}>
          <span className="rank">0{index + 1}</span>
          <div><div className="content-title">{item.title}</div><div className="content-meta">{item.sourceName} · {item.primaryIcp}</div><p>{item.opportunity}</p></div>
          <span className={`score ${item.finalScore >= 80 ? "priority" : ""}`}>{item.finalScore}</span>
          <button className="ghost" onClick={onMonitor}>Monitorar</button>
        </article>)}</div>
      </section>
      <aside className="card last-kit-card">
        <div className="eyebrow">Atividade editorial</div>
        <h2>{summary.lastKit?.label ?? "Último Kit gerado no sistema"}</h2>
        {summary.lastKit ? <>
          <strong>{summary.lastKit.title}</strong>
          <p>{formatDate(summary.lastKit.createdAt)} · {statusLabel(summary.lastKit.status)}</p>
          <button className="secondary" onClick={() => onLibrary(summary.lastKit!.id)}>Abrir na Biblioteca</button>
        </> : <p>Nenhum Kit foi gerado ainda.</p>}
      </aside>
    </div>
  </>;
}

function DominanceMetric({ label, value, period }: { label: string; value: Dominance; period: string }) {
  return <div><strong>{value?.label ?? "Sem concentração"}</strong><span>{label}</span><small>{value ? `${value.count} ocorrências · ${value.share}%` : period}</small></div>;
}

function ScoreBreakdown({ decision }: { decision: ExecutiveDecision }) {
  const components = decision.ranking.components;
  const reasons = [
    ["Score Editorial", components.editorialScore],
    ["Recência", components.recency],
    ["Autoridade da fonte", components.sourceAuthority],
    ["Impacto logístico", components.logisticsImpact],
    ["Relevância para ICP", components.icpRelevance],
    ["Confiabilidade", components.reliability],
    ["Tendência", components.trend],
  ] as Array<[string, number]>;
  return <aside className="score-breakdown">
    <div className="score-caption">Score final</div>
    <div className="score-ring"><strong>{decision.finalScore}</strong><span>/ 100</span></div>
    <h3>Componentes determinísticos</h3>
    {reasons.map(([label, value]) => <div className="score-line" key={label}><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><strong>{value}</strong></div>)}
  </aside>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function formatDay(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function statusLabel(value: string) { return value === "draft" ? "Rascunho" : value === "archived" ? "Arquivado" : value; }
