"use client";

import { useState } from "react";
import { AuthorityOverview } from "./components/authority-overview";
import { CompetitorsView } from "./components/competitors-view";
import { OpportunitiesView } from "./components/opportunities-view";
import { useSeoIntelligence } from "./hooks/use-seo-intelligence";

type SeoTab = "overview" | "competitors" | "opportunities";

const SEO_TABS: Array<{ id: SeoTab; label: string; question: string }> = [
  { id: "overview", label: "Visão Geral", question: "Como está nossa autoridade?" },
  { id: "competitors", label: "Concorrentes", question: "O que as outras transportadoras estão produzindo?" },
  { id: "opportunities", label: "Oportunidades", question: "O que deveríamos produzir agora?" },
];

export function SeoIntelligence({ globalIcp, notify }: { globalIcp: string; notify: (message: string) => void }) {
  const [tab, setTab] = useState<SeoTab>("overview");
  const { data, loading, error, reload } = useSeoIntelligence();
  const active = SEO_TABS.find((item) => item.id === tab)!;

  return <>
    <section className="seo-module-head">
      <div><div className="eyebrow"><span className="signal-pulse" /> Inteligência SEO</div><h1>Autoridade digital, traduzida em decisões editoriais.</h1><p className="subtitle">Como está a autoridade digital da TransFAST e quais oportunidades de conteúdo existem hoje?</p></div>
      <span className="mock-badge">Ambiente demonstrativo</span>
    </section>

    <nav className="seo-tabs" role="tablist" aria-label="Áreas da Inteligência SEO">
      {SEO_TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><strong>{item.label}</strong><span>{item.question}</span></button>)}
    </nav>

    {loading && !data ? <div className="card empty"><strong>Organizando os sinais de autoridade…</strong>Preparando uma leitura clara do cenário editorial.</div>
      : error || !data ? <div className="card empty"><strong>Não foi possível carregar a Inteligência SEO</strong>{error}<button className="secondary" onClick={() => void reload()}>Tentar novamente</button></div>
        : <div role="tabpanel" aria-label={active.label} className="seo-tab-panel">
          {tab === "overview" && <AuthorityOverview authority={data.authority} />}
          {tab === "competitors" && <CompetitorsView competitors={data.competitors} articles={data.competitorArticles} unexploredTopics={data.unexploredTopics} onAction={notify} />}
          {tab === "opportunities" && <OpportunitiesView key={globalIcp} opportunities={data.opportunities} globalIcp={globalIcp} onAction={notify} />}
        </div>}
  </>;
}
