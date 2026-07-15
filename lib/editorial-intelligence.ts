export type IntelligenceNews = {
  id: number;
  title: string;
  excerpt: string;
  content: string;
  sourceName: string;
  originalUrl: string;
  publishedAt: string;
  collectedAt: string;
  primaryIcp: string;
  secondaryIcps: string[];
  topics: string[];
  region: string;
  logisticsImpact: "low" | "medium" | "high";
  relevanceScore: number;
  status: string;
  sourceReliability: number;
};

export type EditorialDecision = IntelligenceNews & {
  editorialScore: number;
  classification: "very_relevant" | "relevant" | "low_priority" | "discard";
  produceContent: boolean;
  scoreBreakdown: {
    logistics: number;
    icpFit: number;
    economicImportance: number;
    sourceAuthority: number;
    recency: number;
    commercialPotential: number;
    contentPotential: number;
    authorityPotential: number;
  };
  decisionReason: string;
  opportunity: string;
  commercialImpact: string;
  logisticsReason: string;
};

export type EditorialIntelligence = {
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
  newsOfTheDay: EditorialDecision | null;
  topFive: EditorialDecision[];
  all: EditorialDecision[];
  radar: Array<{ icp: string; current: number; previous: number; trend: "up" | "stable" | "down" }>;
  insights: Array<{ type: "alert" | "opportunity" | "trend"; title: string; description: string }>;
};

const ECONOMIC_TERMS = ["investimento", "bilhão", "milhão", "preço", "tarifa", "exportação", "importação", "produção", "demanda", "oferta", "mercado", "juros", "câmbio", "dólar", "emprego", "fábrica"];
const COMMERCIAL_TERMS = ["cliente", "venda", "contrato", "expansão", "capacidade", "distribuição", "fornecedor", "competitividade", "custo", "margem", "oportunidade"];

export function buildEditorialIntelligence(news: IntelligenceNews[], now = new Date()): EditorialIntelligence {
  const decisions = news.map((item) => scoreEditorialOpportunity(item, now)).sort((a, b) => b.editorialScore - a.editorialScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const active = decisions.filter((item) => item.status !== "discarded" && item.status !== "archived");
  const icps = frequency(active.map((item) => item.primaryIcp));
  const topics = frequency(active.flatMap((item) => item.topics));
  const mostImpactedIcp = icps[0]?.label ?? null;
  const dominantTopic = topics[0]?.label ?? null;
  const best = active[0] ?? null;
  return {
    generatedAt: now.toISOString(),
    summary: {
      analyzed: decisions.length,
      relevant: decisions.filter((item) => item.editorialScore >= 60).length,
      discarded: decisions.filter((item) => item.classification === "discard").length,
      highPriority: decisions.filter((item) => item.editorialScore >= 80).length,
      mostImpactedIcp,
      dominantTopic,
      commercialOpportunity: best?.commercialImpact ?? null,
      contentOpportunity: best?.opportunity ?? null,
    },
    newsOfTheDay: best,
    topFive: active.slice(0, 5),
    all: decisions,
    radar: buildRadar(news, now),
    insights: buildInsights(active, mostImpactedIcp, dominantTopic),
  };
}

export function scoreEditorialOpportunity(item: IntelligenceNews, now = new Date()): EditorialDecision {
  const text = normalize(`${item.title} ${item.excerpt} ${item.content} ${item.topics.join(" ")}`);
  const ageHours = Math.max(0, (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000);
  const logistics = item.logisticsImpact === "high" ? 100 : item.logisticsImpact === "medium" ? 65 : 25;
  const icpFit = clamp(45 + Math.min(3, item.secondaryIcps.length) * 10 + (item.primaryIcp && item.primaryIcp !== "Mercado e Logística" ? 25 : 0));
  const economicImportance = clamp(35 + termScore(text, ECONOMIC_TERMS, 9) + Math.round(item.relevanceScore * .25));
  const sourceAuthority = clamp(item.sourceReliability);
  const recency = clamp(Math.round(100 - ageHours * 1.35));
  const commercialPotential = clamp(30 + termScore(text, COMMERCIAL_TERMS, 9) + Math.round(item.relevanceScore * .3));
  const contentPotential = clamp(35 + Math.min(25, item.topics.length * 6) + Math.round(item.relevanceScore * .35));
  const authorityPotential = clamp(Math.round(sourceAuthority * .45 + item.relevanceScore * .55));
  const editorialScore = clamp(Math.round(
    logistics * .18 + icpFit * .14 + economicImportance * .14 + sourceAuthority * .12 + recency * .12 +
    commercialPotential * .10 + contentPotential * .12 + authorityPotential * .08,
  ));
  const classification = editorialScore >= 80 ? "very_relevant" : editorialScore >= 60 ? "relevant" : editorialScore >= 40 ? "low_priority" : "discard";
  const produceContent = editorialScore >= 60 && item.status !== "discarded" && item.status !== "archived";
  return {
    ...item,
    editorialScore,
    classification,
    produceContent,
    scoreBreakdown: { logistics, icpFit, economicImportance, sourceAuthority, recency, commercialPotential, contentPotential, authorityPotential },
    decisionReason: `${classificationLabel(classification)}: aderência a ${item.primaryIcp}, impacto logístico ${impactLabel(item.logisticsImpact)} e fonte com autoridade ${sourceAuthority}/100.`,
    opportunity: produceContent
      ? `Transformar o fato em uma análise prática para ${item.primaryIcp}, explicando o que muda agora e quais decisões merecem atenção.`
      : "Manter no radar até surgir um sinal mais recente, relevante ou diretamente acionável.",
    commercialImpact: commercialPotential >= 70
      ? `Há potencial comercial alto: o tema pode afetar custos, capacidade, demanda ou decisões de fornecedores e clientes de ${item.primaryIcp}.`
      : `O efeito comercial é indireto no momento; vale acompanhar novos dados antes de tratá-lo como oportunidade prioritária.`,
    logisticsReason: logistics >= 80
      ? "O acontecimento pode alterar transporte, armazenagem, abastecimento, prazo ou custo operacional."
      : logistics >= 60
        ? "Existe efeito logístico provável, mas sua intensidade depende da evolução do evento."
        : "Não há sinal logístico direto forte no material disponível.",
  };
}

function buildRadar(news: IntelligenceNews[], now: Date) {
  const currentStart = now.getTime() - 7 * 86_400_000;
  const previousStart = now.getTime() - 14 * 86_400_000;
  const labels = [...new Set(news.map((item) => item.primaryIcp))].filter(Boolean);
  return labels.map((icp) => {
    const current = news.filter((item) => item.primaryIcp === icp && Date.parse(item.publishedAt) >= currentStart).length;
    const previous = news.filter((item) => item.primaryIcp === icp && Date.parse(item.publishedAt) >= previousStart && Date.parse(item.publishedAt) < currentStart).length;
    return { icp, current, previous, trend: current > previous ? "up" as const : current < previous ? "down" as const : "stable" as const };
  }).sort((a, b) => b.current - a.current || b.previous - a.previous);
}

function buildInsights(news: EditorialDecision[], icp: string | null, topic: string | null) {
  const result: EditorialIntelligence["insights"] = [];
  const highLogistics = news.filter((item) => item.logisticsImpact === "high");
  if (highLogistics.length) result.push({ type: "alert", title: `${highLogistics.length} sinal(is) de alto impacto logístico`, description: "Priorize fatos que alteram custos, prazos, disponibilidade ou capacidade operacional." });
  if (icp) result.push({ type: "trend", title: `${icp} concentra o radar`, description: `É o ICP com maior recorrência entre as notícias monitoradas no período.` });
  if (topic) result.push({ type: "opportunity", title: `Oportunidade editorial: ${topic}`, description: "A recorrência do tema permite produzir contexto adicional, comparação e orientação prática." });
  return result;
}

function frequency(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function termScore(text: string, terms: string[], weight: number) { return terms.reduce((score, term) => score + (text.includes(normalize(term)) ? weight : 0), 0); }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function clamp(value: number) { return Math.max(0, Math.min(100, value)); }
function impactLabel(value: IntelligenceNews["logisticsImpact"]) { return value === "high" ? "alto" : value === "medium" ? "moderado" : "baixo"; }
function classificationLabel(value: EditorialDecision["classification"]) { return value === "very_relevant" ? "Muito relevante" : value === "relevant" ? "Relevante" : value === "low_priority" ? "Baixa prioridade" : "Descartar"; }
