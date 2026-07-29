"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEscapeKey } from "../lib/use-escape-key";

type OpportunityStatus = "opportunity" | "generating" | "in_production" | "published" | "postponed" | "failed";
type Opportunity = {
  id: number;
  suggestedTitle: string;
  category: string;
  description: string;
  rationale: string;
  strategicScore: number;
  priority: string;
  evergreenScore: number;
  icpScore: number;
  recurrenceScore: number;
  contentGapScore: number;
  competitorScore: number;
  googleSignalsScore: number | null;
  primaryKeyword: string;
  searchIntent: string;
  relatedIcps: string[];
  status: OpportunityStatus;
  originType: string;
  sourceCount: number;
  generatedKitId: number | null;
  postponedReason: string | null;
  lastError: string | null;
  sources: Array<{
    type: string;
    title: string | null;
    publisher: string | null;
    url: string | null;
    relevanceScore: number;
  }>;
  updatedAt: string;
};
type OpportunityJob = {
  id: number;
  status: string;
  totalCandidates: number;
  processedCandidates: number;
  progressPercent: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  ignored: number;
  lastError: string | null;
};
type Tab = "opportunity" | "in_production" | "published";

export function ContentCenter({
  onOpenKit,
  notify,
}: {
  onOpenKit: (kitId: number) => void;
  notify: (message: string) => void;
}) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [job, setJob] = useState<OpportunityJob | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("opportunity");
  const [generationTarget, setGenerationTarget] = useState<Opportunity | null>(null);
  const [postponeTarget, setPostponeTarget] = useState<Opportunity | null>(null);
  const [busy, setBusy] = useState(false);
  const workerBusy = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/content-opportunities", { cache: "no-store" });
      const data = await response.json() as {
        opportunities?: Opportunity[];
        job?: OpportunityJob | null;
        aiConfigured?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar as oportunidades.");
      setOpportunities(data.opportunities ?? []);
      setJob(data.job ?? null);
      setAiConfigured(Boolean(data.aiConfigured));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as oportunidades.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const processJob = useCallback(async (jobId: number) => {
    if (workerBusy.current) return;
    workerBusy.current = true;
    try {
      const response = await fetch("/api/content-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_job", jobId }),
      });
      const data = await response.json() as { job?: OpportunityJob | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "A análise será retomada automaticamente.");
      setJob(data.job ?? null);
      await load(true);
    } catch (workerError) {
      setError(workerError instanceof Error ? workerError.message : "A análise será retomada automaticamente.");
      await load(true);
    } finally {
      workerBusy.current = false;
    }
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!job || !["queued", "processing", "retry"].includes(job.status)) return;
    const delay = job.status === "retry" ? 5_000 : 700;
    const timer = window.setTimeout(() => { void processJob(job.id); }, delay);
    return () => window.clearTimeout(timer);
  }, [job, processJob]);

  const filtered = useMemo(() => opportunities.filter((opportunity) => {
    if (tab === "opportunity") return ["opportunity", "failed"].includes(opportunity.status);
    return opportunity.status === tab;
  }), [opportunities, tab]);
  const counts = useMemo(() => ({
    opportunity: opportunities.filter((item) => ["opportunity", "failed"].includes(item.status)).length,
    in_production: opportunities.filter((item) => item.status === "in_production").length,
    published: opportunities.filter((item) => item.status === "published").length,
  }), [opportunities]);
  const activeJob = job && ["queued", "processing", "retry"].includes(job.status);

  async function startAnalysis() {
    if (busy || !aiConfigured) return;
    setBusy(true);
    try {
      const response = await fetch("/api/content-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_analysis" }),
      });
      const data = await response.json() as { job?: OpportunityJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error ?? "Não foi possível iniciar a análise.");
      setJob(data.job);
      notify(data.job.totalCandidates
        ? "Analisando novas oportunidades em segundo plano."
        : "Nenhum novo agrupamento editorial foi encontrado.");
      await load(true);
    } catch (startError) {
      notify(startError instanceof Error ? startError.message : "Não foi possível iniciar a análise.");
    } finally {
      setBusy(false);
    }
  }

  async function generateKit() {
    if (!generationTarget || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/content-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_kit", opportunityId: generationTarget.id }),
      });
      const data = await response.json() as { kit?: { id: number }; kitId?: number | null; error?: string };
      if (response.status === 409 && data.kitId) {
        setGenerationTarget(null);
        notify("Esta oportunidade já possui um Kit. Abrindo o conteúdo existente.");
        onOpenKit(data.kitId);
        return;
      }
      if (!response.ok || !data.kit) throw new Error(data.error ?? "Não foi possível gerar o Kit Evergreen.");
      setGenerationTarget(null);
      notify("Kit Evergreen salvo na Biblioteca.");
      onOpenKit(data.kit.id);
    } catch (generationError) {
      notify(generationError instanceof Error ? generationError.message : "Não foi possível gerar o Kit Evergreen.");
      await load(true);
    } finally {
      setBusy(false);
    }
  }

  async function postpone(reason: string | null) {
    if (!postponeTarget || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/content-opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "postpone", opportunityId: postponeTarget.id, reason }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível adiar a oportunidade.");
      setPostponeTarget(null);
      setOpportunities((current) => current.map((item) => item.id === postponeTarget.id
        ? { ...item, status: "postponed", postponedReason: reason }
        : item));
      notify("Oportunidade adiada. Nenhum conteúdo foi excluído.");
    } catch (postponeError) {
      notify(postponeError instanceof Error ? postponeError.message : "Não foi possível adiar a oportunidade.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="section-head content-center-head">
      <div>
        <div className="eyebrow">Inteligência evergreen</div>
        <h1>Central de Conteúdos</h1>
        <p className="subtitle">Oportunidades de conteúdos estratégicos identificadas pelo TF News.</p>
      </div>
      <div className="content-center-actions">
        <span>Encontramos <strong>{counts.opportunity}</strong> oportunidade{counts.opportunity === 1 ? "" : "s"} para você.</span>
        <button className="primary" onClick={() => void startAnalysis()} disabled={busy || Boolean(activeJob) || !aiConfigured}>
          {activeJob ? "Analisando…" : "Buscar oportunidades"}
        </button>
      </div>
    </div>

    {!aiConfigured && <div className="notice">O Gemini está indisponível. As oportunidades existentes continuam acessíveis, mas uma nova análise exige a configuração da IA.</div>}
    {error && <div className="notice content-center-error"><span>{error}</span><button className="ghost" onClick={() => void load()}>Tentar novamente</button></div>}
    {activeJob && <AnalysisProgress job={job} />}

    <nav className="content-center-tabs" aria-label="Estados da Central de Conteúdos">
      {([
        ["opportunity", "Oportunidades", counts.opportunity],
        ["in_production", "Em produção", counts.in_production],
        ["published", "Publicados", counts.published],
      ] as Array<[Tab, string, number]>).map(([value, label, count]) => (
        <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)} aria-pressed={tab === value}>
          {label}<span>{count}</span>
        </button>
      ))}
    </nav>

    {loading ? <ContentCenterSkeleton /> : filtered.length ? (
      <div className="content-opportunity-grid">
        {filtered.map((opportunity) => <OpportunityCard
          key={opportunity.id}
          opportunity={opportunity}
          onGenerate={setGenerationTarget}
          onPostpone={setPostponeTarget}
          onOpenKit={(id) => onOpenKit(id)}
        />)}
      </div>
    ) : <div className="card empty content-center-empty">
      <strong>{tab === "opportunity" ? "Nenhuma nova oportunidade encontrada." : tab === "in_production" ? "Nenhum conteúdo em produção." : "Nenhum conteúdo publicado pela Central."}</strong>
      {tab === "opportunity"
        ? "O TF News continuará analisando notícias e conteúdos dos concorrentes em busca de novos temas evergreen."
        : "Os conteúdos aparecerão aqui conforme avançarem na jornada editorial."}
    </div>}

    {generationTarget && <GenerateEvergreenModal
      opportunity={generationTarget}
      busy={busy}
      onCancel={() => setGenerationTarget(null)}
      onConfirm={() => void generateKit()}
    />}
    {postponeTarget && <PostponeModal
      busy={busy}
      onCancel={() => setPostponeTarget(null)}
      onConfirm={(reason) => void postpone(reason)}
    />}
  </>;
}

function OpportunityCard({
  opportunity,
  onGenerate,
  onPostpone,
  onOpenKit,
}: {
  opportunity: Opportunity;
  onGenerate: (opportunity: Opportunity) => void;
  onPostpone: (opportunity: Opportunity) => void;
  onOpenKit: (kitId: number) => void;
}) {
  const origin = describeOrigin(opportunity);
  const priority = priorityLabel(opportunity.strategicScore);
  return <article className="card content-opportunity-card">
    <header>
      <div>
        <span className="content-opportunity-category">{opportunity.category}</span>
        <h2>{opportunity.suggestedTitle}</h2>
      </div>
      <div className="content-opportunity-score" aria-label={`Score estratégico ${opportunity.strategicScore} de 100`}>
        <strong>{opportunity.strategicScore}</strong><span>/ 100</span>
      </div>
    </header>
    <div className="content-opportunity-meta">
      <span className={`priority ${opportunity.strategicScore >= 85 ? "high" : "good"}`}>{priority}</span>
      <span>{opportunity.relatedIcps.slice(0, 3).join(" • ")}</span>
    </div>
    <div className="content-opportunity-origin"><strong>Origem</strong><span>{origin}</span></div>
    <div className="content-opportunity-rationale">
      <strong>Por que sugerimos</strong>
      <p>{opportunity.rationale}</p>
      <ul>
        <li>Potencial de longevidade: {opportunity.evergreenScore}/100</li>
        <li>Aderência aos ICPs: {opportunity.icpScore}/100</li>
        <li>Lacuna de conteúdo: {opportunity.contentGapScore}/100</li>
      </ul>
    </div>
    {opportunity.lastError && <div className="content-opportunity-warning">A última geração não foi concluída. Você pode tentar novamente.</div>}
    <footer>
      {opportunity.generatedKitId
        ? <button className="primary" onClick={() => onOpenKit(opportunity.generatedKitId!)}>Abrir Kit</button>
        : <button className="primary" onClick={() => onGenerate(opportunity)}>Gerar Kit</button>}
      {!opportunity.generatedKitId && <button className="secondary" onClick={() => onPostpone(opportunity)}>Não agora</button>}
    </footer>
  </article>;
}

function AnalysisProgress({ job }: { job: OpportunityJob }) {
  return <section className="card content-analysis-progress" aria-live="polite">
    <div><span className="live-dot" /><strong>Analisando novas oportunidades em segundo plano.</strong></div>
    <span>{job.processedCandidates} de {job.totalCandidates} agrupamentos</span>
    <div className="content-progress-track"><i style={{ width: `${job.progressPercent}%` }} /></div>
  </section>;
}

function GenerateEvergreenModal({
  opportunity,
  busy,
  onCancel,
  onConfirm,
}: {
  opportunity: Opportunity;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel, !busy);
  return <div className="modal-backdrop" role="presentation">
    <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="generate-evergreen-title">
      <div className="eyebrow">Central de Conteúdos</div>
      <h2 id="generate-evergreen-title">Gerar Kit Evergreen</h2>
      <div className="content-confirm-summary">
        <span>Título</span><strong>{opportunity.suggestedTitle}</strong>
        <span>Tipo</span><strong>Conteúdo Evergreen</strong>
      </div>
      <p>O TF News definirá automaticamente SEO, estrutura, categoria, CTA e demais campos editoriais.</p>
      <div className="inline-actions">
        <button className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="primary" disabled={busy} onClick={onConfirm}>{busy ? "Gerando Kit…" : "Gerar Kit"}</button>
      </div>
    </section>
  </div>;
}

function PostponeModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState<string>("");
  useEscapeKey(onCancel, !busy);
  const reasons = [
    ["not_priority", "Não é prioridade"],
    ["similar_content", "Já temos conteúdo semelhante"],
    ["low_relevance", "Tema pouco relevante"],
    ["produce_later", "Produzir futuramente"],
    ["other", "Outro"],
  ];
  return <div className="modal-backdrop" role="presentation">
    <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="postpone-title">
      <div className="eyebrow">Feedback editorial opcional</div>
      <h2 id="postpone-title">Deixar para depois?</h2>
      <p>A oportunidade será preservada e poderá ser recuperada futuramente.</p>
      <div className="postpone-reasons">
        {reasons.map(([value, label]) => <label key={value}>
          <input type="radio" name="postpone-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
          <span>{label}</span>
        </label>)}
      </div>
      <div className="inline-actions">
        <button className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="primary" disabled={busy} onClick={() => onConfirm(reason || null)}>Não agora</button>
      </div>
    </section>
  </div>;
}

function ContentCenterSkeleton() {
  return <div className="content-opportunity-grid" aria-label="Carregando oportunidades">
    {[1, 2, 3].map((item) => <div className="card content-opportunity-card skeleton-card" key={item}>
      <span /><span /><span /><span />
    </div>)}
  </div>;
}

function describeOrigin(opportunity: Opportunity) {
  const news = opportunity.sources.filter((source) => source.type === "news").length;
  const competitors = new Set(opportunity.sources.filter((source) => source.type === "competitor_article").map((source) => source.publisher)).size;
  const parts = [];
  if (news) parts.push(`${news} notícia${news === 1 ? "" : "s"} relacionada${news === 1 ? "" : "s"}`);
  if (competitors) parts.push(`detectado em ${competitors} concorrente${competitors === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" • ") : "Tendência recorrente no monitoramento";
}

function priorityLabel(score: number) {
  if (score >= 85) return "Alta prioridade";
  if (score >= 70) return "Boa oportunidade";
  return "Oportunidade secundária";
}
