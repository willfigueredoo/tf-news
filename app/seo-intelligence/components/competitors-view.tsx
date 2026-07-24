"use client";

import { FormEvent, useMemo, useState } from "react";
import { useEscapeKey } from "../../../lib/use-escape-key";
import type {
  Competitor,
  CompetitorArticle,
  DiscoveredSeoSource,
  SeoApiAction,
  SeoSyncJob,
} from "../types";

export function CompetitorsView({
  competitors,
  busy,
  execute,
  notify,
  onOpenCompetitor,
}: {
  competitors: Competitor[];
  busy: boolean;
  execute: <T>(action: SeoApiAction) => Promise<T>;
  notify: (message: string) => void;
  onOpenCompetitor: (id: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  useEscapeKey(() => setAdding(false), adding && !busy);

  return <div className="seo-view">
    <section className="card seo-competitor-table" aria-label="Produção editorial dos concorrentes">
      <div className="panel-title">
        <div><h2>Transportadoras monitoradas</h2><small>Somente concorrentes cadastrados e confirmados pela TransFAST.</small></div>
        <button className="primary" type="button" onClick={() => setAdding(true)}>Adicionar concorrente</button>
      </div>
      {competitors.length ? <>
        <div className="seo-table-head"><span>Transportadora</span><span>Artigos · 30 dias</span><span>Última publicação</span><span>Status</span></div>
        {competitors.map((competitor) => <button className="seo-competitor-row" type="button" key={competitor.id} onClick={() => onOpenCompetitor(competitor.id)} aria-label={`Abrir análise de ${competitor.name}`}>
          <span><strong>{competitor.name}</strong><small>{competitor.domain}</small></span>
          <b>{competitor.articlesLast30Days}</b>
          <time dateTime={competitor.lastPublishedAt ?? undefined}>{competitor.lastPublishedAt ? formatDate(competitor.lastPublishedAt) : "Sem artigos"}</time>
          <span><i className={`status-pill ${competitor.syncStatus === "error" ? "error" : competitor.active ? "success" : ""}`}>{competitor.active ? syncStatus(competitor.syncStatus) : "Pausada"}</i></span>
        </button>)}
      </> : <div className="empty">
        <strong>Nenhum concorrente cadastrado</strong>
        Adicione apenas transportadoras reais que a TransFAST deseja acompanhar. Nenhum concorrente é criado automaticamente.
      </div>}
    </section>

    {adding && <CompetitorDiscovery busy={busy} execute={execute} notify={notify} onClose={() => setAdding(false)} />}
  </div>;
}

export function CompetitorDetailView({
  competitorId,
  competitors,
  articles,
  busy,
  execute,
  notify,
  onBack,
}: {
  competitorId: number;
  competitors: Competitor[];
  articles: CompetitorArticle[];
  busy: boolean;
  execute: <T>(action: SeoApiAction) => Promise<T>;
  notify: (message: string) => void;
  onBack: () => void;
}) {
  const [deletePending, setDeletePending] = useState(false);
  const selected = competitors.find((competitor) => competitor.id === competitorId) ?? null;
  const selectedArticles = useMemo(
    () => articles.filter((article) => article.competitorId === competitorId),
    [articles, competitorId],
  );
  useEscapeKey(() => setDeletePending(false), deletePending && !busy);

  async function run(action: SeoApiAction, success: string) {
    try {
      await execute(action);
      notify(success);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "A ação não foi concluída.");
      return false;
    }
  }

  if (!selected) {
    return <section className="seo-competitor-detail">
      <button className="seo-competitor-back" type="button" onClick={onBack}>← Voltar para Concorrentes</button>
      <div className="card empty"><strong>Concorrente não encontrado</strong>O cadastro pode ter sido removido ou ainda não está disponível.</div>
    </section>;
  }

  return <section className="seo-competitor-detail" aria-labelledby="seo-competitor-title">
    <button className="seo-competitor-back" type="button" onClick={onBack}>← Voltar para Concorrentes</button>

    <header className="card seo-competitor-detail-head">
      <div>
        <div className="eyebrow">Inteligência competitiva</div>
        <h1 id="seo-competitor-title">{selected.name}</h1>
        <span className="content-meta">{selected.domain} · {selected.articleCount} artigo(s) no acervo</span>
      </div>
      <div className="seo-competitor-actions">
        <button
          className="secondary"
          disabled={busy || !selected.active || isActiveJob(selected.syncJob?.status)}
          onClick={() => void run(
            { action: "sync_competitor", competitorId: selected.id },
            `Sincronização de ${selected.name} iniciada. Você pode continuar usando o TF News.`,
          )}
        >{isActiveJob(selected.syncJob?.status) ? "Sincronizando…" : "Sincronizar"}</button>
        <button className="primary" disabled={busy || !selected.articleCount || isActiveJob(selected.syncJob?.status)} onClick={() => void run({ action: "analyze_competitor", competitorId: selected.id, force: true }, `Análise de ${selected.name} atualizada.`)}>Analisar com Gemini</button>
        <button className="ghost" disabled={busy} onClick={() => void run({ action: "update_competitor", competitorId: selected.id, active: !selected.active }, selected.active ? "Monitoramento pausado." : "Monitoramento ativado.")}>{selected.active ? "Pausar" : "Ativar"}</button>
        <button className="ghost danger" disabled={busy} onClick={() => setDeletePending(true)}>Remover</button>
      </div>
    </header>

    <div className="seo-competitor-detail-grid">
      <section className="card seo-competitor-summary">
          <small>Leitura editorial</small>
          <p>{analysisSummary(selected) || (selected.articleCount
            ? "Os artigos foram coletados. Execute a análise para produzir uma leitura estruturada com o Gemini."
            : "Sincronize uma fonte confirmada antes de solicitar a análise editorial.")}</p>
          {selected.analysis && <div className="content-meta">{selected.analysis.model} · confiança {Math.round((selected.analysis.confidence ?? 0) * 100)}% · {formatDate(selected.analysis.createdAt)}</div>}
      </section>

      <div className="card seo-source-list">
          <div className="panel-title"><h2>Fontes confirmadas</h2><small>{selected.sources.length} fonte(s)</small></div>
          {selected.sources.map((source) => <div className="seo-source-row" key={source.id}>
            <span><strong>{sourceLabel(source.sourceType)}</strong><small>{source.url}</small></span>
            <i className={`status-pill ${source.lastError ? "error" : "success"}`}>{source.lastError ? "Com erro" : source.status}</i>
          </div>)}
      </div>
    </div>

    {selected.syncJob && <SyncProgress job={selected.syncJob} />}
    {selected.lastError && <div className="notice error">Fonte indisponível para coleta automática: {selected.lastError}</div>}

    <section className="card seo-competitor-articles">
      <div className="panel-title"><h2>Artigos recentes</h2><small>{selectedArticles.length} item(ns) carregado(s)</small></div>
      <div className="seo-article-list">{selectedArticles.map((article) => <article key={article.id}>
        <div className="content-meta">{article.publishedAt ? formatDate(article.publishedAt) : "Data não informada"} · {article.topics.join(" · ") || "Tema não classificado"}</div>
        <h3>{article.title}</h3>
        {article.excerpt && <p>{article.excerpt}</p>}
        <div className="inline-actions wrap"><a className="ghost" href={article.url} target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a></div>
      </article>)}</div>
      {!selectedArticles.length && <div className="empty compact">Nenhum artigo concorrente sincronizado ainda.</div>}
    </section>

    {deletePending && <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-competitor-title">
        <div className="eyebrow">Ação permanente</div>
        <h2 id="delete-competitor-title">Remover {selected.name}?</h2>
        <p>Os artigos e análises deste concorrente serão removidos. O acervo da TransFAST, notícias e Kits Editoriais não serão alterados.</p>
        <div className="inline-actions"><button className="ghost" disabled={busy} onClick={() => setDeletePending(false)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void (async () => {
          const removed = await run({ action: "delete_competitor", competitorId: selected.id, confirmation: "delete_competitor" }, "Concorrente removido.");
          if (!removed) return;
          setDeletePending(false);
          onBack();
        })()}>Remover concorrente</button></div>
      </div>
    </div>}
  </section>;
}

function CompetitorDiscovery({ busy, execute, notify, onClose }: {
  busy: boolean;
  execute: <T>(action: SeoApiAction) => Promise<T>;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [sources, setSources] = useState<DiscoveredSeoSource[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [discovered, setDiscovered] = useState(false);

  async function discover(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await execute<{ domain: string; sources: DiscoveredSeoSource[] }>({
        action: "discover_competitor",
        name,
        domain,
        contentUrl: contentUrl || null,
      });
      setSources(result.sources);
      setSelectedUrls(new Set(result.sources.map((source) => source.url)));
      setDiscovered(true);
      if (!result.sources.length) notify("Fonte indisponível para coleta automática. Você pode revisar as URLs informadas e tentar novamente.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível localizar fontes editoriais.");
    }
  }

  async function confirm() {
    const confirmed = sources.filter((source) => selectedUrls.has(source.url));
    if (!confirmed.length) {
      notify("Confirme ao menos uma fonte válida antes de cadastrar o concorrente.");
      return;
    }
    try {
      await execute<{ job?: SeoSyncJob }>({
        action: "save_competitor",
        name,
        domain,
        contentUrl: contentUrl || null,
        notes,
        sources: confirmed.map((source) => ({ sourceType: source.sourceType, url: source.url })),
      });
      notify("Concorrente cadastrado. A sincronização foi iniciada em segundo plano.");
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível cadastrar o concorrente.");
    }
  }

  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className="detail-drawer seo-competitor-drawer" role="dialog" aria-modal="true" aria-labelledby="add-competitor-title">
      <div className="detail-head"><div><div className="eyebrow">Nova fonte competitiva</div><h2 id="add-competitor-title">Adicionar transportadora</h2><span className="content-meta">O sistema localiza fontes por código. Nada é cadastrado sem sua confirmação.</span></div><button className="ghost" type="button" onClick={onClose} disabled={busy}>Fechar</button></div>
      <form className="seo-config-form single" onSubmit={discover}>
        <label><span className="label">Nome da transportadora</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span className="label">Domínio oficial</span><input className="field" type="url" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="https://exemplo.com.br" required /></label>
        <label><span className="label">Blog ou central de notícias (opcional)</span><input className="field" type="url" value={contentUrl} onChange={(event) => setContentUrl(event.target.value)} /></label>
        <label><span className="label">Observações</span><textarea className="field" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Localizando…" : discovered ? "Localizar novamente" : "Localizar fontes"}</button>
      </form>
      {discovered && <section className="seo-discovered-sources">
        <div className="panel-title"><h2>Revisar fontes encontradas</h2><small>{sources.length} resultado(s) válido(s)</small></div>
        {sources.map((source) => <label className="seo-source-choice" key={source.url}>
          <input type="checkbox" checked={selectedUrls.has(source.url)} onChange={() => setSelectedUrls((current) => {
            const next = new Set(current);
            if (next.has(source.url)) next.delete(source.url);
            else next.add(source.url);
            return next;
          })} />
          <span><strong>{sourceLabel(source.sourceType)} · {source.itemCount} item(ns) detectado(s)</strong><small>{source.url}</small><em>{source.detail}</em></span>
        </label>)}
        {!sources.length && <div className="empty compact">Fonte indisponível para coleta automática. Não tentaremos contornar bloqueios, paywalls ou autenticação.</div>}
        <div className="inline-actions"><button className="ghost" type="button" onClick={onClose}>Cancelar</button><button className="primary" type="button" disabled={busy || !selectedUrls.size} onClick={() => void confirm()}>Confirmar e sincronizar</button></div>
      </section>}
    </aside>
  </div>;
}

function SyncProgress({ job }: { job: SeoSyncJob }) {
  const active = isActiveJob(job.status);
  const complete = job.status === "completed";
  const progress = job.progressPercent ?? (complete ? 100 : null);
  return <section className={`seo-sync-progress ${job.status}`} aria-live="polite">
    <div className="seo-sync-progress-head">
      <div><strong>{complete ? "Sincronização concluída" : active ? "Sincronização em andamento" : "Última sincronização"}</strong><small>{job.sourceType ? sourceLabel(job.sourceType) : "Preparando fonte"} · lote {Math.max(1, job.attempts)}</small></div>
      <b>{progress === null ? `${job.processedItems} processados` : `${progress}%`}</b>
    </div>
    <div className="seo-sync-track" aria-hidden="true"><span style={{ width: `${progress ?? Math.min(92, 12 + job.processedItems)}%` }} /></div>
    <div className="seo-sync-metrics">
      <span>{job.processedItems}<small>Processados</small></span>
      <span>{job.inserted}<small>Novos</small></span>
      <span>{job.updated}<small>Atualizados</small></span>
      <span>{job.ignored}<small>Sem alteração</small></span>
    </div>
    {active && <p>O progresso é salvo a cada lote. Você pode fechar esta tela; a próxima execução continuará do último ponto.</p>}
    {job.status === "failed" && job.lastError && <p className="error-text">{job.lastError}</p>}
  </section>;
}

function isActiveJob(status?: string) {
  return Boolean(status && ["queued", "processing", "retry"].includes(status));
}

function analysisSummary(competitor: Competitor) {
  const summary = competitor.analysis?.payload?.summary;
  return typeof summary === "string" ? summary : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function syncStatus(value: string) {
  if (value === "error") return "Com erro";
  if (value === "ready") return "Pronta";
  if (value === "paused") return "Pausada";
  if (value === "queued") return "Na fila";
  if (value === "syncing") return "Sincronizando";
  return "Aguardando coleta";
}

function sourceLabel(value: string) {
  if (value === "wordpress_rest") return "WordPress REST";
  if (value === "sitemap") return "Sitemap";
  if (value === "rss") return "RSS";
  return value;
}
