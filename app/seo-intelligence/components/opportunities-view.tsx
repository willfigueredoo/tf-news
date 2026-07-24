"use client";

import { useMemo, useState } from "react";
import { ICP_CATALOG } from "../../../lib/editorial";
import type {
  SeoApiAction,
  SeoOpportunity,
  SeoOpportunityStatus,
  SeoPotential,
  SeoPriority,
} from "../types";

export function OpportunitiesView({
  opportunities,
  globalIcp,
  busy,
  execute,
  notify,
  onOpenKit,
  onOpenQueue,
}: {
  opportunities: SeoOpportunity[];
  globalIcp: string;
  busy: boolean;
  execute: <T>(action: SeoApiAction) => Promise<T>;
  notify: (message: string) => void;
  onOpenKit: (id: number) => void;
  onOpenQueue: (id: number) => void;
}) {
  const [icp, setIcp] = useState(globalIcp);
  const [priority, setPriority] = useState<SeoPriority | "all">("all");
  const [potential, setPotential] = useState<SeoPotential | "all">("all");
  const [status, setStatus] = useState<SeoOpportunityStatus | "active">("active");
  const [period, setPeriod] = useState("30");
  const [referenceTime] = useState(() => Date.now());

  const visible = useMemo(() => {
    const cutoff = referenceTime - Number(period) * 86_400_000;
    return opportunities
      .filter((item) => icp === "Todos os ICPs" || item.icp === icp || item.icp === "Todos os ICPs")
      .filter((item) => priority === "all" || item.priority === priority)
      .filter((item) => potential === "all" || item.seoPotential === potential)
      .filter((item) => status === "active" ? item.status !== "discarded" : item.status === status)
      .filter((item) => Date.parse(item.createdAt) >= cutoff)
      .sort((a, b) => b.confidence - a.confidence);
  }, [icp, opportunities, period, potential, priority, referenceTime, status]);

  async function run<T>(action: SeoApiAction, success: string) {
    try {
      const result = await execute<T>(action);
      notify(success);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "A ação não foi concluída.");
      return null;
    }
  }

  return <div className="seo-view">
    <div className="card seo-opportunity-toolbar">
      <div><span className="label">ICP</span><select className="field" value={icp} onChange={(event) => setIcp(event.target.value)}><option>Todos os ICPs</option>{ICP_CATALOG.map((item) => <option key={item.slug}>{item.name}</option>)}</select></div>
      <div><span className="label">Prioridade</span><select className="field" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="all">Todas</option><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></div>
      <div><span className="label">Potencial SEO</span><select className="field" value={potential} onChange={(event) => setPotential(event.target.value as typeof potential)}><option value="all">Todos</option><option value="very_high">Muito alto</option><option value="high">Alto</option><option value="moderate">Moderado</option></select></div>
      <div><span className="label">Status</span><select className="field" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Ativas</option><option value="new">Novas</option><option value="reviewed">Revisadas</option><option value="accepted">Aceitas</option><option value="converted_to_kit">Convertidas em Kit</option><option value="discarded">Descartadas</option></select></div>
      <div><span className="label">Data</span><select className="field" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></div>
      <span className="result-summary">{visible.length} oportunidade(s)</span>
    </div>

    <div className="seo-opportunity-grid">{visible.map((opportunity) => <article className="card seo-opportunity-card" key={opportunity.id}>
      <div className="seo-opportunity-top"><div><span className={`seo-priority priority-${opportunity.priority}`}>{priorityLabel(opportunity.priority)}</span><div className="seo-stars" aria-label={`${opportunity.confidence}% de confiança`}>★★★★★</div></div><div className="seo-confidence"><strong>{opportunity.confidence}%</strong><span>Confiança</span></div></div>
      <h2>{opportunity.title}</h2>
      <div className="content-meta">{opportunity.icp} · potencial SEO {potentialLabel(opportunity.seoPotential).toLowerCase()} · {opportunity.newsIds.length} notícia(s) real(is)</div>
      {opportunity.suggestedAngle && <p className="seo-suggested-angle"><strong>Ângulo sugerido:</strong> {opportunity.suggestedAngle}</p>}
      <div className="seo-reasons"><small>Motivos</small>{opportunity.reasons.map((reason) => <p key={reason}><span>✓</span>{reason}</p>)}</div>
      <div className="content-meta">Sinais: {opportunity.signalOrigins.map(signalLabel).join(" · ") || "TF News Engine"} · validade até {formatDate(opportunity.validUntil)}</div>
      <div className="inline-actions wrap">
        {opportunity.editorialKitId
          ? <button className="primary" onClick={() => onOpenKit(opportunity.editorialKitId as number)}>Abrir Kit</button>
          : opportunity.editorialQueueId
            ? <button className="primary" onClick={() => onOpenQueue(opportunity.editorialQueueId as number)}>Abrir pauta</button>
            : <>
              <button className="secondary" disabled={busy || !opportunity.newsIds.length} onClick={() => void (async () => {
                const result = await run<{ queue?: { id: number } }>({ action: "opportunity", opportunityId: opportunity.id, operation: "create_queue" }, "Pauta criada na Fila Editorial.");
                if (result?.queue?.id) onOpenQueue(result.queue.id);
              })()}>Criar pauta</button>
              <button className="primary" disabled={busy || !opportunity.newsIds.length} onClick={() => void (async () => {
                const result = await run<{ kit?: { id: number } }>({ action: "opportunity", opportunityId: opportunity.id, operation: "generate_kit" }, "Kit gerado e salvo na Biblioteca.");
                if (result?.kit?.id) onOpenKit(result.kit.id);
              })()}>Gerar Kit</button>
            </>}
        {opportunity.status === "new" && <button className="ghost" disabled={busy} onClick={() => void run({ action: "opportunity", opportunityId: opportunity.id, operation: "review" }, "Oportunidade marcada como revisada.")}>Marcar revisada</button>}
        {opportunity.status !== "discarded" && !opportunity.editorialKitId && <button className="ghost" disabled={busy} onClick={() => void run({ action: "opportunity", opportunityId: opportunity.id, operation: "discard" }, "Oportunidade descartada.")}>Descartar</button>}
      </div>
      {!opportunity.newsIds.length && <div className="notice">Esta lacuna veio do acervo competitivo, mas ainda não possui notícia real vinculada para abrir o fluxo editorial.</div>}
    </article>)}</div>
    {!visible.length && <div className="card empty">
      <strong>{opportunities.length ? "Nenhuma oportunidade neste recorte" : "Ainda não há oportunidades suficientes"}</strong>
      {opportunities.length ? "Ajuste os filtros para ampliar a leitura editorial." : "Sincronize o Blog TransFAST e, opcionalmente, concorrentes. As oportunidades serão derivadas dos dados coletados e das notícias monitoradas."}
    </div>}
  </div>;
}

function priorityLabel(value: SeoPriority) {
  return value === "high" ? "Alta" : value === "medium" ? "Média" : "Baixa";
}

function potentialLabel(value: SeoPotential) {
  return value === "very_high" ? "Muito alto" : value === "high" ? "Alto" : "Moderado";
}

function signalLabel(value: string) {
  if (value === "monitoring") return "Monitoramento";
  if (value === "competitors") return "Concorrentes";
  if (value === "transfast_archive") return "Acervo TransFAST";
  if (value === "content_gap") return "Lacuna de conteúdo";
  return value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}
