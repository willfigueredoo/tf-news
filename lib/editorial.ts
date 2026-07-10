import { z } from "zod";

export const ICP_CATALOG = [
  { slug: "agronegocio", name: "Agronegócio", keywords: ["safra", "colheita", "plantio", "fertilizante", "bioinsumo", "semente", "agrícola", "agro", "grãos", "soja", "milho"] },
  { slug: "maquinas", name: "Máquinas e Equipamentos Pesados", keywords: ["máquina", "equipamento pesado", "trator", "escavadeira", "construção", "implemento"] },
  { slug: "quimica", name: "Indústria Química", keywords: ["química", "químico", "insumo químico", "petroquímica", "solvente", "reagente"] },
  { slug: "termoplasticos", name: "Termoplásticos", keywords: ["termoplástico", "resina", "polímero", "polietileno", "polipropileno", "plástico"] },
  { slug: "aco", name: "Aço", keywords: ["aço", "siderurgia", "metalurgia", "bobina", "laminado", "minério de ferro"] },
  { slug: "tintas", name: "Tintas", keywords: ["tinta", "revestimento", "pigmento", "verniz"] },
  { slug: "nutricao-animal", name: "Nutrição Animal", keywords: ["nutrição animal", "ração", "suplemento animal", "pecuária", "proteína animal"] },
  { slug: "acm", name: "ACM", keywords: ["acm", "alumínio composto", "chapa de alumínio", "fachada"] },
] as const;

export const MONITORED_TOPICS = [
  "safra", "fertilizantes", "bioinsumos", "máquinas", "matérias-primas",
  "resinas", "aço", "tintas", "nutrição animal", "alumínio", "armazenagem",
  "transporte", "infraestrutura", "rodovias", "portos", "exportação",
  "importação", "distribuição", "custos", "regulamentação", "demanda",
  "cadeia de abastecimento", "clima", "logística",
] as const;

export const sourceInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  feedUrl: z.string().url().max(1000),
  websiteUrl: z.string().url().max(1000).optional().or(z.literal("")),
  reliabilityScore: z.number().int().min(0).max(100).default(75),
});

export const collectInputSchema = z.object({ sourceId: z.number().int().positive() });
export const contentInputSchema = z.object({
  action: z.enum(["brief", "article", "save"]),
  newsIds: z.array(z.number().int().positive()).max(12).default([]),
  briefId: z.number().int().positive().optional(),
  articleId: z.number().int().positive().optional(),
  icp: z.string().trim().max(100).default("Todos os ICPs"),
  objective: z.string().trim().max(500).default("Análise de mercado com foco logístico"),
  primaryKeyword: z.string().trim().max(120).default("logística B2B"),
  tone: z.string().trim().max(80).default("Executivo e acessível"),
  title: z.string().trim().max(180).optional(),
  content: z.string().max(100_000).optional(),
});

export type ParsedFeedItem = {
  externalId: string;
  title: string;
  originalUrl: string;
  excerpt: string;
  author: string;
  publishedAt: string;
};

export type Classification = {
  primaryIcp: string;
  secondaryIcps: string[];
  topics: string[];
  region: string;
  logisticsImpact: "low" | "medium" | "high";
  relevanceScore: number;
  reason: string;
};

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function isSafeHttpUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

export function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value: string) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return entities[code.toLowerCase()] ?? `&${code};`;
  });
}

function tag(block: string, names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match?.[1]) return stripHtml(match[1]);
  }
  return "";
}

function linkFromBlock(block: string) {
  const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i)?.[1];
  return atomLink ? decodeEntities(atomLink) : tag(block, ["link"]);
}

export function parseFeed(xml: string): ParsedFeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.slice(0, 50).map((block, index) => {
    const title = tag(block, ["title"]);
    const originalUrl = linkFromBlock(block);
    const dateValue = tag(block, ["pubDate", "published", "updated", "dc:date"]);
    const parsedDate = dateValue && !Number.isNaN(Date.parse(dateValue)) ? new Date(dateValue) : new Date();
    return {
      externalId: tag(block, ["guid", "id"]) || originalUrl || `${title}-${index}`,
      title,
      originalUrl,
      excerpt: tag(block, ["description", "summary", "content:encoded", "content"]).slice(0, 1500),
      author: tag(block, ["author", "dc:creator"]),
      publishedAt: parsedDate.toISOString(),
    };
  }).filter((item) => item.title.length >= 4 && isSafeHttpUrl(item.originalUrl));
}

export function classifyNews(input: { title: string; excerpt: string; publishedAt: string; reliabilityScore: number }): Classification {
  const haystack = normalizeText(`${input.title} ${input.excerpt}`);
  const icpMatches = ICP_CATALOG.map((icp) => ({
    name: icp.name,
    score: icp.keywords.reduce((total, keyword) => total + (haystack.includes(normalizeText(keyword)) ? 1 : 0), 0),
  })).filter((match) => match.score > 0).sort((a, b) => b.score - a.score);
  const topics = MONITORED_TOPICS.filter((topic) => haystack.includes(normalizeText(topic))).slice(0, 5);
  const logisticsTerms = ["logistica", "transporte", "rodovia", "porto", "frete", "armazen", "distribu", "abastecimento", "exporta", "importa"];
  const logisticsHits = logisticsTerms.filter((term) => haystack.includes(term)).length;
  const logisticsImpact = logisticsHits >= 3 ? "high" : logisticsHits >= 1 ? "medium" : "low";
  const ageHours = Math.max(0, (Date.now() - new Date(input.publishedAt).getTime()) / 3_600_000);
  const freshness = ageHours <= 24 ? 100 : ageHours <= 168 ? 75 : ageHours <= 720 ? 45 : 20;
  const icpFit = Math.min(100, (icpMatches[0]?.score ?? 0) * 32 + Math.min(20, topics.length * 4));
  const logisticsScore = logisticsImpact === "high" ? 100 : logisticsImpact === "medium" ? 65 : 20;
  const verifiable = /\b\d+(?:[.,]\d+)?(?:%| mil| milhões| bilhões)?\b/.test(haystack) ? 85 : 55;
  const relevanceScore = Math.round(input.reliabilityScore * .2 + freshness * .15 + icpFit * .25 + logisticsScore * .2 + Math.min(100, topics.length * 20) * .1 + verifiable * .1);
  const region = /centro-oeste|mato grosso|goias|goiás/.test(haystack) ? "Centro-Oeste" : /sul|parana|paraná|rio grande do sul|santa catarina/.test(haystack) ? "Sul" : /sudeste|sao paulo|são paulo|minas gerais/.test(haystack) ? "Sudeste" : /nordeste|bahia|pernambuco|ceara|ceará/.test(haystack) ? "Nordeste" : "Brasil";
  const primaryIcp = icpMatches[0]?.name ?? "Mercado e Logística";
  const secondaryIcps = icpMatches.slice(1, 4).map((match) => match.name);
  return {
    primaryIcp,
    secondaryIcps,
    topics: topics.length ? [...topics] : ["logística"],
    region,
    logisticsImpact,
    relevanceScore: Math.max(0, Math.min(100, relevanceScore)),
    reason: `Aderência a ${primaryIcp}; ${topics.length} tema(s) prioritário(s) identificado(s) e impacto logístico ${logisticsImpact === "high" ? "alto" : logisticsImpact === "medium" ? "moderado" : "baixo"}.`,
  };
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

