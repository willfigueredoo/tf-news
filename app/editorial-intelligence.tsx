"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "../lib/use-escape-key";

type Decision = {
  id: number;
  title: string;
  excerpt: string;
  content: string;
  sourceName: string;
  originalUrl: string;
  publishedAt: string;
  primaryIcp: string;
  secondaryIcps: string[];
  topics: string[];
  region: string;
  logisticsImpact: "low" | "medium" | "high";
  editorialScore: number;
  classification: string;
  produceContent: boolean;
  decisionReason: string;
  opportunity: string;
  commercialImpact: string;
  logisticsReason: string;
  scoreBreakdown: Record<string, number>;
};

type Intelligence = {
  generatedAt: string;
  summary: {
    analyzed: number;
    relevant: number;
    discarded: number;
    highPriority: number;
    mostImpactedIcp: string | null;
    dominantTopic: string | null;
    commercialOpportunity: string | null;
    contentOpportunity: string | null;
  };
  newsOfTheDay: Decision | null;
  topFive: Decision[];
  all: Decision[];
  radar: Array<{ icp: string; current: number; previous: number; trend: "up" | "stable" | "down" }>;
  insights: Array<{ type: "alert" | "opportunity" | "trend"; title: string; description: string }>;
};

type Kit = {
  id: number;
  newsItemId: number;
  title: string;
  primaryIcp: string;
  editorialScore: number;
  provider: string;
  model: string;
  payload: KitPayload;
  status: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type KitPayload = {
  blog: {
    title: string;
    seoTitle: string;
    slug: string;
    metaDescription: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    excerpt: string;
    html: string;
    category: string;
    tags: string[];
    sources: Array<{ name: string; url: string }>;
  };
  whatsapp: { text: string };
};

type GenerationState = { newsId: number; step: number };
type LibraryFilter = "all" | "favorites" | "pinned" | "active" | "archived";
type LibrarySort = "updated" | "score" | "title";
type LibraryView = "cards" | "list";

type EditorialIntelligenceProps = {
  mode: "overview" | "library" | "radar" | "insights";
  aiConfigured: boolean;
  wordpressBaseUrl: string | null;
  focusNewsId?: number | null;
  onMonitor: () => void;
  notify: (message: string) => void;
};

export function EditorialIntelligence({ mode, aiConfigured, wordpressBaseUrl, focusNewsId, onMonitor, notify }: EditorialIntelligenceProps) {
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [selectedKit, setSelectedKit] = useState<Kit | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<number | null>(null);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [libraryPending, setLibraryPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [intelligenceResponse, kitsResponse] = await Promise.all([fetch("/api/intelligence"), fetch("/api/editorial-kits")]);
      const intelligenceData = await intelligenceResponse.json() as Intelligence & { error?: string };
      if (!intelligenceResponse.ok) throw new Error(intelligenceData.error ?? "Falha ao carregar a decisão editorial.");
      setIntelligence(intelligenceData);
      const kitsData = await kitsResponse.json() as { kits?: Kit[]; code?: string; error?: string };
      if (kitsResponse.ok) {
        setKits(kitsData.kits ?? []);
        setLibraryPending(false);
      } else if (kitsData.code === "schema_pending") {
        setLibraryPending(true);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao carregar a inteligência editorial.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const featured = useMemo(
    () => intelligence?.all.find((item) => item.id === focusNewsId) ?? intelligence?.newsOfTheDay ?? null,
    [focusNewsId, intelligence],
  );

  async function generateKit(newsId: number) {
    if (!aiConfigured) return notify("Configure o Gemini para gerar o Kit Editorial.");
    if (libraryPending) return notify("A Biblioteca Editorial precisa estar disponível para salvar o Kit.");
    setGenerating(newsId);
    setGeneration({ newsId, step: 0 });
    const timers = [
      window.setTimeout(() => setGeneration((current) => current ? { ...current, step: 1 } : current), 450),
      window.setTimeout(() => setGeneration((current) => current ? { ...current, step: 2 } : current), 1_700),
      window.setTimeout(() => setGeneration((current) => current ? { ...current, step: 3 } : current), 3_400),
    ];
    let succeeded = false;
    try {
      const response = await fetch("/api/editorial-kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newsId }),
      });
      const data = await response.json() as { kit?: Kit; error?: string };
      if (!response.ok || !data.kit) throw new Error(data.error ?? "Não foi possível gerar o Kit Editorial.");
      timers.forEach((timer) => window.clearTimeout(timer));
      setGeneration({ newsId, step: 4 });
      setKits((current) => [data.kit as Kit, ...current]);
      setSelectedKit(data.kit);
      await pause(180);
      setGeneration({ newsId, step: 5 });
      succeeded = true;
      notify("Kit Editorial gerado e salvo na Biblioteca.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao gerar o Kit Editorial.");
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setGenerating(null);
      if (succeeded) window.setTimeout(() => setGeneration(null), 700);
      else setGeneration(null);
    }
  }

  async function updateKit(id: number, action: "archive" | "restore" | "duplicate") {
    const response = await fetch("/api/editorial-kits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return notify(data.error ?? "Falha ao atualizar o Kit Editorial.");
    if (action === "archive" && selectedKit?.id === id) setSelectedKit(null);
    notify(action === "duplicate" ? "Kit duplicado." : action === "archive" ? "Kit arquivado." : "Kit restaurado.");
    await load();
  }

  async function saveKit(id: number, payload: KitPayload) {
    const response = await fetch("/api/editorial-kits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "save", payload }),
    });
    const data = await response.json() as { updatedAt?: string; error?: string };
    if (!response.ok || !data.updatedAt) throw new Error(data.error ?? "Não foi possível salvar a revisão.");
    const update = (kit: Kit): Kit => kit.id === id
      ? { ...kit, title: payload.blog.seoTitle, payload, updatedAt: data.updatedAt as string }
      : kit;
    setKits((current) => current.map(update));
    setSelectedKit((current) => current ? update(current) : current);
    notify("Revisão salva na Biblioteca.");
  }

  if (loading && !intelligence) {
    return <div className="card empty"><strong>Preparando a pauta do dia…</strong>Analisando os sinais reais já coletados.</div>;
  }
  if (!intelligence?.all.length) {
    return <>
      <div className="section-head"><div><div className="eyebrow">Inteligência editorial</div><h1>O que merece ser produzido hoje?</h1></div></div>
      <div className="card empty"><strong>Nenhum sinal disponível</strong>Execute uma coleta real para formar a primeira pauta editorial.<br /><button className="primary" style={{ marginTop: 16 }} onClick={onMonitor}>Abrir Monitoramento</button></div>
    </>;
  }

  const drawer = selectedKit && <KitDrawer
    key={selectedKit.id}
    kit={selectedKit}
    wordpressBaseUrl={wordpressBaseUrl}
    onClose={() => setSelectedKit(null)}
    onSave={saveKit}
    onUpdate={updateKit}
    notify={notify}
  />;

  if (mode === "library") return <Library kits={kits} pending={libraryPending} onOpen={setSelectedKit} onUpdate={updateKit} selectedDrawer={drawer} />;
  if (mode === "radar") return <Radar intelligence={intelligence} />;
  if (mode === "insights") return <Insights intelligence={intelligence} />;
  return <ExecutiveOverview
    intelligence={intelligence}
    featured={featured}
    aiConfigured={aiConfigured}
    libraryPending={libraryPending}
    generating={generating}
    generation={generation}
    generateKit={generateKit}
    onMonitor={onMonitor}
    drawer={drawer}
  />;
}

function ExecutiveOverview({ intelligence, featured, aiConfigured, libraryPending, generating, generation, generateKit, onMonitor, drawer }: {
  intelligence: Intelligence;
  featured: Decision | null;
  aiConfigured: boolean;
  libraryPending: boolean;
  generating: number | null;
  generation: GenerationState | null;
  generateKit: (id: number) => void;
  onMonitor: () => void;
  drawer: React.ReactNode;
}) {
  const metrics = [
    ["Notícias analisadas", intelligence.summary.analyzed],
    ["Relevantes", intelligence.summary.relevant],
    ["Alta prioridade", intelligence.summary.highPriority],
    ["Descartáveis", intelligence.summary.discarded],
  ];
  return <>
    <section className="dashboard-hero editorial-hero">
      <div>
        <div className="eyebrow"><span className="signal-pulse" /> Editor-chefe digital</div>
        <h1>Se você produzir apenas um conteúdo hoje, produza este.</h1>
        <p className="subtitle">Decisão editorial explicável, baseada nos sinais reais monitorados — sem consumo automático de IA.</p>
      </div>
      <button className="secondary" onClick={onMonitor}>Ver todas as notícias</button>
    </section>
    <div className="executive-strip">
      {metrics.map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}
      <div><strong>{intelligence.summary.mostImpactedIcp ?? "—"}</strong><span>ICP mais impactado</span></div>
      <div><strong>{intelligence.summary.dominantTopic ?? "—"}</strong><span>Tema dominante</span></div>
    </div>
    {featured && <section className="card day-story">
      <div className="day-story-main">
        <div className="story-kicker"><span>Notícia do dia</span><span>{formatDate(featured.publishedAt)}</span><span>{readingTime(featured.content || featured.excerpt)} min de leitura</span></div>
        <h2>{featured.title}</h2>
        <p className="story-deck">{featured.excerpt}</p>
        <div className="story-context-grid">
          <div><small>Por que foi escolhida</small><p>{featured.decisionReason}</p></div>
          <div><small>Empresas potencialmente afetadas</small><div className="story-pills">{affectedProfiles(featured).map((profile) => <span key={profile}>{profile}</span>)}</div></div>
          <div><small>Segmentos relacionados</small><div className="story-pills">{relatedSegments(featured).map((segment) => <span key={segment}>{segment}</span>)}</div></div>
        </div>
        <div className="decision-grid">
          <div><small>Oportunidade editorial</small><p>{featured.opportunity}</p></div>
          <div><small>Impacto comercial</small><p>{featured.commercialImpact}</p></div>
          <div><small>Impacto logístico</small><p>{featured.logisticsReason}</p></div>
          <div><small>Fonte</small><p>{featured.sourceName} · {featured.region || "Abrangência nacional"}</p></div>
        </div>
        <div className="inline-actions story-actions">
          <button className={`primary ${generating === featured.id ? "is-loading" : ""}`} disabled={!aiConfigured || libraryPending || generating !== null} onClick={() => generateKit(featured.id)}>{generating === featured.id ? "Criando seu Kit…" : "CRIAR CONTEÚDO"}</button>
          <a className="secondary" href={featured.originalUrl} target="_blank" rel="noopener noreferrer">Abrir fonte original ↗</a>
        </div>
        {generation?.newsId === featured.id && <GenerationProgress step={generation.step} />}
        {!aiConfigured && <div className="notice kit-notice">A geração estará disponível assim que a inteligência editorial estiver configurada.</div>}
        {libraryPending && <div className="notice kit-notice">A Biblioteca precisa estar disponível para receber o Kit Editorial.</div>}
      </div>
      <ScoreBreakdown decision={featured} />
    </section>}
    <section className="editorial-section">
      <div className="panel-title"><h2>Top 5 oportunidades editoriais</h2><small>Ranking recalculado com dados persistidos</small></div>
      <div className="opportunity-list">{intelligence.topFive.map((item, index) => <article className="card opportunity-card" key={item.id}>
        <span className="rank">0{index + 1}</span>
        <div><div className="content-title">{item.title}</div><div className="content-meta">{item.sourceName} · {item.primaryIcp}</div><p>{item.opportunity}</p></div>
        <span className={`score ${item.editorialScore >= 80 ? "priority" : ""}`}>{item.editorialScore}</span>
        <button className="ghost" disabled={!aiConfigured || libraryPending || generating !== null} onClick={() => generateKit(item.id)}>Gerar kit</button>
      </article>)}</div>
    </section>
    {drawer}
  </>;
}

function GenerationProgress({ step }: { step: number }) {
  const steps = ["Selecionando notícia", "Gerando Blog", "Gerando WhatsApp", "Validando conteúdo", "Salvando Biblioteca", "Finalizado"];
  return <div className={`generation-progress ${step === steps.length - 1 ? "finished" : ""}`} role="status" aria-live="polite">
    <div className="generation-head"><strong>{step === steps.length - 1 ? "Kit Editorial pronto" : "Criando seu Kit Editorial"}</strong><span>{Math.min(100, Math.round(((step + 1) / steps.length) * 100))}%</span></div>
    <div className="generation-track"><i style={{ width: `${Math.min(100, ((step + 1) / steps.length) * 100)}%` }} /></div>
    <div className="generation-steps">{steps.map((label, index) => <span className={index < step || step === steps.length - 1 ? "complete" : index === step ? "current" : ""} key={label}><i>{index < step || step === steps.length - 1 ? "✓" : index + 1}</i>{label}</span>)}</div>
  </div>;
}

function ScoreBreakdown({ decision }: { decision: Decision }) {
  const reasons = [
    ["Impacto logístico", decision.scoreBreakdown.logistics],
    ["Relevância econômica", decision.scoreBreakdown.economicImportance],
    ["ICP atendido", decision.scoreBreakdown.icpFit],
    ["Autoridade da fonte", decision.scoreBreakdown.sourceAuthority],
  ] as Array<[string, number]>;
  return <aside className="score-breakdown">
    <div className="score-caption">Score editorial</div>
    <div className="score-ring"><strong>{decision.editorialScore}</strong><span>/ 100</span></div>
    <h3>Por que esta notícia foi escolhida?</h3>
    <p className="score-summary">Quatro sinais concentram a força editorial desta pauta.</p>
    {reasons.map(([label, value]) => <div className="score-line" key={label}><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><strong>{value}</strong></div>)}
  </aside>;
}

function Library({ kits, pending, onOpen, onUpdate, selectedDrawer }: {
  kits: Kit[];
  pending: boolean;
  onOpen: (kit: Kit) => void;
  onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => void;
  selectedDrawer: React.ReactNode;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("updated");
  const [view, setView] = useState<LibraryView>("cards");
  const [preferences, setPreferences] = useState<{ favorites: number[]; pinned: number[] }>({ favorites: [], pinned: [] });
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem("tf-news-library-preferences") ?? "{}") as { favorites?: unknown; pinned?: unknown };
        setPreferences({ favorites: numberArray(saved.favorites), pinned: numberArray(saved.pinned) });
      } catch {
        setPreferences({ favorites: [], pinned: [] });
      } finally {
        setPreferencesReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (preferencesReady) window.localStorage.setItem("tf-news-library-preferences", JSON.stringify(preferences));
  }, [preferences, preferencesReady]);

  const filtered = useMemo(() => {
    const term = deferredSearch.trim().toLocaleLowerCase("pt-BR");
    return kits.filter((kit) => {
      const matchesSearch = !term || `${kit.title} ${kit.primaryIcp} ${kit.payload.blog.tags.join(" ")} ${kit.payload.blog.primaryKeyword}`.toLocaleLowerCase("pt-BR").includes(term);
      const matchesFilter = filter === "all"
        || (filter === "favorites" && preferences.favorites.includes(kit.id))
        || (filter === "pinned" && preferences.pinned.includes(kit.id))
        || (filter === "active" && !kit.archivedAt)
        || (filter === "archived" && Boolean(kit.archivedAt));
      return matchesSearch && matchesFilter;
    }).sort((a, b) => {
      const pinDifference = Number(preferences.pinned.includes(b.id)) - Number(preferences.pinned.includes(a.id));
      if (pinDifference) return pinDifference;
      if (sort === "score") return b.editorialScore - a.editorialScore;
      if (sort === "title") return a.title.localeCompare(b.title, "pt-BR");
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }, [deferredSearch, filter, kits, preferences, sort]);

  function togglePreference(kind: "favorites" | "pinned", id: number) {
    setPreferences((current) => ({ ...current, [kind]: current[kind].includes(id) ? current[kind].filter((item) => item !== id) : [...current[kind], id] }));
  }

  const quickFilters: Array<[LibraryFilter, string]> = [["all", "Todos"], ["favorites", "Favoritos"], ["pinned", "Fixados"], ["active", "Ativos"], ["archived", "Arquivados"]];
  return <>
    <div className="section-head">
      <div><div className="eyebrow">Acervo estratégico</div><h1>Biblioteca Editorial</h1><p className="subtitle">Encontre, revise e reutilize seus conteúdos sem sair do fluxo editorial.</p></div>
      <div className="library-count"><strong>{filtered.length}</strong><span>kits encontrados</span></div>
    </div>
    {pending && <div className="notice">A Biblioteca ainda não está disponível. Nenhum dado fictício será exibido.</div>}
    <div className="card library-toolbar">
      <label className="library-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar título, ICP, tag ou palavra-chave…" aria-label="Pesquisar na Biblioteca" /></label>
      <div className="quick-filters" aria-label="Filtros rápidos">{quickFilters.map(([value, label]) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div>
      <div className="library-controls">
        <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)} aria-label="Ordenar Biblioteca"><option value="updated">Mais recentes</option><option value="score">Maior score</option><option value="title">Título A–Z</option></select>
        <div className="view-toggle" aria-label="Visualização"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Visualizar em cards">▦</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="Visualizar em lista">☷</button></div>
      </div>
    </div>
    <div className={`library-grid ${view}`}>{filtered.length ? filtered.map((kit) => <LibraryItem
      kit={kit}
      favorite={preferences.favorites.includes(kit.id)}
      pinned={preferences.pinned.includes(kit.id)}
      onFavorite={() => togglePreference("favorites", kit.id)}
      onPin={() => togglePreference("pinned", kit.id)}
      onOpen={() => onOpen(kit)}
      onUpdate={onUpdate}
      key={kit.id}
    />) : <div className="card empty library-empty"><strong>Nenhum Kit encontrado</strong>{kits.length ? "Ajuste a pesquisa ou os filtros rápidos." : "Gere o primeiro Kit a partir da Notícia do Dia."}</div>}</div>
    {selectedDrawer}
  </>;
}

function LibraryItem({ kit, favorite, pinned, onFavorite, onPin, onOpen, onUpdate }: {
  kit: Kit;
  favorite: boolean;
  pinned: boolean;
  onFavorite: () => void;
  onPin: () => void;
  onOpen: () => void;
  onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => void;
}) {
  return <article className={`card library-item ${kit.archivedAt ? "archived" : ""}`}>
    <div className="library-item-top">
      <div className="library-badges"><span className="status draft">Blog + WhatsApp</span>{kit.archivedAt && <span className="status archived">Arquivado</span>}</div>
      <div className="preference-actions"><button className={favorite ? "active" : ""} onClick={onFavorite} aria-label={favorite ? "Remover dos favoritos" : "Favoritar"} aria-pressed={favorite}>★</button><button className={pinned ? "active" : ""} onClick={onPin} aria-label={pinned ? "Desafixar" : "Fixar"} aria-pressed={pinned}>⌖</button></div>
    </div>
    <button className="library-title" onClick={onOpen}>{kit.title}</button>
    <p>{kit.payload.blog.excerpt}</p>
    <div className="library-meta"><span>{kit.primaryIcp}</span><span>{kit.editorialScore}/100</span><span>{wordCount(kit.payload.blog.html)} palavras</span><span>{formatDate(kit.updatedAt)}</span></div>
    <div className="tags">{kit.payload.blog.tags.slice(0, 4).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
    <div className="library-actions"><button className="secondary" onClick={onOpen}>Abrir editor</button><button className="ghost" onClick={() => onUpdate(kit.id, "duplicate")}>Duplicar</button><button className="ghost" onClick={() => onUpdate(kit.id, kit.archivedAt ? "restore" : "archive")}>{kit.archivedAt ? "Restaurar" : "Arquivar"}</button></div>
  </article>;
}

function Radar({ intelligence }: { intelligence: Intelligence }) {
  return <><div className="section-head"><div><div className="eyebrow">Sinais por mercado</div><h1>Radar Editorial</h1><p className="subtitle">Comparação dos últimos sete dias com o período anterior, usando apenas notícias persistidas.</p></div></div><div className="radar-grid">{intelligence.radar.map((item) => <article className="card radar-card" key={item.icp}><span className={`trend-arrow ${item.trend}`}>{item.trend === "up" ? "↗" : item.trend === "down" ? "↘" : "→"}</span><h2>{item.icp}</h2><strong>{item.current}</strong><p>sinais nos últimos 7 dias · {item.previous} no período anterior</p></article>)}</div></>;
}

function Insights({ intelligence }: { intelligence: Intelligence }) {
  return <><div className="section-head"><div><div className="eyebrow">Leitura executiva</div><h1>Insights</h1><p className="subtitle">Alertas, tendências e oportunidades inferidas por regras transparentes sobre o monitoramento real.</p></div></div><div className="insight-grid">{intelligence.insights.map((item) => <article className={`card insight-card ${item.type}`} key={item.title}><span>{item.type === "alert" ? "Alerta" : item.type === "trend" ? "Tendência" : "Oportunidade"}</span><h2>{item.title}</h2><p>{item.description}</p></article>)}</div></>;
}

function KitDrawer({ kit, wordpressBaseUrl, onClose, onSave, onUpdate, notify }: {
  kit: Kit;
  wordpressBaseUrl: string | null;
  onClose: () => void;
  onSave: (id: number, payload: KitPayload) => Promise<void>;
  onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => Promise<void>;
  notify: (message: string) => void;
}) {
  const [channel, setChannel] = useState<"Blog SEO" | "WhatsApp">("Blog SEO");
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<KitPayload>(() => clonePayload(kit.payload));
  const [saving, setSaving] = useState(false);

  useEscapeKey(() => {
    if (preview) setPreview(false);
    else onClose();
  });

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(kit.payload), [draft, kit.payload]);

  async function save() {
    setSaving(true);
    try {
      await onSave(kit.id, draft);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Não foi possível salvar a revisão.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await writeClipboard(value);
      notify(`${label} copiado.`);
    } catch {
      notify("Não foi possível copiar automaticamente.");
    }
  }

  const wordpressUrl = wordpressBaseUrl ? `${wordpressBaseUrl.replace(/\/$/, "")}/wp-admin/post-new.php` : null;
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="detail-drawer kit-drawer" role="dialog" aria-modal="true" aria-label="Editor do Kit Editorial">
      <div className="detail-head kit-editor-head">
        <div><div className="eyebrow">Kit Editorial #{kit.id} · Revisão</div><h2>{draft.blog.seoTitle}</h2><div className="content-meta">{kit.primaryIcp} · score {kit.editorialScore}/100 · atualizado {formatDate(kit.updatedAt)}</div></div>
        <button className="theme-toggle" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <div className="quick-actions" aria-label="Ações rápidas">
        <button onClick={() => void copy(`${draft.blog.title}\n\n${htmlToText(draft.blog.html)}`, "Blog")}>Copiar Blog</button>
        <button onClick={() => void copy(draft.blog.html, "HTML")}>Copiar HTML</button>
        <button onClick={() => void copy(draft.whatsapp.text, "WhatsApp")}>Copiar WhatsApp</button>
        {wordpressUrl ? <a href={wordpressUrl} target="_blank" rel="noopener noreferrer">Abrir WordPress ↗</a> : <button disabled title="WordPress não configurado">Abrir WordPress</button>}
        <button onClick={() => void onUpdate(kit.id, "duplicate")}>Duplicar Kit</button>
        <button onClick={() => void onUpdate(kit.id, kit.archivedAt ? "restore" : "archive")}>{kit.archivedAt ? "Restaurar Kit" : "Arquivar Kit"}</button>
      </div>
      <div className="kit-tabs"><button className={channel === "Blog SEO" ? "active" : ""} onClick={() => setChannel("Blog SEO")}>Blog SEO</button><button className={channel === "WhatsApp" ? "active" : ""} onClick={() => setChannel("WhatsApp")}>WhatsApp</button></div>
      {channel === "Blog SEO" ? <div className="kit-editor">
        <div className="editor-mode"><strong>Blog SEO</strong><div><button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>Editar</button><button className={preview ? "active" : ""} onClick={() => setPreview(true)}>Pré-visualizar</button></div></div>
        {preview ? <iframe className="kit-preview-frame" title="Pré-visualização segura do Blog" sandbox="" srcDoc={draft.blog.html} /> : <>
          <EditorField label="Título" value={draft.blog.title} onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, title: value } }))} />
          <EditorField label="Título SEO" value={draft.blog.seoTitle} maxLength={70} onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, seoTitle: value } }))} />
          <EditorField label="Meta description" value={draft.blog.metaDescription} maxLength={170} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, metaDescription: value } }))} />
          <EditorField label="Resumo" value={draft.blog.excerpt} maxLength={500} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, excerpt: value } }))} />
          <EditorField label="Conteúdo HTML" value={draft.blog.html} multiline editor onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, html: value } }))} />
        </>}
        <div className="editor-copy-actions"><button className="secondary" onClick={() => void copy(draft.blog.html, "HTML")}>Copiar HTML</button><button className="secondary" onClick={() => void copy(htmlToMarkdown(draft.blog.html), "Markdown")}>Copiar Markdown</button><button className="secondary" onClick={() => void copy(htmlToText(draft.blog.html), "Texto")}>Copiar Texto</button></div>
      </div> : <div className="kit-editor whatsapp-editor">
        <div className="editor-mode"><strong>WhatsApp Comercial</strong><span>{draft.whatsapp.text.length}/700</span></div>
        <textarea className="editor-textarea whatsapp-textarea" value={draft.whatsapp.text} maxLength={700} onChange={(event) => setDraft((current) => ({ ...current, whatsapp: { text: event.target.value } }))} />
        <button className="secondary" onClick={() => void copy(draft.whatsapp.text, "WhatsApp")}>Copiar WhatsApp</button>
      </div>}
      <div className="editor-savebar"><span>{dirty ? "Alterações ainda não salvas" : "Tudo salvo"}</span><button className={`primary ${saving ? "is-loading" : ""}`} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar revisão"}</button></div>
    </aside>
  </div>;
}

function EditorField({ label, value, onChange, maxLength, multiline = false, editor = false }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; multiline?: boolean; editor?: boolean }) {
  return <label className="editor-field"><span><strong>{label}</strong>{maxLength && <small>{value.length}/{maxLength}</small>}</span>{multiline ? <textarea className={`editor-textarea ${editor ? "html-editor" : ""}`} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /> : <input value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function affectedProfiles(decision: Decision) {
  const profiles = decision.primaryIcp === "Agronegócio"
    ? ["Produtores e cooperativas", "Tradings e armazenadores", "Transportadoras e terminais"]
    : [`Empresas de ${decision.primaryIcp}`, "Embarcadores e distribuidores", "Operadores logísticos"];
  return profiles.slice(0, 3);
}

function relatedSegments(decision: Decision) {
  return [...new Set([decision.primaryIcp, ...decision.secondaryIcps, ...decision.topics])].filter(Boolean).slice(0, 5);
}

function readingTime(value: string) {
  return Math.max(1, Math.ceil(value.trim().split(/\s+/).filter(Boolean).length / 220));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function wordCount(html: string) {
  return html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function numberArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && Number(item) > 0) : [];
}

function clonePayload(payload: KitPayload): KitPayload {
  return JSON.parse(JSON.stringify(payload)) as KitPayload;
}

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function htmlToText(html: string) {
  const documentValue = new DOMParser().parseFromString(html, "text/html");
  return (documentValue.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function htmlToMarkdown(html: string) {
  const markdown = html
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");
  const documentValue = new DOMParser().parseFromString(markdown, "text/html");
  return (documentValue.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
