const FORBIDDEN_INTERNAL_TERMS = ["todos os icps", "score classificado", "impacto moderado", "icp selecionado"];

export function sanitizeWordPressHtml(value: string) {
  return value
    .replace(/<(script|style|iframe|object|embed|form|input|button)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|input|button)\b[^>]*\/?\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "$1=\"#\"")
    .trim();
}

export function validateArticleHtml(html: string) {
  if (html.length < 800) throw new Error("O artigo gerado ficou curto demais para publicação editorial.");
  if (!/<h2\b/i.test(html) || !/<h3\b/i.test(html) || !/<(ul|ol)\b/i.test(html)) {
    throw new Error("O artigo precisa conter H2, H3 e ao menos uma lista.");
  }
  const normalized = html.toLowerCase();
  const forbidden = FORBIDDEN_INTERNAL_TERMS.find((term) => normalized.includes(term));
  if (forbidden) throw new Error(`O artigo contém o termo interno proibido: ${forbidden}.`);
  return true;
}

export function appendTraceableSources(html: string, sources: Array<{ sourceName: string; title: string; originalUrl: string }>) {
  const withoutExistingHeading = html.replace(/<h2[^>]*>\s*Fontes(?: consultadas)?\s*<\/h2>[\s\S]*$/i, "").trim();
  const list = sources.map((source) => `<li><a href="${escapeHtml(source.originalUrl)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(source.sourceName)} — ${escapeHtml(source.title)}</a></li>`).join("");
  return `${withoutExistingHeading}\n<h2>Fontes consultadas</h2><ul>${list}</ul>`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}
