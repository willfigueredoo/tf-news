export const EDITORIAL_POLICY_VERSION = "2026.07-imparcialidade-v1";

export const EDITORIAL_TECHNICAL_EDITOR_PROMPT = [
  "Você atua como Editor Técnico do TF News.",
  "O TF News não é um portal de opinião e não representa posicionamentos institucionais da TransFAST.",
  "Nunca produza opiniões próprias, posicionamentos políticos ou linguagem sensacionalista.",
  "Nunca escolha um lado em temas controversos; apresente os posicionamentos divergentes com atribuição e informe quando o tema permanecer em discussão.",
  "Nunca invente informações, números, projeções, relações causais ou fontes.",
  "Toda afirmação relevante, todo número e toda projeção devem possuir atribuição rastreável à fonte que os produziu.",
  "Projeções só podem ser apresentadas quando vierem de órgão oficial, pesquisa reconhecida, consultoria identificada, instituição pública ou organismo internacional.",
  "Explique impactos como possibilidades atribuídas, nunca como resultados garantidos.",
  "Caso não exista confirmação suficiente, informe explicitamente que a informação ainda depende de confirmação editorial.",
  "Comunicados empresariais só são fonte primária para investimentos, resultados, operações e comunicados da própria empresa; nunca os use como comprovação de fatos externos.",
  "Priorize nesta ordem: fontes oficiais, bases estatísticas, reguladores, pesquisa pública, pesquisa acadêmica, organizações internacionais, agências de notícias, imprensa especializada, associações e empresas diretamente envolvidas.",
  "Use linguagem factual como 'Segundo...', 'De acordo com...', 'Conforme divulgado...' ou '[entidade] informou...'.",
].join(" ");

export const EDITORIAL_TRANSPARENCY_TEXT = [
  "Este conteúdo foi elaborado a partir de fontes oficiais e veículos jornalísticos de alta credibilidade.",
  "Seu objetivo é informar e contextualizar fatos relevantes para o setor logístico.",
  "As interpretações apresentadas são sempre atribuídas às respectivas fontes consultadas.",
];

export type TraceableEditorialSource = {
  name: string;
  url: string;
  title?: string | null;
  publisher?: string | null;
  sourceId?: number | null;
  sourceType?: string | null;
  primaryOrSecondary?: "primary" | "secondary" | "contextual" | null;
  authorityLevel?: "high" | "medium" | "low" | null;
  publishedAt?: string | null;
};

const ATTRIBUTION = /\b(segundo|de acordo com|conforme (?:divulgado|publicado|informado)|dados (?:do|da|de)|informou|afirmou|avaliou|estimou|projetou|apontou|registrou|comunicou|relatou)\b/iu;
const UNATTRIBUTED_OPINION = [
  /\bacredita-se\b/iu,
  /\bprovavelmente\b/iu,
  /\bsem dúvida\b/iu,
  /\bcertamente\b/iu,
  /\bisso demonstra que\b/iu,
  /\bisso comprova que\b/iu,
  /\ba medida será (?:positiva|negativa)\b/iu,
  /\bo mercado deve reagir\b/iu,
  /\bo governo (?:acertou|errou)\b/iu,
  /\bo setor foi (?:beneficiado|prejudicado)\b/iu,
];
const SENSATIONALISM = /\b(chocante|bombástico|escândalo|imperdível|revolucionário|vai mudar tudo|catástrofe inevitável)\b/iu;
const PROJECTION = /\b(pode(?:rá)?\s+\p{L}+|deve(?:rá)?\s+\p{L}+|tende a|há expectativa de|vai provocar|vai causar)\b/iu;
const RELEVANT_NUMBER = /(?:R\$\s*)?\b\d+(?:[.,]\d+)?\s*(?:%|milh(?:ão|ões)|bilh(?:ão|ões)|toneladas?|reais|dólares?|postos?|unidades?)\b/iu;

export function applyPermanentEditorialPolicy(html: string, sources: TraceableEditorialSource[]) {
  const base = html
    .replace(/<section\s+data-tf-news-sources[\s\S]*?<\/section>/giu, "")
    .replace(/<aside\s+data-tf-news-transparency[\s\S]*?<\/aside>/giu, "")
    .trim();
  return `${base}\n${traceableSourcesHtml(sources)}\n${transparencyHtml()}`;
}

export function findEditorialPolicyViolations(value: string) {
  const text = plainText(value);
  const sentences = text.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
  const violations: string[] = [];
  for (const sentence of sentences) {
    if (SENSATIONALISM.test(sentence)) violations.push("linguagem sensacionalista");
    const attributed = ATTRIBUTION.test(sentence);
    if (!attributed && UNATTRIBUTED_OPINION.some((pattern) => pattern.test(sentence))) violations.push("opinião sem atribuição");
    if (!attributed && PROJECTION.test(sentence)) violations.push("projeção ou impacto sem atribuição");
    if (!attributed && RELEVANT_NUMBER.test(sentence)) violations.push("dado numérico sem origem atribuída");
  }
  return violations;
}

function traceableSourcesHtml(sources: TraceableEditorialSource[]) {
  const unique = new Map<string, TraceableEditorialSource>();
  for (const source of sources) if (!unique.has(source.url)) unique.set(source.url, source);
  const items = [...unique.values()].map((source) => {
    const label = source.title || source.publisher || source.name;
    const type = humanize(source.sourceType || "não classificada");
    const role = source.primaryOrSecondary === "primary" ? "Primária" : source.primaryOrSecondary === "secondary" ? "Secundária" : "Contextual";
    return `<li><a href="${escapeHtml(source.url)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(label)}</a><br><small>Fonte: ${escapeHtml(source.publisher || source.name)} · Tipo: ${escapeHtml(type)} · ${role}</small></li>`;
  }).join("");
  return `<section data-tf-news-sources="${EDITORIAL_POLICY_VERSION}"><h2>Fontes consultadas</h2><ul>${items}</ul></section>`;
}

function transparencyHtml() {
  return `<aside data-tf-news-transparency="${EDITORIAL_POLICY_VERSION}"><hr>${EDITORIAL_TRANSPARENCY_TEXT.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</aside>`;
}

function plainText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/\s+/g, " ").trim();
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/^./u, (character) => character.toLocaleUpperCase("pt-BR"));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}
