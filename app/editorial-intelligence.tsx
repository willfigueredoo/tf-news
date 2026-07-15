"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Decision = {
  id: number; title: string; excerpt: string; sourceName: string; originalUrl: string; publishedAt: string; primaryIcp: string;
  topics: string[]; logisticsImpact: "low" | "medium" | "high"; editorialScore: number; classification: string; produceContent: boolean;
  decisionReason: string; opportunity: string; commercialImpact: string; logisticsReason: string;
  scoreBreakdown: Record<string, number>;
};
type Intelligence = {
  generatedAt: string;
  summary: { analyzed: number; relevant: number; discarded: number; highPriority: number; mostImpactedIcp: string | null; dominantTopic: string | null; commercialOpportunity: string | null; contentOpportunity: string | null };
  newsOfTheDay: Decision | null; topFive: Decision[]; all: Decision[];
  radar: Array<{ icp: string; current: number; previous: number; trend: "up" | "stable" | "down" }>;
  insights: Array<{ type: "alert" | "opportunity" | "trend"; title: string; description: string }>;
};
type Kit = { id: number; newsItemId: number; title: string; primaryIcp: string; editorialScore: number; provider: string; model: string; payload: KitPayload; status: string; archivedAt: string | null; createdAt: string; updatedAt: string };
type KitPayload = {
  blog: { title: string; seoTitle: string; slug: string; metaDescription: string; primaryKeyword: string; secondaryKeywords: string[]; excerpt: string; html: string; category: string; tags: string[]; sources: Array<{ name: string; url: string }> };
  whatsapp: { text: string };
};

export function EditorialIntelligence({ mode, aiConfigured, focusNewsId, onMonitor, notify }: { mode: "overview" | "library" | "radar" | "insights"; aiConfigured: boolean; focusNewsId?: number | null; onMonitor: () => void; notify: (message: string) => void }) {
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [selectedKit, setSelectedKit] = useState<Kit | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<number | null>(null);
  const [libraryPending, setLibraryPending] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [intelligenceResponse, kitsResponse] = await Promise.all([fetch("/api/intelligence"), fetch("/api/editorial-kits")]);
      const intelligenceData = await intelligenceResponse.json() as Intelligence & { error?: string };
      if (!intelligenceResponse.ok) throw new Error(intelligenceData.error ?? "Falha ao carregar a decisão editorial.");
      setIntelligence(intelligenceData);
      const kitsData = await kitsResponse.json() as { kits?: Kit[]; code?: string; error?: string };
      if (kitsResponse.ok) { setKits(kitsData.kits ?? []); setLibraryPending(false); }
      else if (kitsData.code === "schema_pending") setLibraryPending(true);
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao carregar a inteligência editorial."); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const featured = useMemo(() => intelligence?.all.find((item) => item.id === focusNewsId) ?? intelligence?.newsOfTheDay ?? null, [focusNewsId, intelligence]);
  const filteredKits = kits.filter((kit) => `${kit.title} ${kit.primaryIcp} ${kit.payload.blog.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()));

  async function generateKit(newsId: number) {
    if (!aiConfigured) return notify("Configure o Gemini para gerar o Kit Editorial.");
    if (libraryPending) return notify("A migration aditiva da Biblioteca Editorial precisa ser aprovada e aplicada.");
    setGenerating(newsId);
    try {
      const response = await fetch("/api/editorial-kits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newsId }) });
      const data = await response.json() as { kit?: Kit; error?: string };
      if (!response.ok || !data.kit) throw new Error(data.error ?? "Não foi possível gerar o Kit Editorial.");
      setKits((current) => [data.kit as Kit, ...current]); setSelectedKit(data.kit); notify("Kit Editorial gerado e salvo na Biblioteca.");
    } catch (error) { notify(error instanceof Error ? error.message : "Falha ao gerar o Kit Editorial."); }
    finally { setGenerating(null); }
  }

  async function updateKit(id: number, action: "archive" | "restore" | "duplicate") {
    const response = await fetch("/api/editorial-kits", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) return notify(data.error ?? "Falha ao atualizar o Kit Editorial.");
    notify(action === "duplicate" ? "Kit duplicado." : action === "archive" ? "Kit arquivado." : "Kit restaurado."); await load();
  }

  if (loading && !intelligence) return <div className="card empty"><strong>Preparando a pauta do dia…</strong>Analisando os sinais reais já coletados.</div>;
  if (!intelligence?.all.length) return <><div className="section-head"><div><div className="eyebrow">Inteligência editorial</div><h1>O que merece ser produzido hoje?</h1></div></div><div className="card empty"><strong>Nenhum sinal disponível</strong>Execute uma coleta real para formar a primeira pauta editorial.<br /><button className="primary" style={{ marginTop: 16 }} onClick={onMonitor}>Abrir Monitoramento</button></div></>;

  if (mode === "library") return <Library kits={filteredKits} search={search} setSearch={setSearch} pending={libraryPending} onOpen={setSelectedKit} onUpdate={updateKit} selected={selectedKit} onClose={() => setSelectedKit(null)} />;
  if (mode === "radar") return <Radar intelligence={intelligence} />;
  if (mode === "insights") return <Insights intelligence={intelligence} />;
  return <ExecutiveOverview intelligence={intelligence} featured={featured} aiConfigured={aiConfigured} libraryPending={libraryPending} generating={generating} generateKit={generateKit} onMonitor={onMonitor} selectedKit={selectedKit} closeKit={() => setSelectedKit(null)} />;
}

function ExecutiveOverview({ intelligence, featured, aiConfigured, libraryPending, generating, generateKit, onMonitor, selectedKit, closeKit }: { intelligence: Intelligence; featured: Decision | null; aiConfigured: boolean; libraryPending: boolean; generating: number | null; generateKit: (id: number) => void; onMonitor: () => void; selectedKit: Kit | null; closeKit: () => void }) {
  const metrics = [
    ["Notícias analisadas", intelligence.summary.analyzed], ["Relevantes", intelligence.summary.relevant],
    ["Alta prioridade", intelligence.summary.highPriority], ["Descartáveis", intelligence.summary.discarded],
  ];
  return <><section className="dashboard-hero editorial-hero"><div><div className="eyebrow"><span className="signal-pulse" /> Editor-chefe digital</div><h1>Se você produzir apenas um conteúdo hoje, produza este.</h1><p className="subtitle">Decisão editorial explicável, baseada nos sinais reais monitorados — sem consumo automático de IA.</p></div><button className="secondary" onClick={onMonitor}>Ver todas as notícias</button></section>
    <div className="executive-strip">{metrics.map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}<div><strong>{intelligence.summary.mostImpactedIcp ?? "—"}</strong><span>ICP mais impactado</span></div><div><strong>{intelligence.summary.dominantTopic ?? "—"}</strong><span>Tema dominante</span></div></div>
    {featured && <section className="card day-story"><div className="day-story-main"><div className="eyebrow">Notícia do dia · Score editorial {featured.editorialScore}/100</div><h2>{featured.title}</h2><p>{featured.excerpt}</p><div className="tags"><span className="tag red">{featured.primaryIcp}</span>{featured.topics.slice(0, 3).map((topic) => <span className="tag" key={topic}>{topic}</span>)}</div><div className="decision-grid"><div><small>Por que importa</small><p>{featured.decisionReason}</p></div><div><small>Oportunidade</small><p>{featured.opportunity}</p></div><div><small>Impacto comercial</small><p>{featured.commercialImpact}</p></div><div><small>Impacto logístico</small><p>{featured.logisticsReason}</p></div></div><div className="inline-actions"><button className={`primary ${generating === featured.id ? "is-loading" : ""}`} disabled={!aiConfigured || libraryPending || generating !== null} onClick={() => generateKit(featured.id)}>{generating === featured.id ? "Gerando kit…" : "GERAR KIT EDITORIAL"}</button><a className="secondary" href={featured.originalUrl} target="_blank" rel="noopener noreferrer">Abrir fonte original ↗</a></div>{!aiConfigured && <div className="notice kit-notice">Gemini ainda não configurado. A decisão editorial permanece disponível; a geração do kit fica bloqueada.</div>}{libraryPending && <div className="notice kit-notice">A Biblioteca está pronta no código, mas depende da migration aditiva ainda não aplicada.</div>}</div><ScoreBreakdown decision={featured} /></section>}
    <section className="editorial-section"><div className="panel-title"><h2>Top 5 oportunidades editoriais</h2><small>Ranking recalculado com dados persistidos</small></div><div className="opportunity-list">{intelligence.topFive.map((item, index) => <article className="card opportunity-card" key={item.id}><span className="rank">0{index + 1}</span><div><div className="content-title">{item.title}</div><div className="content-meta">{item.sourceName} · {item.primaryIcp}</div><p>{item.opportunity}</p></div><span className={`score ${item.editorialScore >= 80 ? "priority" : ""}`}>{item.editorialScore}</span><button className="ghost" disabled={!aiConfigured || libraryPending || generating !== null} onClick={() => generateKit(item.id)}>Gerar kit</button></article>)}</div></section>
    {selectedKit && <KitDrawer kit={selectedKit} onClose={closeKit} />}</>;
}

function ScoreBreakdown({ decision }: { decision: Decision }) {
  const labels: Record<string, string> = { logistics: "Logística", icpFit: "Aderência ao ICP", economicImportance: "Importância econômica", sourceAuthority: "Autoridade da fonte", recency: "Atualidade", commercialPotential: "Potencial comercial", contentPotential: "Potencial de conteúdo", authorityPotential: "Autoridade editorial" };
  return <aside className="score-breakdown"><div className="score-ring"><strong>{decision.editorialScore}</strong><span>/100</span></div>{Object.entries(decision.scoreBreakdown).map(([key, value]) => <div className="score-line" key={key}><span>{labels[key] ?? key}</span><div><i style={{ width: `${value}%` }} /></div><strong>{value}</strong></div>)}</aside>;
}

function Library({ kits, search, setSearch, pending, onOpen, onUpdate, selected, onClose }: { kits: Kit[]; search: string; setSearch: (value: string) => void; pending: boolean; onOpen: (kit: Kit) => void; onUpdate: (id: number, action: "archive" | "restore" | "duplicate") => void; selected: Kit | null; onClose: () => void }) {
  return <><div className="section-head"><div><div className="eyebrow">Acervo estratégico</div><h1>Biblioteca Editorial</h1><p className="subtitle">Blog SEO e WhatsApp Comercial salvos e prontos para revisão ou exportação.</p></div></div>{pending && <div className="notice">A migration aditiva da Biblioteca ainda não foi aplicada. Nenhum dado fictício será exibido.</div>}<div className="card toolbar"><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, ICP ou tag…" /></div><div className="content-list">{kits.length ? kits.map((kit) => <article className="card content-item" key={kit.id}><div><div className="content-title">{kit.title}</div><div className="content-meta">{kit.primaryIcp} · score {kit.editorialScore} · {kit.provider}/{kit.model}</div><div className="tags" style={{ marginTop: 8 }}>{kit.payload.blog.tags.slice(0, 5).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div></div><div className="content-actions"><button className="secondary" onClick={() => onOpen(kit)}>Abrir kit</button><button className="ghost" onClick={() => exportKit(kit)}>Exportar</button><button className="ghost" onClick={() => onUpdate(kit.id, "duplicate")}>Duplicar</button><button className="ghost" onClick={() => onUpdate(kit.id, kit.archivedAt ? "restore" : "archive")}>{kit.archivedAt ? "Restaurar" : "Arquivar"}</button></div></article>) : <div className="card empty"><strong>Nenhum Kit Editorial salvo</strong>Gere o primeiro kit a partir da Notícia do Dia.</div>}</div>{selected && <KitDrawer kit={selected} onClose={onClose} />}</>;
}

function Radar({ intelligence }: { intelligence: Intelligence }) {
  return <><div className="section-head"><div><div className="eyebrow">Sinais por mercado</div><h1>Radar Editorial</h1><p className="subtitle">Comparação dos últimos sete dias com o período anterior, usando apenas notícias persistidas.</p></div></div><div className="radar-grid">{intelligence.radar.map((item) => <article className="card radar-card" key={item.icp}><span className={`trend-arrow ${item.trend}`}>{item.trend === "up" ? "↗" : item.trend === "down" ? "↘" : "→"}</span><h2>{item.icp}</h2><strong>{item.current}</strong><p>sinais nos últimos 7 dias · {item.previous} no período anterior</p></article>)}</div></>;
}

function Insights({ intelligence }: { intelligence: Intelligence }) {
  return <><div className="section-head"><div><div className="eyebrow">Leitura executiva</div><h1>Insights</h1><p className="subtitle">Alertas, tendências e oportunidades inferidas por regras transparentes sobre o monitoramento real.</p></div></div><div className="insight-grid">{intelligence.insights.map((item) => <article className={`card insight-card ${item.type}`} key={item.title}><span>{item.type === "alert" ? "Alerta" : item.type === "trend" ? "Tendência" : "Oportunidade"}</span><h2>{item.title}</h2><p>{item.description}</p></article>)}</div></>;
}

function KitDrawer({ kit, onClose }: { kit: Kit; onClose: () => void }) {
  const [channel, setChannel] = useState("Blog SEO");
  const channels = ["Blog SEO", "WhatsApp"];
  return <div className="detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="detail-drawer kit-drawer" role="dialog" aria-modal="true" aria-label="Kit Editorial"><div className="detail-head"><div><div className="eyebrow">Kit Editorial #{kit.id} · Blog + WhatsApp</div><h2>{kit.title}</h2></div><button className="theme-toggle" onClick={onClose} aria-label="Fechar">×</button></div><div className="kit-tabs">{channels.map((item) => <button className={channel === item ? "active" : ""} onClick={() => setChannel(item)} key={item}>{item}</button>)}</div><KitChannel channel={channel} payload={kit.payload} /></aside></div>;
}

function KitChannel({ channel, payload }: { channel: string; payload: KitPayload }) {
  if (channel === "Blog SEO") return <div className="kit-copy"><h3>{payload.blog.title}</h3><p>{payload.blog.metaDescription}</p><code>/{payload.blog.slug}</code><div className="kit-html" dangerouslySetInnerHTML={{ __html: payload.blog.html }} /></div>;
  return <div className="kit-copy"><h3>WhatsApp Comercial</h3><p className="pre-wrap">{payload.whatsapp.text}</p></div>;
}

function exportKit(kit: Kit) {
  const blob = new Blob([JSON.stringify(kit, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `tf-news-kit-${kit.id}.json`; anchor.click(); URL.revokeObjectURL(url);
}
