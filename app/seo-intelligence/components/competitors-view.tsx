"use client";

import { useMemo, useState } from "react";
import { useEscapeKey } from "../../../lib/use-escape-key";
import type { Competitor, CompetitorArticle } from "../types";

export function CompetitorsView({ competitors, articles, unexploredTopics, onAction }: {
  competitors: Competitor[];
  articles: CompetitorArticle[];
  unexploredTopics: string[];
  onAction: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Competitor | null>(null);
  const selectedArticles = useMemo(() => articles.filter((article) => article.competitorId === selected?.id), [articles, selected]);
  useEscapeKey(() => setSelected(null), Boolean(selected));

  return <div className="seo-view">
    <section className="card seo-competitor-table" aria-label="Produção editorial dos concorrentes">
      <div className="seo-table-head"><span>Transportadora</span><span>Artigos · 30 dias</span><span>Última publicação</span><span>Principais temas</span></div>
      {competitors.map((competitor) => <button className="seo-competitor-row" type="button" key={competitor.id} onClick={() => setSelected(competitor)}>
        <span><strong>{competitor.name}</strong><small>{competitor.domain}</small></span>
        <b>{competitor.articlesLast30Days}</b>
        <time dateTime={competitor.lastPublishedAt}>{formatDate(competitor.lastPublishedAt)}</time>
        <span className="tags">{competitor.mainTopics.map((topic) => <i className="tag" key={topic}>{topic}</i>)}</span>
      </button>)}
    </section>

    <section className="card seo-unexplored">
      <div><div className="eyebrow">Lacunas editoriais</div><h2>Temas não explorados pela TransFAST</h2><p>Assuntos encontrados no universo competitivo, ainda sem cobertura proporcional no acervo próprio.</p></div>
      <div className="seo-topic-actions">{unexploredTopics.map((topic) => <div key={topic}><strong>{topic}</strong><button className="ghost" onClick={() => onAction(`Pauta “${topic}” preparada para futura integração.`)}>Criar pauta</button></div>)}</div>
    </section>

    {selected && <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <aside className="detail-drawer seo-competitor-drawer" role="dialog" aria-modal="true" aria-labelledby="seo-competitor-title">
        <div className="detail-head"><div><div className="eyebrow">Inteligência competitiva</div><h2 id="seo-competitor-title">{selected.name}</h2><span className="content-meta">{selected.domain} · {selected.articlesLast30Days} artigos em 30 dias</span></div><button className="ghost" onClick={() => setSelected(null)} aria-label="Fechar análise do concorrente">Fechar</button></div>
        <div className="seo-competitor-summary"><small>Resumo editorial · Gemini futuro</small><p>{selected.editorialSummary}</p></div>
        <div className="panel-title"><h2>Artigos recentes</h2><small>{selectedArticles.length} itens demonstrativos</small></div>
        <div className="seo-article-list">{selectedArticles.map((article) => <article key={article.id}>
          <div className="content-meta">{formatDate(article.publishedAt)} · {article.topics.join(" · ")}</div>
          <h3>{article.title}</h3>
          <p>{article.excerpt}</p>
          <div className="inline-actions wrap"><a className="ghost" href={article.url} target="_blank" rel="noopener noreferrer">Abrir ↗</a><button className="ghost" onClick={() => onAction(`Comparação de “${article.title}” preparada.`)}>Comparar</button><button className="secondary" onClick={() => onAction(`Pauta semelhante a “${article.title}” preparada.`)}>Criar pauta semelhante</button><button className="primary" onClick={() => onAction("A geração será conectada à Fila Editorial em uma etapa futura.")}>Gerar Kit Editorial</button></div>
        </article>)}</div>
      </aside>
    </div>}
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
