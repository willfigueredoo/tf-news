"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AuthorityContribution, AuthorityScore, SeoApiAction, SeoModuleState, SeoSite } from "../types";

export function AuthorityOverview({
  authority,
  site,
  state,
  aiConfigured,
  busy,
  execute,
  notify,
}: {
  authority: AuthorityScore | null;
  site: SeoSite | null;
  state: SeoModuleState;
  aiConfigured: boolean;
  busy: boolean;
  execute: <T>(action: SeoApiAction) => Promise<T>;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const insights = useMemo(() => extractAnalysisInsights(authority), [authority]);

  async function run(action: SeoApiAction, success: string) {
    try {
      await execute(action);
      notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : "A ação não foi concluída.");
    }
  }

  if (!site) {
    return <div className="seo-view">
      <div className="card empty">
        <strong>Propriedade principal não configurada</strong>
        A migration inicial da Inteligência SEO deve cadastrar a TransFAST antes da primeira sincronização.
      </div>
    </div>;
  }

  return <div className="seo-view" aria-label="Visão geral da autoridade digital">
    <StateNotice state={state} site={site} aiConfigured={aiConfigured} />

    {authority ? <section className="card seo-authority-card">
      <div className="seo-score-column">
        <div className="eyebrow">TF Authority Score</div>
        <div className="seo-score"><strong>{authority.value}</strong><span>/ 100</span></div>
        <div className="seo-evolution">
          <span aria-hidden="true">{(authority.evolution ?? 0) >= 0 ? "↗" : "↘"}</span>
          <div><small>Evolução</small><strong>{formatEvolution(authority.evolution)}</strong></div>
        </div>
        <p>{authority.methodology}</p>
        <div className="content-meta">Confiança {Math.round(authority.confidence * 100)}% · calculado em {formatDateTime(authority.updatedAt)}</div>
      </div>
      <div className="seo-authority-content">
        <div className="seo-signal-heading">
          <div><div className="eyebrow">Composição do índice</div><h2>Sinais disponíveis, sem métricas simuladas.</h2></div>
          <button className="secondary" type="button" disabled={busy || !site.lastSyncAt} onClick={() => void run({ action: "refresh_intelligence", forceAi: true }, "Análise atualizada com os dados mais recentes.")}>
            {busy ? "Atualizando…" : "Atualizar análise"}
          </button>
        </div>
        <div className="seo-signal-list">{authority.contributions.map((signal) => <div className="seo-signal" key={signal.id}>
          <div className="seo-signal-meta"><strong>{signal.label}</strong><span>{signalStatus(signal.status, signal.effectiveWeight)}</span></div>
          {signal.score === null
            ? <div className="seo-signal-unavailable">{signal.status === "not_connected" ? "Não conectado" : "Análise pendente"}</div>
            : <><div className="seo-signal-track" aria-label={`${signal.label}: ${signal.score} de 100`}><i style={{ width: `${signal.score}%` }} /></div><b>{signal.score}</b></>}
          <p>{signal.description}</p>
        </div>)}</div>
      </div>
    </section> : <section className="card empty">
      <strong>Aguardando o primeiro cálculo</strong>
      Sincronize o acervo publicado da TransFAST para calcular o TF Authority Score com dados reais.
      <button className="primary" type="button" disabled={busy} onClick={() => void run({ action: "sync_site" }, "Acervo TransFAST sincronizado e score calculado.")}>
        {busy ? "Sincronizando…" : "Sincronizar Blog TransFAST"}
      </button>
    </section>}

    {authority && <section className="seo-summary">
      <div className="eyebrow">Leitura executiva</div>
      <blockquote>{authority.summary || deterministicSummary(authority)}</blockquote>
      <span>{authority.analysis
        ? `Análise estruturada pelo ${authority.analysis.provider} · ${authority.analysis.model} · ${formatDateTime(authority.analysis.createdAt)}`
        : aiConfigured ? "A leitura qualitativa do Gemini está pendente." : "Gemini indisponível; leitura baseada somente no TF News Engine."}</span>
    </section>}

    {authority && <div className="seo-insight-columns">
      <InsightList title="Pontos fortes" items={insights.strengths.length ? insights.strengths : authority.positiveFactors.map(asInsight)} />
      <InsightList title="Pontos de atenção" items={insights.attention.length ? insights.attention : authority.negativeFactors.map(asInsight)} accent />
    </div>}

    <section className="card seo-site-panel">
      <div className="panel-title">
        <div><div className="eyebrow">Propriedade monitorada</div><h2>{site.name}</h2><small>{site.blogUrl}</small></div>
        <div className="inline-actions">
          <button className="ghost" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Fechar edição" : "Editar configuração"}</button>
          <button className="primary" type="button" disabled={busy} onClick={() => void run({ action: "sync_site" }, "Acervo TransFAST sincronizado.")}>{busy ? "Sincronizando…" : "Sincronizar agora"}</button>
        </div>
      </div>
      <div className="seo-site-stats">
        <span><small>Artigos sincronizados</small><strong>{site.articlesSynced}</strong></span>
        <span><small>Última sincronização</small><strong>{site.lastSyncAt ? formatDateTime(site.lastSyncAt) : "Ainda não executada"}</strong></span>
        <span><small>Método</small><strong>{sourceLabel(site.discoveryMethod)}</strong></span>
        <span><small>Status</small><strong>{siteStatus(site.status)}</strong></span>
      </div>
      {site.lastError && <div className="notice error">{site.lastError}</div>}
      {editing && <SiteForm site={site} busy={busy} onCancel={() => setEditing(false)} onSave={async (action) => {
        await run(action, "Configuração da propriedade atualizada.");
        setEditing(false);
      }} />}
    </section>
  </div>;
}

function SiteForm({ site, busy, onCancel, onSave }: {
  site: SeoSite;
  busy: boolean;
  onCancel: () => void;
  onSave: (action: SeoApiAction) => Promise<void>;
}) {
  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain);
  const [blogUrl, setBlogUrl] = useState(site.blogUrl);
  const [wordpressApiUrl, setWordpressApiUrl] = useState(site.wordpressApiUrl ?? "");
  const [sitemapUrl, setSitemapUrl] = useState(site.sitemapUrl ?? "");
  const [rssUrl, setRssUrl] = useState(site.rssUrl ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    void onSave({
      action: "update_site",
      name,
      domain,
      blogUrl,
      wordpressApiUrl: wordpressApiUrl || null,
      sitemapUrl: sitemapUrl || null,
      rssUrl: rssUrl || null,
    });
  }

  return <form className="seo-config-form" onSubmit={submit}>
    <label><span className="label">Nome</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} required /></label>
    <label><span className="label">Domínio</span><input className="field" type="url" value={domain} onChange={(event) => setDomain(event.target.value)} required /></label>
    <label><span className="label">Blog</span><input className="field" type="url" value={blogUrl} onChange={(event) => setBlogUrl(event.target.value)} required /></label>
    <label><span className="label">WordPress REST API</span><input className="field" type="url" value={wordpressApiUrl} onChange={(event) => setWordpressApiUrl(event.target.value)} /></label>
    <label><span className="label">Sitemap</span><input className="field" type="url" value={sitemapUrl} onChange={(event) => setSitemapUrl(event.target.value)} /></label>
    <label><span className="label">RSS</span><input className="field" type="url" value={rssUrl} onChange={(event) => setRssUrl(event.target.value)} /></label>
    <div className="inline-actions"><button className="ghost" type="button" onClick={onCancel}>Cancelar</button><button className="primary" type="submit" disabled={busy}>Salvar configuração</button></div>
  </form>;
}

function StateNotice({ state, site, aiConfigured }: { state: SeoModuleState; site: SeoSite; aiConfigured: boolean }) {
  if (state === "ready") return null;
  const message = state === "awaiting_first_sync"
    ? "Execute a primeira sincronização para importar o acervo publicado da TransFAST."
    : state === "analysis_pending"
      ? "O acervo está sincronizado. O primeiro cálculo de autoridade ainda está pendente."
      : state === "sync_error"
        ? `A última sincronização falhou${site.lastError ? `: ${site.lastError}` : "."}`
        : state === "gemini_unavailable" || !aiConfigured
          ? "O TF News Engine está disponível, mas a análise qualitativa do Gemini não está configurada."
          : "A Inteligência SEO está atualizando os dados.";
  return <div className="notice">{message}</div>;
}

function InsightList({ title, items, accent = false }: { title: string; items: Array<{ title: string; description: string }>; accent?: boolean }) {
  return <section className={`card seo-insight-list ${accent ? "accent" : ""}`}>
    <div className="panel-title"><h2>{title}</h2><small>{items.length} sinal(is)</small></div>
    {items.length ? items.map((item, index) => <div className="seo-insight-row" key={`${item.title}-${index}`}><span aria-hidden="true">{accent ? "↗" : "✓"}</span><div><strong>{item.title}</strong><p>{item.description}</p></div></div>)
      : <div className="empty compact">Ainda não há sinais suficientes neste grupo.</div>}
  </section>;
}

function extractAnalysisInsights(authority: AuthorityScore | null) {
  const payload = authority?.analysis?.payload;
  return {
    strengths: parseInsightArray(payload?.strengths),
    attention: parseInsightArray(payload?.attentionPoints),
  };
}

function parseInsightArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const title = "title" in item && typeof item.title === "string" ? item.title : "";
    const description = "description" in item && typeof item.description === "string" ? item.description : "";
    return title && description ? [{ title, description }] : [];
  });
}

function asInsight(value: string) {
  return { title: value, description: value };
}

function deterministicSummary(authority: AuthorityScore) {
  const count = Number(authority.metrics.articleCount ?? 0);
  const recent = Number(authority.metrics.articlesLast30Days ?? 0);
  return `A leitura atual considera ${count} artigo(s) publicado(s), com ${recent} publicação(ões) nos últimos 30 dias. O score reflete apenas os sinais disponíveis no TF News.`;
}

function signalStatus(status: AuthorityContribution["status"], weight: number) {
  if (status === "not_connected") return "Não conectado";
  if (status === "pending") return "Pendente";
  return `${weight}% do índice disponível`;
}

function formatEvolution(value: number | null) {
  if (value === null) return "Primeira medição";
  if (value === 0) return "Sem variação";
  return `${value > 0 ? "+" : ""}${value} desde a medição anterior`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function sourceLabel(value: string) {
  if (value === "wordpress_rest") return "WordPress REST";
  if (value === "sitemap") return "Sitemap";
  if (value === "rss") return "RSS";
  return value || "Não identificado";
}

function siteStatus(value: string) {
  if (value === "ready") return "Dados atualizados";
  if (value === "error") return "Erro de sincronização";
  return "Aguardando sincronização";
}
