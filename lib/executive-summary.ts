import { scoreEditorialOpportunity, type EditorialDecision, type IntelligenceNews } from "./editorial-intelligence.ts";

export const ALL_ICP_SCOPE = "Todos os ICPs";
export const EXECUTIVE_RELEVANT_THRESHOLD = 60;
export const EXECUTIVE_HIGH_PRIORITY_THRESHOLD = 80;

export type ExecutiveWindows = {
  metrics24h: string;
  dominance7d: string;
  trendCurrent7d: string;
  trendPrevious7d: string;
  newsCandidates72h: string;
};

export type TrendSignal = {
  dimension: "icp" | "topic";
  label: string;
  currentCount: number;
  previousCount: number;
};

export type ExecutiveScoreComponents = {
  editorialScore: number;
  recency: number;
  sourceAuthority: number;
  logisticsImpact: number;
  icpRelevance: number;
  reliability: number;
  trend: number;
};

export type RankedEditorialDecision = EditorialDecision & {
  finalScore: number;
  ranking: {
    components: ExecutiveScoreComponents;
    weights: Record<keyof ExecutiveScoreComponents, number>;
  };
};

export function executiveWindows(reference: Date): ExecutiveWindows {
  const time = reference.getTime();
  return {
    metrics24h: new Date(time - 24 * 3_600_000).toISOString(),
    dominance7d: new Date(time - 7 * 86_400_000).toISOString(),
    trendCurrent7d: new Date(time - 7 * 86_400_000).toISOString(),
    trendPrevious7d: new Date(time - 14 * 86_400_000).toISOString(),
    newsCandidates72h: new Date(time - 72 * 3_600_000).toISOString(),
  };
}

export function evaluateDominance(
  rows: Array<{ label: string; count: number }>,
  total: number,
  minimumCount = 3,
  minimumShare = 0.1,
) {
  const [leader, runnerUp] = rows;
  if (!leader || total <= 0) return null;
  const share = leader.count / total;
  if (leader.count < minimumCount || share < minimumShare || leader.count === runnerUp?.count) return null;
  return { label: leader.label, count: leader.count, share: Math.round(share * 100) };
}

export function rankExecutiveNews(news: IntelligenceNews[], trendSignals: TrendSignal[], reference: Date) {
  const trend = new Map(trendSignals.map((signal) => [`${signal.dimension}:${normalize(signal.label)}`, trendScore(signal.currentCount, signal.previousCount)]));
  const weights: RankedEditorialDecision["ranking"]["weights"] = {
    editorialScore: 0.4,
    recency: 0.18,
    sourceAuthority: 0.12,
    logisticsImpact: 0.1,
    icpRelevance: 0.08,
    reliability: 0.07,
    trend: 0.05,
  };

  return news
    .map((item): RankedEditorialDecision => {
      const decision = scoreEditorialOpportunity(item, reference);
      const relatedTrend = [
        trend.get(`icp:${normalize(decision.primaryIcp)}`),
        ...decision.topics.map((topic) => trend.get(`topic:${normalize(topic)}`)),
      ].filter((value): value is number => typeof value === "number");
      const components = {
        editorialScore: decision.editorialScore,
        recency: decision.scoreBreakdown.recency,
        sourceAuthority: decision.scoreBreakdown.sourceAuthority,
        logisticsImpact: decision.scoreBreakdown.logistics,
        icpRelevance: decision.scoreBreakdown.icpFit,
        reliability: decision.scoreBreakdown.sourceReliability,
        trend: relatedTrend.length ? Math.max(...relatedTrend) : 50,
      };
      const finalScore = Math.round(Object.entries(weights).reduce(
        (total, [key, weight]) => total + components[key as keyof typeof components] * weight,
        0,
      ));
      return { ...decision, finalScore, ranking: { components, weights } };
    })
    .filter((item) => item.produceContent)
    .sort((left, right) => right.finalScore - left.finalScore
      || Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
      || right.id - left.id);
}

export function tieBreakApplied(ranked: RankedEditorialDecision[]) {
  const [winner, runnerUp] = ranked;
  if (!winner) return "nenhum candidato válido";
  if (!runnerUp) return "único candidato válido";
  if (winner.finalScore !== runnerUp.finalScore) return "maior score final";
  if (Date.parse(winner.publishedAt) !== Date.parse(runnerUp.publishedAt)) return "publicação mais recente";
  return "maior identificador estável";
}

function trendScore(current: number, previous: number) {
  if (current + previous < 3) return 50;
  return clamp(Math.round(50 + (50 * (current - previous)) / Math.max(1, current + previous)));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
