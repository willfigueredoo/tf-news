"use client";

import { AuthorityOverview } from "./components/authority-overview";
import { CompetitorCreateView, CompetitorDetailView, CompetitorsView } from "./components/competitors-view";
import { OpportunitiesView } from "./components/opportunities-view";
import { useSeoIntelligence } from "./hooks/use-seo-intelligence";
import type { SeoApiAction } from "./types";

export type SeoTab = "overview" | "competitors" | "opportunities";

const SEO_TABS: Array<{ id: SeoTab; label: string; question: string }> = [
  { id: "overview", label: "Visão Geral", question: "Como está nossa autoridade?" },
  { id: "competitors", label: "Concorrentes", question: "O que as outras transportadoras estão produzindo?" },
  { id: "opportunities", label: "Oportunidades", question: "O que deveríamos produzir agora?" },
];

export function SeoIntelligence({
  globalIcp,
  notify,
  onOpenKit,
  onOpenQueue,
  tab,
  competitorId,
  creatingCompetitor,
  onTabChange,
  onOpenCompetitor,
  onAddCompetitor,
  onBackToCompetitors,
}: {
  globalIcp: string;
  notify: (message: string) => void;
  onOpenKit: (id: number) => void;
  onOpenQueue: (id: number) => void;
  tab: SeoTab;
  competitorId: number | null;
  creatingCompetitor: boolean;
  onTabChange: (tab: SeoTab) => void;
  onOpenCompetitor: (id: number) => void;
  onAddCompetitor: () => void;
  onBackToCompetitors: () => void;
}) {
  const { data, loading, busyAction, error, reload, execute } = useSeoIntelligence();
  const active = SEO_TABS.find((item) => item.id === tab)!;
  const busy = Boolean(busyAction);

  async function run<T>(action: SeoApiAction) {
    return execute<T>(action);
  }

  if (creatingCompetitor) {
    return <CompetitorCreateView busy={busy} execute={run} notify={notify} onBack={onBackToCompetitors} />;
  }

  if (competitorId !== null) {
    if (loading && !data) {
      return <div className="card empty"><strong>Carregando a análise do concorrente…</strong>Consultando artigos, fontes e histórico de sincronização.</div>;
    }
    if (error && !data) {
      return <div className="card empty"><strong>Não foi possível carregar o concorrente</strong>{error}<button className="secondary" onClick={() => void reload()}>Tentar novamente</button></div>;
    }
    return data ? <CompetitorDetailView
      competitorId={competitorId}
      competitors={data.competitors}
      articles={data.competitorArticles}
      busy={busy}
      execute={run}
      notify={notify}
      onBack={onBackToCompetitors}
    /> : null;
  }

  return <>
    <section className="seo-module-head">
      <div><div className="eyebrow"><span className="signal-pulse" /> Inteligência SEO</div><h1>Autoridade digital, traduzida em decisões editoriais.</h1><p className="subtitle">Como está a autoridade digital da TransFAST e quais oportunidades de conteúdo existem hoje?</p></div>
      {data && <span className={`seo-live-state state-${data.state}`}>{stateLabel(data.state)}</span>}
    </section>

    <nav className="seo-tabs" role="tablist" aria-label="Áreas da Inteligência SEO">
      {SEO_TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => onTabChange(item.id)}><strong>{item.label}</strong><span>{item.question}</span></button>)}
    </nav>

    {error && data && <div className="notice error seo-global-error"><span>{error}</span><button className="ghost" type="button" onClick={() => void reload()}>Tentar novamente</button></div>}

    {loading && !data ? <div className="card empty"><strong>Organizando os sinais de autoridade…</strong>Consultando o acervo, concorrentes e oportunidades persistidos.</div>
      : error && !data ? <div className="card empty"><strong>Não foi possível carregar a Inteligência SEO</strong>{error}<button className="secondary" onClick={() => void reload()}>Tentar novamente</button></div>
        : data && <div role="tabpanel" aria-label={active.label} className="seo-tab-panel" aria-busy={busy}>
          {tab === "overview" && <AuthorityOverview authority={data.authority} site={data.site} state={data.state} aiConfigured={data.ai.configured} busy={busy} execute={run} notify={notify} />}
          {tab === "competitors" && <CompetitorsView competitors={data.competitors} onOpenCompetitor={onOpenCompetitor} onAddCompetitor={onAddCompetitor} />}
          {tab === "opportunities" && <OpportunitiesView key={globalIcp} opportunities={data.opportunities} globalIcp={globalIcp} busy={busy} execute={run} notify={notify} onOpenKit={onOpenKit} onOpenQueue={onOpenQueue} />}
        </div>}
  </>;
}

function stateLabel(state: string) {
  if (state === "ready") return "Dados atualizados";
  if (state === "awaiting_first_sync") return "Primeira sincronização pendente";
  if (state === "analysis_pending") return "Análise pendente";
  if (state === "sync_error") return "Sincronização com erro";
  if (state === "gemini_unavailable") return "Gemini indisponível";
  if (state === "not_configured") return "Configuração pendente";
  return "Atualizando";
}
