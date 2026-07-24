"use client";

import { FormEvent, useMemo, useState } from "react";
import { useEscapeKey } from "../../../lib/use-escape-key";
import type {
  Competitor,
  CompetitorArticle,
  DiscoveredSeoSource,
  SeoApiAction,
} from "../types";

export function CompetitorsView({
  competitors,
  articles,
  busy,
  execute,
  notify,
}: {
  competitors: Competitor[];
  articles: CompetitorArticle[];
  busy: boolean;
  execute: <T>(action: SeoApiAction) => Promise<T>;
  notify: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Competitor | null>(null);
  const [adding, setAdding] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const selectedArticles = useMemo(
    () => articles.filter((article) => article.competitorId === selected?.id),
    [articles, selected],
  );
  useEscapeKey(() => {
    if (deletePending) setDeletePending(false);
    else if (selected) setSelected(null);
    else setAdding(false);
  }, Boolean(selected || adding || deletePending) && !busy);

  async function run(action: SeoApiAction, success: string) {
    try {
      await execute(action);
      notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : "A ação não foi concluída.");
    }
  }

  return <div className="seo-view">
    <section className="card seo-competitor-table" aria-label="Produção editorial dos concorrentes">
      <div className="panel-title">
        <div><h2>Transportadoras monitoradas</h2><small>Somente concorrentes cadastrados e confirmados pela TransFAST.</small></div>
        <button className="primary" type="button" onClick={() => setAdding(true)}>Adicionar concorrente</button>
      </div>
      {competitors.length ? <>
        <div className="seo-table-head"><span>Transportadora</span><span>Artigos · 30 dias</span><span>Última publicação</span><span>Status</span></div>
        {competitors.map((competitor) => <button className="seo-competitor-row" type="button" key={competitor.id} onClick={() => setSelected(competitor)}>
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

    {selected && <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelected(null); }}>
      <aside className="detail-drawer seo-competitor-drawer" role="dialog" aria-modal="true" aria-labelledby="seo-competitor-title">
        <div className="detail-head"><div><div className="eyebrow">Inteligência competitiva</div><h2 id="seo-competitor-title">{selected.name}</h2><span className="content-meta">{selected.domain} · {selected.articleCount} artigo(s) no acervo</span></div><button className="ghost" onClick={() => setSelected(null)} disabled={busy} aria-label="Fechar análise do concorrente">Fechar</button></div>

        <section className="seo-competitor-summary">
          <small>Leitura editorial</small>
          <p>{analysisSummary(selected) || (selected.articleCount
            ? "Os artigos foram coletados. Execute a análise para produzir uma leitura estruturada com o Gemini."
            : "Sincronize uma fonte confirmada antes de solicitar a análise editorial.")}</p>
          {selected.analysis && <div className="content-meta">{selected.analysis.model} · confiança {Math.round((selected.analysis.confidence ?? 0) * 100)}% · {formatDate(selected.analysis.createdAt)}</div>}
        </section>

        <div className="seo-competitor-actions">
          <button className="secondary" disabled={busy || !selected.active} onClick={() => void run({ action: "sync_competitor", competitorId: selected.id }, `${selected.name} foi sincronizada.`)}>Sincronizar</button>
          <button className="primary" disabled={busy || !selected.articleCount} onClick={() => void run({ action: "analyze_competitor", competitorId: selected.id, force: true }, `Análise de ${selected.name} atualizada.`)}>Analisar com Gemini</button>
          <button className="ghost" disabled={busy} onClick={() => void run({ action: "update_competitor", competitorId: selected.id, active: !selected.active }, selected.active ? "Monitoramento pausado." : "Monitoramento ativado.")}>{selected.active ? "Pausar" : "Ativar"}</button>
          <button className="ghost danger" disabled={busy} onClick={() => setDeletePending(true)}>Remover</button>
        </div>

        {selected.lastError && <div className="notice error">Fonte indisponível para coleta automática: {selected.lastError}</div>}

        <div className="seo-source-list">
          <div className="panel-title"><h2>Fontes confirmadas</h2><small>{selected.sources.length} fonte(s)</small></div>
          {selected.sources.map((source) => <div className="seo-source-row" key={source.id}>
            <span><strong>{sourceLabel(source.sourceType)}</strong><small>{source.url}</small></span>
            <i className={`status-pill ${source.lastError ? "error" : "success"}`}>{source.lastError ? "Com erro" : source.status}</i>
          </div>)}
        </div>

        <div className="panel-title"><h2>Artigos recentes</h2><small>{selectedArticles.length} item(ns) carregado(s)</small></div>
        <div className="seo-article-list">{selectedArticles.map((article) => <article key={article.id}>
          <div className="content-meta">{article.publishedAt ? formatDate(article.publishedAt) : "Data não informada"} · {article.topics.join(" · ") || "Tema não classificado"}</div>
          <h3>{article.title}</h3>
          {article.excerpt && <p>{article.excerpt}</p>}
          <div className="inline-actions wrap"><a className="ghost" href={article.url} target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a></div>
        </article>)}</div>
        {!selectedArticles.length && <div className="empty compact">Nenhum artigo concorrente sincronizado ainda.</div>}
      </aside>
    </div>}

    {deletePending && selected && <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-competitor-title">
        <div className="eyebrow">Ação permanente</div>
        <h2 id="delete-competitor-title">Remover {selected.name}?</h2>
        <p>Os artigos e análises deste concorrente serão removidos. O acervo da TransFAST, notícias e Kits Editoriais não serão alterados.</p>
        <div className="inline-actions"><button className="ghost" disabled={busy} onClick={() => setDeletePending(false)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void (async () => {
          await run({ action: "delete_competitor", competitorId: selected.id, confirmation: "delete_competitor" }, "Concorrente removido.");
          setDeletePending(false);
          setSelected(null);
        })()}>Remover concorrente</button></div>
      </div>
    </div>}
  </div>;
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
      const result = await execute<{ syncError?: string | null }>({
        action: "save_competitor",
        name,
        domain,
        contentUrl: contentUrl || null,
        notes,
        sources: confirmed.map((source) => ({ sourceType: source.sourceType, url: source.url })),
      });
      notify(result.syncError ? `Concorrente cadastrado. A primeira coleta requer atenção: ${result.syncError}` : "Concorrente cadastrado e primeira sincronização concluída.");
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
  if (value === "syncing") return "Sincronizando";
  return "Aguardando coleta";
}

function sourceLabel(value: string) {
  if (value === "wordpress_rest") return "WordPress REST";
  if (value === "sitemap") return "Sitemap";
  if (value === "rss") return "RSS";
  return value;
}
