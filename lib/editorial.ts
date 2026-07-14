import { z } from "zod";

export const ICP_CATALOG = [
  { slug: "agronegocio", name: "Agronegócio", keywords: ["safra", "colheita", "plantio", "fertilizante", "bioinsumo", "semente", "agrícola", "agronegócio", "grãos", "soja", "milho", "armazenagem agrícola", "defensivo"], negativeKeywords: ["agroecologia urbana"] },
  { slug: "maquinas", name: "Máquinas e Equipamentos Pesados", keywords: ["máquina agrícola", "equipamento pesado", "trator", "escavadeira", "retroescavadeira", "implemento", "linha amarela", "guindaste"], negativeKeywords: ["máquina de lavar", "machine learning"] },
  { slug: "quimica", name: "Indústria Química", keywords: ["indústria química", "produto químico", "insumo químico", "petroquímica", "solvente", "reagente", "especialidade química"], negativeKeywords: ["química do amor", "química entre"] },
  { slug: "termoplasticos", name: "Termoplásticos", keywords: ["termoplástico", "resina", "polímero", "polietileno", "polipropileno", "plástico de engenharia", "composto plástico"], negativeKeywords: ["cirurgia plástica"] },
  { slug: "aco", name: "Aço", keywords: ["aço", "siderurgia", "siderúrgica", "metalurgia", "bobina de aço", "laminado", "minério de ferro", "chapa de aço"], negativeKeywords: ["ação judicial", "mercado de ações"] },
  { slug: "tintas", name: "Tintas", keywords: ["tinta industrial", "tinta", "revestimento", "pigmento", "verniz", "resina para tintas"], negativeKeywords: ["tinta de cabelo", "maquiagem"] },
  { slug: "nutricao-animal", name: "Nutrição Animal", keywords: ["nutrição animal", "ração", "suplemento animal", "pecuária", "proteína animal", "premix", "aditivo alimentar animal"], negativeKeywords: ["nutrição humana", "dieta humana"] },
  { slug: "acm", name: "ACM", keywords: ["acm", "alumínio composto", "chapa de alumínio", "fachada", "painel composto de alumínio"], negativeKeywords: ["association for computing machinery", "acm sig"] },
] as const;

export const MONITORED_TOPICS = [
  "safra", "fertilizantes", "bioinsumos", "máquinas", "matérias-primas",
  "resinas", "aço", "tintas", "nutrição animal", "alumínio", "armazenagem",
  "transporte", "infraestrutura", "rodovias", "portos", "exportação",
  "importação", "distribuição", "custos", "regulamentação", "demanda",
  "cadeia de abastecimento", "clima", "logística",
] as const;

export const sourceInputSchema = z.object({
  action: z.enum(["test", "save"]).default("save"),
  name: z.string().trim().min(2).max(120),
  feedUrl: z.string().url().max(1000),
  websiteUrl: z.string().url().max(1000).optional().or(z.literal("")),
  reliabilityScore: z.number().int().min(0).max(100).default(75),
  priority: z.number().int().min(0).max(100).default(50),
  collectionFrequencyMinutes: z.number().int().min(60).max(10_080).default(720),
  language: z.string().trim().min(2).max(20).default("pt-BR"),
  country: z.string().trim().min(2).max(80).default("BR"),
  region: z.string().trim().min(2).max(100).default("Brasil"),
  relatedIcps: z.array(z.string().trim().min(2).max(100)).max(8).default([]),
  notes: z.string().trim().max(2000).default(""),
});

export const sourceUpdateSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["update", "activate", "pause", "archive"]),
  name: z.string().trim().min(2).max(120).optional(),
  feedUrl: z.string().url().max(1000).optional(),
  websiteUrl: z.string().url().max(1000).optional().or(z.literal("")),
  reliabilityScore: z.number().int().min(0).max(100).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  collectionFrequencyMinutes: z.number().int().min(60).max(10_080).optional(),
  language: z.string().trim().min(2).max(20).optional(),
  country: z.string().trim().min(2).max(80).optional(),
  region: z.string().trim().min(2).max(100).optional(),
  relatedIcps: z.array(z.string().trim().min(2).max(100)).max(8).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const sourceImportSchema = z.object({
  action: z.literal("import"),
  csv: z.string().min(1).max(300_000),
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
  allowDisconnected: z.boolean().default(false),
});

export const newsUpdateSchema = z.object({
  action: z.enum(["setIcp", "addSecondaryIcp", "relevant", "discard", "archive", "restore", "read", "unread", "favorite", "unfavorite", "analysis", "selected", "used", "setTopics", "addTag", "setRelevance", "setImpact", "addNote"]),
  newsIds: z.array(z.number().int().positive()).min(1).max(200),
  primaryIcp: z.string().trim().min(2).max(100).optional(),
  secondaryIcp: z.string().trim().min(2).max(100).optional(),
  topics: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
  tag: z.string().trim().min(2).max(80).optional(),
  relevanceScore: z.number().int().min(0).max(100).optional(),
  logisticsImpact: z.enum(["low", "medium", "high"]).optional(),
  note: z.string().trim().max(4000).optional(),
});

export type ParsedFeedItem = {
  externalId: string;
  title: string;
  originalUrl: string;
  excerpt: string;
  content: string;
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

export function parseFeedMetadata(xml: string) {
  const withoutItems = xml.replace(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const title = tag(withoutItems, ["title"]);
  const declaredEncoding = xml.match(/^\s*<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1] ?? "UTF-8";
  const format = /<feed\b/i.test(xml) ? "atom" : /<rss\b|<channel\b/i.test(xml) ? "rss" : "unknown";
  return { title, encoding: declaredEncoding, format };
}

export function parseFeed(xml: string): ParsedFeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.slice(0, 50).map((block, index) => {
    const title = tag(block, ["title"]);
    const originalUrl = linkFromBlock(block);
    const dateValue = tag(block, ["pubDate", "published", "updated", "dc:date"]);
    const parsedDate = dateValue && !Number.isNaN(Date.parse(dateValue)) ? new Date(dateValue) : new Date();
    const summary = tag(block, ["description", "summary"]);
    const content = tag(block, ["content:encoded", "content"]) || summary;
    return {
      externalId: tag(block, ["guid", "id"]) || originalUrl || `${title}-${index}`,
      title,
      originalUrl,
      excerpt: (summary || content).slice(0, 1500),
      content: content.slice(0, 20_000),
      author: tag(block, ["author", "dc:creator"]),
      publishedAt: parsedDate.toISOString(),
    };
  }).filter((item) => item.title.length >= 4 && isSafeHttpUrl(item.originalUrl));
}

export function classifyNews(input: { title: string; excerpt: string; publishedAt: string; reliabilityScore: number }): Classification {
  const normalizedTitle = normalizeText(input.title);
  const normalizedExcerpt = normalizeText(input.excerpt);
  const haystack = `${normalizedTitle} ${normalizedExcerpt}`;
  const icpMatches = ICP_CATALOG.map((icp) => ({
    name: icp.name,
    matches: icp.keywords.filter((keyword) => haystack.includes(normalizeText(keyword))),
    score: Math.max(0, icp.keywords.reduce((total, keyword) => {
      const term = normalizeText(keyword);
      return total + (normalizedTitle.includes(term) ? 3 : normalizedExcerpt.includes(term) ? 1 : 0);
    }, 0) - icp.negativeKeywords.reduce((total, keyword) => total + (haystack.includes(normalizeText(keyword)) ? 4 : 0), 0)),
  })).filter((match) => match.score > 0).sort((a, b) => b.score - a.score);
  const topics = MONITORED_TOPICS.filter((topic) => haystack.includes(normalizeText(topic))).slice(0, 5);
  const logisticsTerms = ["logistica", "transporte", "rodovia", "porto", "frete", "armazen", "distribu", "abastecimento", "exporta", "importa"];
  const logisticsHits = logisticsTerms.filter((term) => haystack.includes(term)).length;
  const logisticsImpact = logisticsHits >= 3 ? "high" : logisticsHits >= 1 ? "medium" : "low";
  const ageHours = Math.max(0, (Date.now() - new Date(input.publishedAt).getTime()) / 3_600_000);
  const freshness = ageHours <= 24 ? 100 : ageHours <= 168 ? 75 : ageHours <= 720 ? 45 : 20;
  const icpFit = Math.min(100, (icpMatches[0]?.score ?? 0) * 14 + Math.min(20, topics.length * 4));
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
    reason: `Aderência a ${primaryIcp} por ${icpMatches[0]?.matches.slice(0, 4).join(", ") || "contexto geral de mercado"}; ${topics.length} tema(s) prioritário(s) e impacto logístico ${logisticsImpact === "high" ? "alto" : logisticsImpact === "medium" ? "moderado" : "baixo"}.`,
  };
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
