"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ICP_CATALOG } from "../lib/editorial";

type View = "Painel" | "Monitoramento" | "Criar Conteúdo" | "Conteúdos" | "Configurações";
type News = { id: number; title: string; originalUrl: string; sourceName: string; publishedAt: string; collectedAt: string; excerpt: string; region: string; logisticsImpact: "low" | "medium" | "high"; relevanceScore: number; status: string; topics: string[]; icps: string[]; classificationReason: string };
type Source = { id: number; name: string; domain: string; feedUrl: string; websiteUrl: string | null; reliabilityScore: number; active: boolean; lastCollectedAt: string | null; lastError: string | null };
type Brief = { id: number; title: string; summary: string; primaryIcp: string; secondaryIcps: string[]; topics: string[]; regions: string[]; importance: string; opportunity: string; logisticsImpact: string; suggestedTitle: string; alternativeTitles: string[]; structure: string[]; warnings: string[] };
type Article = { id: number; briefId: number; title: string; slug: string; excerpt: string; content: string; primaryKeyword: string; status: string; qualityScore: number; createdAt: string; updatedAt: string; wordpressPostId?: number | null; wordpressUrl?: string | null; wordpressStatus?: string | null };

const VIEWS: { name: View; icon: string }[] = [
  { name: "Painel", icon: "⌂" }, { name: "Monitoramento", icon: "◉" }, { name: "Criar Conteúdo", icon: "✦" }, { name: "Conteúdos", icon: "▤" }, { name: "Configurações", icon: "⚙" },
];

const DEMO_NEWS: News[] = [
  { id: -1, title: "Nova projeção de safra amplia atenção sobre corredores de escoamento", originalUrl: "#", sourceName: "Prévia TF News", publishedAt: new Date().toISOString(), collectedAt: new Date().toISOString(), excerpt: "Crescimento esperado da produção aumenta a importância do planejamento de capacidade, armazenagem e transporte regional.", region: "Centro-Oeste", logisticsImpact: "high", relevanceScore: 92, status: "demo", topics: ["safra", "logística"], icps: ["Agronegócio"], classificationReason: "Dado demonstrativo para apresentar a experiência do painel." },
  { id: -2, title: "Mercado de fertilizantes acompanha importações e disponibilidade nos portos", originalUrl: "#", sourceName: "Prévia TF News", publishedAt: new Date(Date.now() - 3_600_000 * 5).toISOString(), collectedAt: new Date().toISOString(), excerpt: "Agentes do setor monitoram prazos, estoques e distribuição de insumos para o próximo ciclo produtivo.", region: "Brasil", logisticsImpact: "high", relevanceScore: 88, status: "demo", topics: ["fertilizantes", "importação", "portos"], icps: ["Agronegócio", "Indústria Química"], classificationReason: "Dado demonstrativo para apresentar a experiência do painel." },
  { id: -3, title: "Demanda por resinas exige leitura coordenada de estoques e distribuição", originalUrl: "#", sourceName: "Prévia TF News", publishedAt: new Date(Date.now() - 3_600_000 * 12).toISOString(), collectedAt: new Date().toISOString(), excerpt: "Oscilações na cadeia de matérias-primas podem afetar disponibilidade e planejamento de indústrias transformadoras.", region: "Sudeste", logisticsImpact: "medium", relevanceScore: 79, status: "demo", topics: ["resinas", "distribuição"], icps: ["Termoplásticos", "Indústria Química"], classificationReason: "Dado demonstrativo para apresentar a experiência do painel." },
  { id: -4, title: "Setor de aço revisa expectativas de demanda para o segundo semestre", originalUrl: "#", sourceName: "Prévia TF News", publishedAt: new Date(Date.now() - 3_600_000 * 23).toISOString(), collectedAt: new Date().toISOString(), excerpt: "Movimento pode alterar fluxos entre produtores, distribuidores e consumidores industriais.", region: "Sudeste", logisticsImpact: "medium", relevanceScore: 74, status: "demo", topics: ["aço", "demanda"], icps: ["Aço", "Máquinas e Equipamentos Pesados"], classificationReason: "Dado demonstrativo para apresentar a experiência do painel." },
];

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function relativeDate(value: string) { const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3_600_000)); return hours < 1 ? "agora" : hours < 24 ? `há ${hours}h` : `há ${Math.round(hours / 24)}d`; }
function impactLabel(value: News["logisticsImpact"]) { return value === "high" ? "Alto" : value === "medium" ? "Médio" : "Baixo"; }

export function TFNewsApp({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [view, setView] = useState<View>("Painel");
  const [globalIcp, setGlobalIcp] = useState("Todos os ICPs");
  const [news, setNews] = useState<News[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [impactFilter, setImpactFilter] = useState("all");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState("Fontes");
  const [wpConfigured, setWpConfigured] = useState(false);
  const [objective, setObjective] = useState("Analisar o acontecimento e explicar impactos para operação, distribuição e transporte.");
  const [keyword, setKeyword] = useState("logística B2B");

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3500); }, []);
  const refreshAll = useCallback(async () => {
    try {
      const [newsResponse, sourceResponse, contentResponse, wpResponse] = await Promise.all([fetch("/api/news"), fetch("/api/sources"), fetch("/api/content"), fetch("/api/wordpress")]);
      if (newsResponse.ok) setNews(((await newsResponse.json()) as { news: News[] }).news);
      if (sourceResponse.ok) setSources(((await sourceResponse.json()) as { sources: Source[] }).sources);
      if (contentResponse.ok) setArticles(((await contentResponse.json()) as { articles: Article[] }).articles);
      if (wpResponse.ok) setWpConfigured(((await wpResponse.json()) as { configured: boolean }).configured);
    } catch { notify("A prévia está ativa; os dados persistentes serão carregados quando o banco responder."); }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshAll(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshAll]);

  const displayNews = news.length ? news : DEMO_NEWS;
  const filteredNews = useMemo(() => displayNews.filter((item) => {
    const matchesIcp = globalIcp === "Todos os ICPs" || item.icps.includes(globalIcp);
    const text = `${item.title} ${item.excerpt} ${item.topics.join(" ")}`.toLowerCase();
    const matchesSearch = !search || text.includes(search.toLowerCase());
    const matchesImpact = impactFilter === "all" || item.logisticsImpact === impactFilter;
    return matchesIcp && matchesSearch && matchesImpact;
  }), [displayNews, globalIcp, search, impactFilter]);
  const liveSelected = [...selected].filter((id) => id > 0);

  function chooseView(next: View) { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function toggleNews(id: number) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function startContent() {
    if (!selected.size) { notify("Selecione ao menos uma notícia no monitoramento."); chooseView("Monitoramento"); return; }
    if (!liveSelected.length) { notify("Os itens de prévia não geram conteúdo. Cadastre e colete uma fonte RSS primeiro."); return; }
    chooseView("Criar Conteúdo");
  }

  async function generateBrief() {
    if (!liveSelected.length) return notify("Selecione notícias coletadas de uma fonte RSS.");
    setBusy(true);
    try {
      const response = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "brief", newsIds: liveSelected, icp: globalIcp, objective, primaryKeyword: keyword }) });
      const data = await response.json() as { brief?: Brief; error?: string };
      if (!response.ok || !data.brief) throw new Error(data.error ?? "Não foi possível gerar o briefing.");
      setBrief(data.brief); notify("Briefing editorial criado com fontes rastreáveis.");
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
      notify("Rascunho salvo."); await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao salvar."); } finally { setBusy(false); }
  }

  async function sendWordPress(articleId: number) {
    setBusy(true);
    try {
      const response = await fetch("/api/wordpress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", articleId }) });
      const data = await response.json() as { error?: string; postId?: number };
      if (!response.ok) throw new Error(data.error ?? "Falha ao enviar.");
      notify(`Rascunho #${data.postId} criado no WordPress.`); await refreshAll();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha no WordPress."); } finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">TF</div><div className="brand-name">TF <span>NEWS</span></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="nav" aria-label="Navegação principal">{VIEWS.map((item) => <button key={item.name} className={`nav-button ${view === item.name ? "active" : ""}`} onClick={() => chooseView(item.name)}><span className="nav-icon">{item.icon}</span>{item.name}</button>)}</nav>
        <div className="sidebar-foot"><div className="live-status"><span className="live-dot" /> Monitoramento operacional</div><div className="source-meta" style={{ marginTop: 8 }}>{sources.length} fonte(s) cadastrada(s)</div></div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><div className="crumb">TF News / Inteligência editorial</div><div className="page-name">{view}</div></div>
          <div className="top-actions">
            <select className="global-select" value={globalIcp} onChange={(event) => setGlobalIcp(event.target.value)} aria-label="Filtrar todo o sistema por ICP"><option>Todos os ICPs</option>{ICP_CATALOG.map((icp) => <option key={icp.slug}>{icp.name}</option>)}</select>
            <div className="avatar" title={`${userName} — ${userEmail}`}>{initials(userName)}</div>
          </div>
        </header>
        <div className="content">
          {view === "Painel" && <Dashboard news={filteredNews} realData={news.length > 0} sources={sources} articles={articles} onMonitor={() => chooseView("Monitoramento")} />}
          {view === "Monitoramento" && <Monitoring news={filteredNews} selected={selected} search={search} setSearch={setSearch} impactFilter={impactFilter} setImpactFilter={setImpactFilter} toggleNews={toggleNews} startContent={startContent} demoMode={!news.length} />}
          {view === "Criar Conteúdo" && <CreateContent selectedCount={liveSelected.length} brief={brief} article={article} setArticle={setArticle} objective={objective} setObjective={setObjective} keyword={keyword} setKeyword={setKeyword} busy={busy} generateBrief={generateBrief} generateArticle={generateArticle} saveArticle={saveArticle} onChooseNews={() => chooseView("Monitoramento")} />}
          {view === "Conteúdos" && <Contents articles={articles} busy={busy} wpConfigured={wpConfigured} openArticle={(item) => { setArticle(item); chooseView("Criar Conteúdo"); }} sendWordPress={sendWordPress} />}
          {view === "Configurações" && <Settings tab={settingsTab} setTab={setSettingsTab} sources={sources} wpConfigured={wpConfigured} busy={busy} setBusy={setBusy} notify={notify} refresh={refreshAll} />}
        </div>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Dashboard({ news, realData, sources, articles, onMonitor }: { news: News[]; realData: boolean; sources: Source[]; articles: Article[]; onMonitor: () => void }) {
  const high = news.filter((item) => item.relevanceScore >= 80).length;
  const sent = articles.filter((item) => item.wordpressPostId).length;
  const metrics = [
    { label: "Notícias monitoradas", value: news.length, foot: realData ? "Dados coletados" : "Prévia demonstrativa", icon: "◉" },
    { label: "Prioridade editorial", value: high, foot: "Score acima de 80", icon: "↑" },
    { label: "Conteúdos gerados", value: articles.length, foot: "Rascunhos internos", icon: "✦" },
    { label: "Enviados ao WordPress", value: sent, foot: "Sempre como draft", icon: "↗" },
  ];
  const bars = [42, 61, 48, 74, 56, 88, 69, 95, 82, 62, 76, 90];
  return <>
    <div className="section-head"><div><div className="eyebrow">Visão executiva</div><h1>Mercado em movimento.</h1><p className="subtitle">Sinais relevantes dos segmentos atendidos pela TransFAST, organizados para decisões editoriais mais rápidas.</p></div><button className="primary" onClick={onMonitor}>Ver monitoramento →</button></div>
    {!realData && <div className="notice">Você está vendo dados demonstrativos. Cadastre uma fonte RSS em Configurações para ativar o monitoramento real.</div>}
    <div className="metrics">{metrics.map((metric) => <div className="card metric" key={metric.label}><div className="metric-top"><span>{metric.label}</span><span className="metric-symbol">{metric.icon}</span></div><div className="metric-value">{metric.value}</div><div className="metric-foot">{metric.foot}</div></div>)}</div>
    <div className="dashboard-grid">
      <section className="card panel"><div className="panel-title"><h2>Volume editorial</h2><small>Últimos 12 períodos</small></div><div className="bars">{bars.map((height, index) => <div className="bar-wrap" key={index}><div className={`bar ${height >= 85 ? "hot" : ""}`} style={{ height: `${height}%` }} /><span className="bar-label">{index + 1}</span></div>)}</div></section>
      <section className="card panel"><div className="panel-title"><h2>Fontes</h2><small>{sources.length} ativas</small></div>{sources.length ? sources.slice(0, 4).map((source) => <div className="source-line" key={source.id}><div className="source-logo">{initials(source.name)}</div><div><div className="source-name">{source.name}</div><div className="source-meta">{source.domain}</div></div><span className="source-state">{source.lastError ? "ATENÇÃO" : "ATIVA"}</span></div>) : <div className="empty"><strong>Nenhuma fonte ainda</strong>Cadastre o primeiro feed RSS.</div>}</section>
      <section className="card panel"><div className="panel-title"><h2>Alta relevância</h2><small>Prioridades do dia</small></div><div className="news-list">{news.slice(0, 5).map((item) => <div className="news-row" key={item.id}><span className={`impact-dot ${item.logisticsImpact === "high" ? "high" : ""}`} /><div><div className="news-title">{item.title}</div><div className="news-meta">{item.sourceName} · {relativeDate(item.publishedAt)}</div></div><span className={`score ${item.relevanceScore >= 80 ? "priority" : ""}`}>{item.relevanceScore}</span></div>)}</div></section>
      <section className="card panel"><div className="panel-title"><h2>Temas em evidência</h2><small>Por recorrência</small></div><div className="tags">{[...new Set(news.flatMap((item) => item.topics))].slice(0, 12).map((topic, index) => <span className={`tag ${index < 3 ? "red" : ""}`} key={topic}>{topic}</span>)}</div></section>
    </div>
  </>;
}

function Monitoring({ news, selected, search, setSearch, impactFilter, setImpactFilter, toggleNews, startContent, demoMode }: { news: News[]; selected: Set<number>; search: string; setSearch: (value: string) => void; impactFilter: string; setImpactFilter: (value: string) => void; toggleNews: (id: number) => void; startContent: () => void; demoMode: boolean }) {
  return <><div className="section-head"><div><div className="eyebrow">Curadoria de mercado</div><h1>Monitoramento</h1><p className="subtitle">Classifique, filtre e transforme sinais dos seus mercados em oportunidades editoriais.</p></div><button className="primary" disabled={!selected.size} onClick={startContent}>Gerar conteúdo ({selected.size})</button></div>
    {demoMode && <div className="notice">Modo de apresentação: os itens abaixo ilustram a classificação. A coleta real começa ao cadastrar um RSS.</div>}
    <div className="card toolbar"><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, tema ou palavra-chave…" aria-label="Buscar notícias" /><select className="filter" value={impactFilter} onChange={(event) => setImpactFilter(event.target.value)} aria-label="Filtrar impacto"><option value="all">Todos os impactos</option><option value="high">Impacto alto</option><option value="medium">Impacto médio</option><option value="low">Impacto baixo</option></select><select className="filter" aria-label="Período"><option>Últimos 7 dias</option><option>Hoje</option><option>Últimos 30 dias</option></select></div>
    {!!selected.size && <div className="selection-bar"><span>{selected.size} notícia(s) selecionada(s)</span><button className="primary" onClick={startContent}>Criar pauta →</button></div>}
    <div className="card news-table"><div className="table-head"><span /><span>Notícia</span><span>Fonte / Região</span><span>ICPs e temas</span><span>Score</span><span>Impacto</span></div>{news.length ? news.map((item) => <div className="table-item" key={item.id} title={item.classificationReason}><input className="news-check" type="checkbox" checked={selected.has(item.id)} onChange={() => toggleNews(item.id)} aria-label={`Selecionar ${item.title}`} /><div><div className="item-title">{item.title}</div><div className="item-excerpt">{item.excerpt}</div></div><div><div className="source-name">{item.sourceName}</div><div className="source-meta">{item.region} · {relativeDate(item.publishedAt)}</div></div><div className="tags">{item.icps.slice(0, 2).map((icp) => <span className="tag red" key={icp}>{icp}</span>)}{item.topics.slice(0, 2).map((topic) => <span className="tag" key={topic}>{topic}</span>)}</div><span className={`score ${item.relevanceScore >= 80 ? "priority" : ""}`}>{item.relevanceScore}</span><span className={`impact-badge ${item.logisticsImpact === "high" ? "high" : ""}`}>{impactLabel(item.logisticsImpact)}</span></div>) : <div className="empty"><strong>Nenhum resultado</strong>Ajuste os filtros ou colete uma nova fonte.</div>}</div>
  </>;
}

function CreateContent({ selectedCount, brief, article, setArticle, objective, setObjective, keyword, setKeyword, busy, generateBrief, generateArticle, saveArticle, onChooseNews }: { selectedCount: number; brief: Brief | null; article: Article | null; setArticle: (value: Article) => void; objective: string; setObjective: (value: string) => void; keyword: string; setKeyword: (value: string) => void; busy: boolean; generateBrief: () => void; generateArticle: () => void; saveArticle: () => void; onChooseNews: () => void }) {
  return <><div className="section-head"><div><div className="eyebrow">Fluxo editorial</div><h1>Criar conteúdo</h1><p className="subtitle">Do fato confirmado ao rascunho original, com contexto setorial e foco logístico.</p></div><button className="secondary" onClick={onChooseNews}>← Escolher notícias</button></div>
    <div className="stepper"><span className="step active">Fontes ({selectedCount})</span><span className={`step ${brief ? "active" : ""}`}>Briefing</span><span className={`step ${article ? "active" : ""}`}>Artigo</span><span className="step">WordPress</span></div>
    <div className="workspace"><section className="card form-card"><div className="form-grid"><div className="form-group full"><label className="label" htmlFor="objective">Objetivo editorial</label><textarea id="objective" className="field" value={objective} onChange={(event) => setObjective(event.target.value)} /></div><div className="form-group"><label className="label" htmlFor="keyword">Palavra-chave principal</label><input id="keyword" className="field" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div><div className="form-group"><label className="label" htmlFor="tone">Tom</label><select id="tone" className="field"><option>Executivo e acessível</option><option>Analítico</option><option>Notícia comentada</option></select></div><div className="form-group full"><button className="primary" disabled={busy || !selectedCount} onClick={generateBrief}>{busy ? "Processando…" : brief ? "Regenerar briefing" : "Gerar briefing editorial"}</button></div></div>
      {brief && <div className="brief-box" style={{ marginTop: 18 }}><h3>{brief.suggestedTitle}</h3><p>{brief.summary}</p><div className="tags">{brief.topics.map((topic) => <span className="tag" key={topic}>{topic}</span>)}</div><p><strong>Oportunidade:</strong> {brief.opportunity}</p><p><strong>Impacto logístico:</strong> {brief.logisticsImpact} · <strong>Regiões:</strong> {brief.regions.join(", ")}</p><button className="primary" disabled={busy} onClick={generateArticle}>{busy ? "Gerando…" : "Aprovar briefing e gerar artigo"}</button></div>}
      {article && <div style={{ marginTop: 20 }}><div className="form-group"><label className="label" htmlFor="article-title">Título</label><input id="article-title" className="field" value={article.title} onChange={(event) => setArticle({ ...article, title: event.target.value })} /></div><div className="form-group" style={{ marginTop: 12 }}><label className="label" htmlFor="article-content">Conteúdo HTML</label><textarea id="article-content" className="field editor" value={article.content} onChange={(event) => setArticle({ ...article, content: event.target.value })} /></div><div style={{ display: "flex", gap: 9, marginTop: 12 }}><button className="primary" disabled={busy} onClick={saveArticle}>Salvar rascunho</button><span className="status">Qualidade {article.qualityScore}/100</span></div></div>}
    </section><aside className="card aside-note"><h3>Checklist editorial</h3>{["Fontes rastreáveis presentes", "Fatos separados de análise", "Sem reprodução integral", "CTA contextual e discreto", "Envio protegido como rascunho"].map((item) => <div className="check" key={item}>{item}</div>)}{brief?.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}</aside></div>
  </>;
}

function Contents({ articles, busy, wpConfigured, openArticle, sendWordPress }: { articles: Article[]; busy: boolean; wpConfigured: boolean; openArticle: (article: Article) => void; sendWordPress: (id: number) => void }) {
  return <><div className="section-head"><div><div className="eyebrow">Produção editorial</div><h1>Conteúdos</h1><p className="subtitle">Rascunhos, revisões e envios ao WordPress em um único histórico.</p></div></div><div className="content-list">{articles.length ? articles.map((article) => <article className="card content-item" key={article.id}><div><div className="content-title">{article.title}</div><div className="content-meta">{article.primaryKeyword} · atualizado {relativeDate(article.updatedAt)} · qualidade {article.qualityScore}/100</div><div style={{ marginTop: 8 }}><span className={`status ${article.wordpressPostId ? "sent" : "review"}`}>{article.wordpressPostId ? `WordPress #${article.wordpressPostId}` : "Rascunho interno"}</span></div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}><button className="secondary" onClick={() => openArticle(article)}>Editar</button><button className="primary" disabled={busy || !wpConfigured || Boolean(article.wordpressPostId)} onClick={() => sendWordPress(article.id)}>{article.wordpressPostId ? "Enviado" : "Enviar como draft"}</button></div></article>) : <div className="card empty"><strong>Nenhum conteúdo gerado</strong>Selecione notícias no Monitoramento e crie o primeiro briefing.</div>}</div></>;
}

function Settings({ tab, setTab, sources, wpConfigured, busy, setBusy, notify, refresh }: { tab: string; setTab: (value: string) => void; sources: Source[]; wpConfigured: boolean; busy: boolean; setBusy: (value: boolean) => void; notify: (value: string) => void; refresh: () => Promise<void> }) {
  const tabs = ["Fontes", "ICPs", "WordPress", "Inteligência artificial", "Automação", "Logs"];
  async function addSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), feedUrl: form.get("feedUrl"), websiteUrl: form.get("websiteUrl"), reliabilityScore: Number(form.get("reliabilityScore")) }) });
      const data = await response.json() as { source?: Source; error?: string };
      if (!response.ok || !data.source) throw new Error(data.error ?? "Falha ao cadastrar fonte.");
      notify("Fonte cadastrada. Iniciando a primeira coleta…");
      const collected = await fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: data.source.id }) });
      const result = await collected.json() as { created?: number; duplicates?: number; error?: string };
      if (!collected.ok) throw new Error(result.error ?? "Fonte salva, mas a coleta falhou.");
      notify(`${result.created ?? 0} notícia(s) nova(s); ${result.duplicates ?? 0} duplicada(s) ignorada(s).`); event.currentTarget.reset(); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao cadastrar fonte."); } finally { setBusy(false); }
  }
  async function collect(sourceId: number) {
    setBusy(true); try { const response = await fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId }) }); const data = await response.json() as { created?: number; duplicates?: number; error?: string }; if (!response.ok) throw new Error(data.error ?? "Falha na coleta."); notify(`${data.created} nova(s); ${data.duplicates} duplicada(s) ignorada(s).`); await refresh(); } catch (error) { notify(error instanceof Error ? error.message : "Falha na coleta."); } finally { setBusy(false); }
  }
  async function testWordPress() { setBusy(true); try { const response = await fetch("/api/wordpress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) }); const data = await response.json() as { connected?: boolean; user?: string; error?: string }; if (!response.ok) throw new Error(data.error ?? "Falha na conexão."); notify(`WordPress conectado como ${data.user}.`); } catch (error) { notify(error instanceof Error ? error.message : "Falha na conexão."); } finally { setBusy(false); } }
  return <><div className="section-head"><div><div className="eyebrow">Administração</div><h1>Configurações</h1><p className="subtitle">Fontes, segmentos e integrações do fluxo editorial.</p></div></div><div className="settings-grid"><nav className="card settings-nav" aria-label="Seções de configuração">{tabs.map((item) => <button className={`settings-tab ${tab === item ? "active" : ""}`} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav><section className="card form-card">
    {tab === "Fontes" && <><div className="panel-title"><h2>Cadastrar fonte RSS ou Atom</h2><small>Coleta manual imediata</small></div><form className="form-grid" onSubmit={addSource}><div className="form-group"><label className="label" htmlFor="source-name">Nome</label><input required minLength={2} id="source-name" name="name" className="field" placeholder="Ex.: Portal do setor" /></div><div className="form-group"><label className="label" htmlFor="feed-url">URL do feed</label><input required type="url" id="feed-url" name="feedUrl" className="field" placeholder="https://exemplo.com/feed.xml" /></div><div className="form-group"><label className="label" htmlFor="site-url">Site da fonte</label><input type="url" id="site-url" name="websiteUrl" className="field" placeholder="https://exemplo.com" /></div><div className="form-group"><label className="label" htmlFor="reliability">Confiabilidade</label><input id="reliability" name="reliabilityScore" type="number" min="0" max="100" defaultValue="75" className="field" /></div><div className="form-group full"><button className="primary" disabled={busy}>{busy ? "Validando e coletando…" : "Cadastrar e coletar"}</button></div></form><div style={{ marginTop: 24 }}><div className="panel-title"><h2>Fontes cadastradas</h2><small>{sources.length} total</small></div>{sources.map((source) => <div className="source-line" key={source.id}><div className="source-logo">{initials(source.name)}</div><div><div className="source-name">{source.name}</div><div className="source-meta">{source.feedUrl} · confiança {source.reliabilityScore}</div>{source.lastError && <div className="source-meta" style={{ color: "#b4111d" }}>{source.lastError}</div>}</div><button className="secondary" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => collect(source.id)}>Coletar agora</button></div>)}</div></>}
    {tab === "ICPs" && <><div className="panel-title"><h2>Segmentos monitorados</h2><small>{ICP_CATALOG.length} ativos</small></div>{ICP_CATALOG.map((icp) => <div className="source-line" key={icp.slug}><div className="source-logo">{initials(icp.name)}</div><div><div className="source-name">{icp.name}</div><div className="source-meta">{icp.keywords.slice(0, 5).join(" · ")}</div></div><span className="source-state">ATIVO</span></div>)}</>}
    {tab === "WordPress" && <><div className="panel-title"><h2>WordPress REST API</h2><span className={`status ${wpConfigured ? "sent" : "review"}`}>{wpConfigured ? "Configurado" : "Pendente"}</span></div><div className="notice">As credenciais permanecem somente no servidor. Todo envio é forçado para <strong>draft</strong>; publicação direta é bloqueada.</div><div className="form-grid"><div className="form-group full"><label className="label">Variáveis necessárias</label><div className="brief-box"><code>WORDPRESS_BASE_URL</code><br /><code>WORDPRESS_USERNAME</code><br /><code>WORDPRESS_APPLICATION_PASSWORD</code></div></div><button className="primary" disabled={!wpConfigured || busy} onClick={testWordPress}>Testar conexão</button></div></>}
    {tab === "Inteligência artificial" && <><div className="panel-title"><h2>Camada editorial</h2><span className="status sent">Fallback determinístico ativo</span></div><p className="subtitle">O núcleo atual gera briefing e artigo por regras estruturadas e fontes selecionadas. Um provedor de IA pode ser conectado sem alterar o restante do produto.</p><div className="check">Respostas estruturadas</div><div className="check">Validação antes de salvar</div><div className="check">Sem geração quando faltam fontes</div><div className="check">Limites e custos preparados para configuração</div></>}
    {tab === "Automação" && <><div className="panel-title"><h2>Coleta agendada</h2><span className="status review">Configuração de deploy</span></div><div className="form-grid"><div className="form-group"><label className="label">Frequência</label><select className="field"><option>3 vezes por dia</option><option>2 vezes por dia</option><option>1 vez por dia</option></select></div><div className="form-group"><label className="label">Máximo por fonte</label><input className="field" type="number" defaultValue="30" /></div></div><p className="subtitle">A coleta manual já está operacional. O acionamento externo deve usar segredo de cron no ambiente hospedado.</p></>}
    {tab === "Logs" && <><div className="panel-title"><h2>Histórico operacional</h2><small>Coletas e publicações</small></div><div className="empty"><strong>Logs protegidos no banco</strong>Os resultados de cada coleta são gravados com status, volume processado e erro resumido.</div></>}
  </section></div></>;
}
