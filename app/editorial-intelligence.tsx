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
  sourceGovernance: {
    status: "publishable" | "review_recommended" | "additional_confirmation_recommended";
    label: string;
    canGenerate: boolean;
    signals: string[];
    notice: string | null;
  };
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
    introduction: string;
    blocks: Array<{ type: "section"; heading: string; content: string }>;
    conclusion: string;
    html: string;
    category: string;
    tags: string[];
    sources: Array<{ name: string; url: string; title?: string | null; publisher?: string | null; sourceId?: number | null; sourceType?: string | null; primaryOrSecondary?: "primary" | "secondary" | "contextual" | null; authorityLevel?: "high" | "medium" | "low" | null; publishedAt?: string | null }>;
  };
  whatsapp: { text: string };
};

type LibraryFilter = "all" | "favorites" | "pinned" | "active" | "archived";
type LibrarySort = "updated" | "score" | "title";
type LibraryView = "cards" | "list";

type EditorialIntelligenceProps = {
  mode: "library" | "radar" | "insights";
  wordpressBaseUrl: string | null;
  initialKitId?: number | null;
  onMonitor: () => void;
  notify: (message: string) => void;
};

export function EditorialIntelligence({ mode, wordpressBaseUrl, initialKitId, onMonitor, notify }: EditorialIntelligenceProps) {
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [selectedKit, setSelectedKit] = useState<Kit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Kit | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [libraryPending, setLibraryPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [intelligenceResponse, kitsResponse] = await Promise.all([
        fetch("/api/intelligence"),
        mode === "library" ? fetch("/api/editorial-kits") : Promise.resolve(null),
      ]);
      const intelligenceData = await intelligenceResponse.json() as Intelligence & { error?: string };
      if (!intelligenceResponse.ok) throw new Error(intelligenceData.error ?? "Falha ao carregar a decisão editorial.");
      setIntelligence(intelligenceData);
      if (kitsResponse) {
        const kitsData = await kitsResponse.json() as { kits?: Kit[]; code?: string; error?: string };
        if (kitsResponse.ok) {
          const loadedKits = kitsData.kits ?? [];
          setKits(loadedKits);
          if (initialKitId) {
            setSelectedKit(loadedKits.find((kit) => kit.id === initialKitId) ?? null);
          }
          setLibraryPending(false);
        } else if (kitsData.code === "schema_pending") {
          setLibraryPending(true);
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao carregar a inteligência editorial.");
    } finally {
      setLoading(false);
    }
  }, [initialKitId, mode, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

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
    const data = await response.json() as { updatedAt?: string; payload?: KitPayload; error?: string };
    if (!response.ok || !data.updatedAt) throw new Error(data.error ?? "Não foi possível salvar a revisão.");
    const savedPayload = data.payload ?? payload;
    const update = (kit: Kit): Kit => kit.id === id
      ? { ...kit, title: savedPayload.blog.seoTitle, payload: savedPayload, updatedAt: data.updatedAt as string }
      : kit;
    setKits((current) => current.map(update));
    setSelectedKit((current) => current ? update(current) : current);
    notify("Revisão salva na Biblioteca.");
    return savedPayload;
  }

  async function deleteKit() {
    if (!deleteTarget || deletePending) return;
    setDeletePending(true);
    try {
      const response = await fetch("/api/editorial-kits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id, confirmation: "delete_permanently" }),
      });
      if (!response.ok) throw new Error("delete_failed");
      const deletedId = deleteTarget.id;
      setKits((current) => current.filter((kit) => kit.id !== deletedId));
      setSelectedKit((current) => current?.id === deletedId ? null : current);
      setDeleteTarget(null);
      notify("Conteúdo excluído permanentemente.");
    } catch {
      notify("Não foi possível excluir o conteúdo. Nenhuma alteração foi realizada.");
    } finally {
      setDeletePending(false);
    }
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

  const selectedKitGovernance = selectedKit
    ? intelligence.all.find((item) => item.id === selectedKit.newsItemId)?.sourceGovernance ?? null
    : null;
  const drawer = selectedKit && <KitDrawer
    key={selectedKit.id}
    kit={selectedKit}
    wordpressBaseUrl={wordpressBaseUrl}
    onClose={() => setSelectedKit(null)}
    onSave={saveKit}
    onUpdate={updateKit}
    onDeleteRequest={setDeleteTarget}
    deleteConfirmationOpen={Boolean(deleteTarget)}
    governance={selectedKitGovernance}
    notify={notify}
  />;

  const deleteDialog = deleteTarget && <DeleteConfirmationModal
    pending={deletePending}
    onCancel={() => { if (!deletePending) setDeleteTarget(null); }}
    onConfirm={() => void deleteKit()}
  />;

  if (mode === "library") return <><Library kits={kits} pending={libraryPending} onOpen={setSelectedKit} onUpdate={updateKit} onDeleteRequest={setDeleteTarget} selectedDrawer={drawer} />{deleteDialog}</>;
  if (mode === "radar") return <><Radar intelligence={intelligence} />{deleteDialog}</>;
  return <><Insights intelligence={intelligence} />{deleteDialog}</>;
}

function Library({ kits, pending, onOpen, onUpdate, onDeleteRequest, selectedDrawer }: {
  kits: Kit[];
  pending: boolean;
  onOpen: (kit: Kit) => void;
  onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => void;
  onDeleteRequest: (kit: Kit) => void;
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
      const matchesFilter = (filter === "all" && !kit.archivedAt)
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
      onDelete={() => onDeleteRequest(kit)}
      key={kit.id}
    />) : <div className="card empty library-empty"><strong>Nenhum Kit encontrado</strong>{kits.length ? "Ajuste a pesquisa ou os filtros rápidos." : "Gere o primeiro Kit a partir da Notícia do Dia."}</div>}</div>
    {selectedDrawer}
  </>;
}

function LibraryItem({ kit, favorite, pinned, onFavorite, onPin, onOpen, onUpdate, onDelete }: {
  kit: Kit;
  favorite: boolean;
  pinned: boolean;
  onFavorite: () => void;
  onPin: () => void;
  onOpen: () => void;
  onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => void;
  onDelete: () => void;
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
    <div className="library-actions"><button className="secondary" onClick={onOpen}>Abrir editor</button><button className="ghost" onClick={() => onUpdate(kit.id, "duplicate")}>Duplicar</button><button className="ghost" onClick={() => onUpdate(kit.id, kit.archivedAt ? "restore" : "archive")}>{kit.archivedAt ? "Restaurar" : "Arquivar"}</button><button className="danger-ghost" onClick={onDelete}>Excluir conteúdo</button></div>
  </article>;
}

function Radar({ intelligence }: { intelligence: Intelligence }) {
  return <><div className="section-head"><div><div className="eyebrow">Sinais por mercado</div><h1>Radar Editorial</h1><p className="subtitle">Comparação dos últimos sete dias com o período anterior, usando apenas notícias persistidas.</p></div></div><div className="radar-grid">{intelligence.radar.map((item) => <article className="card radar-card" key={item.icp}><span className={`trend-arrow ${item.trend}`}>{item.trend === "up" ? "↗" : item.trend === "down" ? "↘" : "→"}</span><h2>{item.icp}</h2><strong>{item.current}</strong><p>sinais nos últimos 7 dias · {item.previous} no período anterior</p></article>)}</div></>;
}

function Insights({ intelligence }: { intelligence: Intelligence }) {
  return <><div className="section-head"><div><div className="eyebrow">Leitura executiva</div><h1>Insights</h1><p className="subtitle">Alertas, tendências e oportunidades inferidas por regras transparentes sobre o monitoramento real.</p></div></div><div className="insight-grid">{intelligence.insights.map((item) => <article className={`card insight-card ${item.type}`} key={item.title}><span>{item.type === "alert" ? "Alerta" : item.type === "trend" ? "Tendência" : "Oportunidade"}</span><h2>{item.title}</h2><p>{item.description}</p></article>)}</div></>;
}

function KitDrawer({ kit, wordpressBaseUrl, onClose, onSave, onUpdate, onDeleteRequest, deleteConfirmationOpen, governance, notify }: {
  kit: Kit;
  wordpressBaseUrl: string | null;
  onClose: () => void;
  onSave: (id: number, payload: KitPayload) => Promise<KitPayload>;
  onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => Promise<void>;
  onDeleteRequest: (kit: Kit) => void;
  deleteConfirmationOpen: boolean;
  governance: Decision["sourceGovernance"] | null;
  notify: (message: string) => void;
}) {
  const [channel, setChannel] = useState<"Blog SEO" | "WhatsApp">("Blog SEO");
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState<KitPayload>(() => clonePayload(kit.payload));
  const [saving, setSaving] = useState(false);

  useEscapeKey(() => {
    if (preview) setPreview(false);
    else onClose();
  }, !deleteConfirmationOpen);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(kit.payload), [draft, kit.payload]);
  const draftHtml = useMemo(() => buildDraftHtml(draft.blog), [draft.blog]);

  async function save() {
    setSaving(true);
    try {
      const savedPayload = await onSave(kit.id, draft);
      setDraft(clonePayload(savedPayload));
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
      {governance?.notice && <div className={`notice kit-notice governance-${governance.status}`}><strong>{governance.label}</strong><br />{governance.notice}</div>}
      <div className="quick-actions" aria-label="Ações rápidas">
        <button onClick={() => void copy(`${draft.blog.title}\n\n${htmlToText(draftHtml)}`, "Blog")}>Copiar Blog</button>
        <button onClick={() => void copy(draftHtml, "HTML")}>Copiar HTML</button>
        <button onClick={() => void copy(draft.whatsapp.text, "WhatsApp")}>Copiar WhatsApp</button>
        {wordpressUrl ? <a href={wordpressUrl} target="_blank" rel="noopener noreferrer">Abrir WordPress ↗</a> : <button disabled title="WordPress não configurado">Abrir WordPress</button>}
        <button onClick={() => void onUpdate(kit.id, "duplicate")}>Duplicar Kit</button>
        <button onClick={() => void onUpdate(kit.id, kit.archivedAt ? "restore" : "archive")}>{kit.archivedAt ? "Restaurar Kit" : "Arquivar Kit"}</button>
        <button className="danger-ghost" onClick={() => onDeleteRequest(kit)}>Excluir conteúdo</button>
      </div>
      <div className="kit-tabs"><button className={channel === "Blog SEO" ? "active" : ""} onClick={() => setChannel("Blog SEO")}>Blog SEO</button><button className={channel === "WhatsApp" ? "active" : ""} onClick={() => setChannel("WhatsApp")}>WhatsApp</button></div>
      {channel === "Blog SEO" ? <div className="kit-editor">
        <div className="editor-mode"><strong>Blog SEO</strong><div><button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>Editar</button><button className={preview ? "active" : ""} onClick={() => setPreview(true)}>Pré-visualizar</button></div></div>
        {preview ? <iframe className="kit-preview-frame" title="Pré-visualização segura do Blog" sandbox="" srcDoc={draftHtml} /> : <>
          <EditorField label="Título" value={draft.blog.title} onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, title: value } }))} />
          <EditorField label="Título SEO" value={draft.blog.seoTitle} maxLength={70} onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, seoTitle: value } }))} />
          <EditorField label="Meta description" value={draft.blog.metaDescription} maxLength={170} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, metaDescription: value } }))} />
          <EditorField label="Resumo" value={draft.blog.excerpt} maxLength={500} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, excerpt: value } }))} />
          <div className="gutenberg-editor" aria-label="Blocos Gutenberg do artigo">
            <div className="gutenberg-editor-head"><div><span>Artigo Gutenberg</span><strong>Copie e revise cada bloco separadamente</strong></div><button className="secondary" onClick={() => void copy(draft.blog.title, "Título")}>Copiar título</button></div>
            <section className="gutenberg-block introduction-block">
              <div className="gutenberg-block-head"><span>Introdução · sem H2</span><button className="ghost" onClick={() => void copy(draft.blog.introduction, "Introdução")}>Copiar Introdução</button></div>
              <EditorField label="Texto de abertura" value={draft.blog.introduction} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, introduction: value } }))} />
            </section>
            {draft.blog.blocks.map((block, index) => <section className="gutenberg-block" key={`${index}-${block.heading}`}>
              <div className="gutenberg-block-head"><span>Bloco {index + 1}</span><div><button className="ghost" onClick={() => void copy(block.heading, "H2")}>Copiar H2</button><button className="ghost" onClick={() => void copy(block.content, "Parágrafo")}>Copiar Parágrafo</button></div></div>
              <EditorField label="H2" value={block.heading} maxLength={120} onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, blocks: current.blog.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, heading: value } : item) } }))} />
              <EditorField label="Conteúdo" value={block.content} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, blocks: current.blog.blocks.map((item, itemIndex) => itemIndex === index ? { ...item, content: value } : item) } }))} />
            </section>)}
            <section className="gutenberg-block conclusion-block">
              <div className="gutenberg-block-head"><span>H2 · Conclusão</span><button className="ghost" onClick={() => void copy(draft.blog.conclusion, "Conclusão")}>Copiar Conclusão</button></div>
              <EditorField label="Texto de conclusão" value={draft.blog.conclusion} multiline onChange={(value) => setDraft((current) => ({ ...current, blog: { ...current.blog, conclusion: value } }))} />
            </section>
          </div>
        </>}
        <div className="editor-copy-actions"><button className="secondary" onClick={() => void copy(draftHtml, "HTML")}>Copiar HTML</button><button className="secondary" onClick={() => void copy(htmlToMarkdown(draftHtml), "Markdown")}>Copiar Markdown</button><button className="secondary" onClick={() => void copy(htmlToText(draftHtml), "Texto")}>Copiar Texto</button></div>
        <details className="kit-sources"><summary>Fontes utilizadas ({draft.blog.sources.length})</summary>{draft.blog.sources.map((source) => <div key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.name}</a><span>{source.publisher || source.name} · {source.sourceType || "não classificada"} · {source.primaryOrSecondary === "primary" ? "Primária" : source.primaryOrSecondary === "secondary" ? "Secundária" : "Contextual"}</span></div>)}</details>
      </div> : <div className="kit-editor whatsapp-editor">
        <div className="editor-mode"><strong>WhatsApp Comercial</strong><span>{draft.whatsapp.text.length}/700</span></div>
        <textarea className="editor-textarea whatsapp-textarea" value={draft.whatsapp.text} maxLength={700} onChange={(event) => setDraft((current) => ({ ...current, whatsapp: { text: event.target.value } }))} />
        <button className="secondary" onClick={() => void copy(draft.whatsapp.text, "WhatsApp")}>Copiar WhatsApp</button>
      </div>}
      <div className="editor-savebar"><span>{dirty ? "Alterações ainda não salvas" : "Tudo salvo"}</span><button className={`primary ${saving ? "is-loading" : ""}`} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar revisão"}</button></div>
    </aside>
  </div>;
}

function DeleteConfirmationModal({ pending, onCancel, onConfirm }: { pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEscapeKey(() => {
    if (!pending) onCancel();
  });

  return <div className="detail-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => { if (!pending && event.target === event.currentTarget) onCancel(); }}>
    <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-kit-title" aria-describedby="delete-kit-description">
      <div className="destructive-mark" aria-hidden="true">!</div>
      <h2 id="delete-kit-title">Excluir conteúdo permanentemente?</h2>
      <p id="delete-kit-description">Esta ação removerá definitivamente este Kit Editorial e seus dados relacionados. Não será possível desfazer.</p>
      <div className="confirmation-actions">
        <button className="secondary" disabled={pending} onClick={onCancel}>Cancelar</button>
        <button className={`danger ${pending ? "is-loading" : ""}`} disabled={pending} onClick={onConfirm}>{pending ? "Excluindo…" : "Excluir permanentemente"}</button>
      </div>
    </section>
  </div>;
}

function EditorField({ label, value, onChange, maxLength, multiline = false, editor = false }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; multiline?: boolean; editor?: boolean }) {
  return <label className="editor-field"><span><strong>{label}</strong>{maxLength && <small>{value.length}/{maxLength}</small>}</span>{multiline ? <textarea className={`editor-textarea ${editor ? "html-editor" : ""}`} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /> : <input value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />}</label>;
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

function buildDraftHtml(blog: KitPayload["blog"]) {
  const sections = blog.blocks.map((block) => `<h2>${escapeHtml(block.heading)}</h2>${structuredTextToHtml(block.content)}`).join("");
  const sources = blog.sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.name)}</a> — ${escapeHtml(source.publisher || source.name)} · ${source.primaryOrSecondary === "primary" ? "Fonte primária" : source.primaryOrSecondary === "secondary" ? "Fonte secundária" : "Fonte contextual"}</li>`).join("");
  return [
    `<p>${escapeHtml(blog.introduction)}</p>`,
    sections,
    "<h2>Conclusão</h2>",
    `<p>${escapeHtml(blog.conclusion)}</p>`,
    `<section data-tf-news-sources="true"><h2>Fontes consultadas</h2><ul>${sources}</ul></section>`,
    "<aside data-tf-news-transparency=\"true\"><p><strong>Transparência editorial</strong></p><p>Este conteúdo foi elaborado a partir de fontes oficiais e veículos jornalísticos de alta credibilidade.</p><p>Seu objetivo é informar e contextualizar fatos relevantes para o setor logístico.</p><p>As interpretações apresentadas são sempre atribuídas às respectivas fontes consultadas.</p></aside>",
  ].join("");
}

function structuredTextToHtml(value: string) {
  return value.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length && lines.every((line) => /^[-•]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${escapeHtml(line.replace(/^[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${escapeHtml(lines.join(" "))}</p>`;
  }).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
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
