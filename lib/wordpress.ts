import { isSafeHttpUrl } from "./editorial.ts";

export type WordPressConfig = { baseUrl: string; username: string; password: string };
type FetchLike = typeof fetch;

export function wordPressConfigured(config: WordPressConfig) {
  return Boolean(config.baseUrl && config.username && config.password);
}

export async function testWordPressConnection(config: WordPressConfig, fetchImpl: FetchLike = fetch) {
  validateConfig(config);
  const response = await wpFetch(config, "/wp-json/wp/v2/users/me?context=edit", { method: "GET" }, fetchImpl);
  const profile = await response.json() as { id?: number; name?: string; slug?: string; roles?: string[]; capabilities?: Record<string, boolean> };
  const permissions = {
    editPosts: Boolean(profile.capabilities?.edit_posts),
    createPosts: Boolean(profile.capabilities?.create_posts || profile.capabilities?.edit_posts),
    publishPosts: Boolean(profile.capabilities?.publish_posts),
    editOthersPosts: Boolean(profile.capabilities?.edit_others_posts),
    manageCategories: Boolean(profile.capabilities?.manage_categories),
  };
  return {
    connected: true,
    userId: profile.id ?? null,
    user: profile.name || profile.slug || config.username,
    roles: Array.isArray(profile.roles) ? profile.roles.map(String) : [],
    permissions,
    canCreateDrafts: permissions.createPosts,
  };
}

export async function listWordPressTaxonomies(config: WordPressConfig, fetchImpl: FetchLike = fetch) {
  validateConfig(config);
  const [categoriesResponse, tagsResponse] = await Promise.all([
    wpFetch(config, "/wp-json/wp/v2/categories?context=view&per_page=100&orderby=name", { method: "GET" }, fetchImpl),
    wpFetch(config, "/wp-json/wp/v2/tags?context=view&per_page=100&orderby=name", { method: "GET" }, fetchImpl),
  ]);
  const schema = (value: unknown) => Array.isArray(value) ? value.map((item) => item as { id?: number; name?: string; slug?: string }).filter((item) => Number.isInteger(item.id) && item.name).map((item) => ({ id: item.id as number, name: item.name as string, slug: item.slug ?? "" })) : [];
  return { categories: schema(await categoriesResponse.json()), tags: schema(await tagsResponse.json()) };
}

export async function createWordPressDraft(config: WordPressConfig, article: { title: string; slug: string; excerpt: string; content: string; categoryIds?: number[]; tagIds?: number[] }, fetchImpl: FetchLike = fetch) {
  validateConfig(config);
  const lookup = await wpFetch(config, `/wp-json/wp/v2/posts?context=edit&per_page=1&slug=${encodeURIComponent(article.slug)}`, { method: "GET" }, fetchImpl);
  const existing = await lookup.json() as Array<{ id?: number; link?: string; status?: string }>;
  if (existing[0]?.id) {
    if (existing[0].status !== "draft") throw new Error("Já existe um post não editável com o mesmo slug no WordPress.");
    return normalizePost(config, existing[0], true);
  }
  const response = await wpFetch(config, "/wp-json/wp/v2/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      content: article.content,
      status: "draft",
      categories: article.categoryIds ?? [],
      tags: article.tagIds ?? [],
    }),
  }, fetchImpl);
  const payload = await response.json() as { id?: number; link?: string; status?: string };
  if (!payload.id || payload.status !== "draft") throw new Error("O WordPress não confirmou a criação do rascunho.");
  return normalizePost(config, payload, false);
}

function normalizePost(config: WordPressConfig, post: { id?: number; link?: string; status?: string }, existed: boolean) {
  const id = post.id as number;
  return { postId: id, url: post.link ?? null, editUrl: `${config.baseUrl}/wp-admin/post.php?post=${id}&action=edit`, status: "draft" as const, existed };
}

async function wpFetch(config: WordPressConfig, path: string, init: RequestInit, fetchImpl: FetchLike) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${base64(`${config.username}:${config.password}`)}`, Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let detail = "";
    try { const payload = await response.json() as { message?: string }; detail = payload.message ?? ""; } catch { /* ignore invalid error payload */ }
    throw new Error(detail || `O WordPress respondeu com status ${response.status}.`);
  }
  return response;
}

function validateConfig(config: WordPressConfig) {
  if (!wordPressConfigured(config)) throw new Error("Configure a URL e as credenciais de aplicação do WordPress.");
  if (!isSafeHttpUrl(config.baseUrl)) throw new Error("A URL do WordPress precisa ser pública e usar HTTPS.");
}

function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
