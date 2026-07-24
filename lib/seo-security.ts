import { lookup } from "node:dns/promises";
import { canonicalizeUrl } from "./editorial.ts";

const USER_AGENT = "TF-News-SEO/1.0 (+https://transfast.log.br)";
const DEFAULT_ACCEPT = "application/json, application/xml, text/xml, application/rss+xml, application/atom+xml, text/html;q=0.9";

export type SafeFetchResult = {
  response: Response;
  text: string;
  finalUrl: string;
  contentType: string;
  redirects: number;
  durationMs: number;
};

export function normalizeSiteUrl(value: string) {
  const raw = value.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("A URL deve utilizar HTTP ou HTTPS.");
  url.hash = "";
  return url.toString();
}

export function normalizeDomain(value: string) {
  const url = new URL(normalizeSiteUrl(value));
  return `https://${url.hostname.toLowerCase()}`;
}

export async function safeExternalFetch(
  startUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
    accept?: string;
    allowedContentTypes?: RegExp;
  } = {},
): Promise<SafeFetchResult> {
  const started = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const allowedContentTypes = options.allowedContentTypes ?? /(json|xml|rss|atom|html|text)/i;
  let current = normalizeSiteUrl(startUrl);

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicUrl(current, fetchImpl === fetch);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: options.accept ?? DEFAULT_ACCEPT,
          "User-Agent": USER_AGENT,
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("A fonte retornou um redirecionamento inválido.");
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) throw new Error(`A fonte respondeu com status ${response.status}.`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!allowedContentTypes.test(contentType)) throw new Error(`Content-Type não suportado: ${contentType || "não informado"}.`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxBytes) throw new Error(`A resposta excede o limite de ${Math.round(maxBytes / 1_000_000)} MB.`);
      const text = await readLimitedText(response, maxBytes);
      return { response, text, finalUrl: current, contentType, redirects, durationMs: Date.now() - started };
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Timeout ao acessar a fonte após ${timeoutMs} ms.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("A fonte excedeu o limite seguro de redirecionamentos.");
}

export async function assertPublicUrl(value: string, resolveDns = true) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Protocolo não permitido.");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || privateAddress(hostname)) {
    throw new Error("A URL foi bloqueada pela proteção SSRF.");
  }
  if (!resolveDns) return;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("A URL foi bloqueada pela proteção SSRF.");
  }
}

export function normalizeExternalUrl(value: string) {
  return canonicalizeUrl(normalizeSiteUrl(value));
}

export function htmlToText(value: string, maxLength = 80_000) {
  return decodeEntities(value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

export function extractHtmlMetadata(html: string, pageUrl: string) {
  const meta = (property: string) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
    ];
    return decodeEntities(patterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) ?? "").trim();
  };
  const canonicalMatch = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  const title = meta("og:title") || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const canonicalCandidate = canonicalMatch?.[1] ? new URL(canonicalMatch[1], pageUrl).toString() : pageUrl;
  return {
    title,
    canonicalUrl: normalizeExternalUrl(canonicalCandidate),
    description: meta("description") || meta("og:description"),
    image: meta("og:image") || null,
    publishedAt: meta("article:published_time") || null,
    modifiedAt: meta("article:modified_time") || null,
    author: meta("author") || null,
    keywords: splitTerms(meta("keywords")),
    text: htmlToText(extractArticleBody(html) || html),
  };
}

export function parseSitemap(xml: string) {
  const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map((match) => ({
    url: decodeEntities(match[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1] ?? "").trim(),
    lastModifiedAt: decodeEntities(match[1].match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1] ?? "").trim() || null,
  })).filter((item) => /^https?:\/\//i.test(item.url));
  const childSitemaps = [...xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)].map((match) =>
    decodeEntities(match[1].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1] ?? "").trim(),
  ).filter((url) => /^https?:\/\//i.test(url));
  return { entries: entries.slice(0, 2_000), childSitemaps: childSitemaps.slice(0, 50) };
}

export function safeJsonArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 50);
}

function extractArticleBody(html: string) {
  return html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? "";
}

function splitTerms(value: string) {
  return [...new Set(value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

async function readLimitedText(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new Error("A resposta excede o limite permitido.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("A resposta excede o limite permitido.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function privateAddress(value: string) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  const embedded = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const candidate = embedded ?? normalized;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) return false;
  const [a, b] = candidate.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || a >= 224;
}
