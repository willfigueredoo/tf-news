"use client";

import { useMemo, useState } from "react";
import { ICP_CATALOG } from "../../../lib/editorial";
import type { SeoOpportunity, SeoPotential, SeoPriority } from "../types";

export function OpportunitiesView({ opportunities, globalIcp, onAction }: {
  opportunities: SeoOpportunity[];
  globalIcp: string;
  onAction: (message: string) => void;
}) {
  const [icp, setIcp] = useState(globalIcp);
  const [priority, setPriority] = useState<SeoPriority | "Todas">("Todas");
  const [potential, setPotential] = useState<SeoPotential | "Todos">("Todos");
  const [period, setPeriod] = useState("30");
  const [referenceTime] = useState(() => Date.now());

  const visible = useMemo(() => {
    const cutoff = referenceTime - Number(period) * 86_400_000;
    return opportunities
      .filter((item) => icp === "Todos os ICPs" || item.icp === icp || item.icp === "Todos os ICPs")
      .filter((item) => priority === "Todas" || item.priority === priority)
      .filter((item) => potential === "Todos" || item.seoPotential === potential)
      .filter((item) => Date.parse(item.detectedAt) >= cutoff)
      .sort((a, b) => b.confidence - a.confidence);
  }, [icp, opportunities, period, potential, priority, referenceTime]);

  return <div className="seo-view">
    <div className="card seo-opportunity-toolbar">
      <div><span className="label">ICP</span><select className="field" value={icp} onChange={(event) => setIcp(event.target.value)}><option>Todos os ICPs</option>{ICP_CATALOG.map((item) => <option key={item.slug}>{item.name}</option>)}</select></div>
      <div><span className="label">Prioridade</span><select className="field" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option>Todas</option><option>Alta</option><option>Média</option><option>Baixa</option></select></div>
      <div><span className="label">Potencial SEO</span><select className="field" value={potential} onChange={(event) => setPotential(event.target.value as typeof potential)}><option>Todos</option><option>Muito alto</option><option>Alto</option><option>Moderado</option></select></div>
      <div><span className="label">Data</span><select className="field" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></div>
      <span className="result-summary">{visible.length} oportunidade(s)</span>
    </div>

    <div className="seo-opportunity-grid">{visible.map((opportunity) => <article className="card seo-opportunity-card" key={opportunity.id}>
      <div className="seo-opportunity-top"><div><span className={`seo-priority priority-${opportunity.priority.toLowerCase()}`}>{opportunity.priority}</span><div className="seo-stars" aria-label={`${opportunity.confidence}% de confiança`}>★★★★★</div></div><div className="seo-confidence"><strong>{opportunity.confidence}%</strong><span>Confiança</span></div></div>
      <h2>{opportunity.title}</h2>
      <div className="content-meta">{opportunity.icp} · potencial SEO {opportunity.seoPotential.toLowerCase()} · {opportunity.relatedNews} sinais relacionados</div>
      <div className="seo-reasons"><small>Motivos</small>{opportunity.reasons.map((reason) => <p key={reason}><span>✓</span>{reason}</p>)}</div>
      <div className="inline-actions"><button className="secondary" onClick={() => onAction(`Pauta “${opportunity.title}” preparada para futura integração.`)}>Criar pauta</button><button className="primary" onClick={() => onAction("A geração será conectada à Fila Editorial em uma etapa futura.")}>Gerar Kit</button></div>
    </article>)}</div>
    {!visible.length && <div className="card empty"><strong>Nenhuma oportunidade neste recorte</strong>Ajuste os filtros para ampliar a leitura editorial.</div>}
  </div>;
}
