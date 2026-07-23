import type { AuthorityScore } from "../types";

export function AuthorityOverview({ authority }: { authority: AuthorityScore }) {
  const strengths = authority.insights.filter((item) => item.type === "strength");
  const opportunities = authority.insights.filter((item) => item.type === "opportunity");

  return <div className="seo-view" aria-label="Visão geral da autoridade digital">
    <section className="card seo-authority-card">
      <div className="seo-score-column">
        <div className="eyebrow">TF Authority Score</div>
        <div className="seo-score"><strong>{authority.value}</strong><span>/ 100</span></div>
        <div className="seo-evolution"><span>↗</span><div><small>Evolução</small><strong>+{authority.weeklyEvolution} esta semana</strong></div></div>
        <p>Índice proprietário de autoridade editorial. Não representa uma nota atribuída pelo Google.</p>
      </div>
      <div className="seo-authority-content">
        <div className="seo-signal-heading"><div><div className="eyebrow">Composição do índice</div><h2>Três leituras, uma visão de autoridade.</h2></div><span className="mock-badge">Dados simulados</span></div>
        <div className="seo-signal-list">{authority.signals.map((signal) => <div className="seo-signal" key={signal.id}>
          <div className="seo-signal-meta"><strong>{signal.label}</strong><span>{signal.weight}% do índice</span></div>
          <div className="seo-signal-track" aria-label={`${signal.label}: ${signal.score} de 100`}><i style={{ width: `${signal.score}%` }} /></div>
          <b>{signal.score}</b>
          <p>{signal.description}</p>
        </div>)}</div>
      </div>
    </section>

    <section className="seo-summary">
      <div className="eyebrow">Leitura executiva</div>
      <blockquote>{authority.summary}</blockquote>
      <span>Resumo preparado para futura conexão com Gemini e dados proprietários.</span>
    </section>

    <div className="seo-insight-columns">
      <InsightList title="Pontos fortes" items={strengths} />
      <InsightList title="Oportunidades" items={opportunities} accent />
    </div>
  </div>;
}

function InsightList({ title, items, accent = false }: { title: string; items: AuthorityScore["insights"]; accent?: boolean }) {
  return <section className={`card seo-insight-list ${accent ? "accent" : ""}`}>
    <div className="panel-title"><h2>{title}</h2><small>{items.length} sinais principais</small></div>
    {items.map((item) => <div className="seo-insight-row" key={item.id}><span aria-hidden="true">{accent ? "↗" : "✓"}</span><div><strong>{item.title}</strong><p>{item.description}</p></div></div>)}
  </section>;
}
