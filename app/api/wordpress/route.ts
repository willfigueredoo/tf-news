import { env } from "cloudflare:workers";
import { z } from "zod";
import { getRuntimeDb } from "../../../db/runtime";
import { isSafeHttpUrl } from "../../../lib/editorial";

const requestSchema = z.object({ action: z.enum(["test", "draft"]), articleId: z.number().int().positive().optional() });
type ArticleRow = { id: number; title: string; slug: string; excerpt: string; content: string };

function config() {
  const runtime = env as unknown as { WORDPRESS_BASE_URL?: string; WORDPRESS_USERNAME?: string; WORDPRESS_APPLICATION_PASSWORD?: string };
  return { baseUrl: runtime.WORDPRESS_BASE_URL?.replace(/\/+$/, ""), username: runtime.WORDPRESS_USERNAME, password: runtime.WORDPRESS_APPLICATION_PASSWORD };
}

export async function GET() {
  const current = config();
  return Response.json({ configured: Boolean(current.baseUrl && current.username && current.password), baseUrl: current.baseUrl ? new URL(current.baseUrl).origin : null, draftOnly: true });
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const current = config();
    if (!current.baseUrl || !current.username || !current.password) return Response.json({ error: "Configure as variáveis do WordPress no ambiente do site." }, { status: 409 });
    if (!isSafeHttpUrl(current.baseUrl) || !current.baseUrl.startsWith("https://")) return Response.json({ error: "O WordPress precisa usar uma URL HTTPS pública." }, { status: 400 });
    const authorization = `Basic ${btoa(`${current.username}:${current.password}`)}`;
    if (input.action === "test") {
      const response = await fetch(`${current.baseUrl}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Falha de autenticação no WordPress (${response.status}).`);
      const profile = await response.json() as { name?: string };
      return Response.json({ connected: true, user: profile.name ?? current.username });
    }
    if (!input.articleId) return Response.json({ error: "Selecione um artigo." }, { status: 400 });
    const db = await getRuntimeDb();
    const existing = await db.prepare("SELECT wordpress_post_id, wordpress_url, wordpress_status FROM wordpress_publications WHERE article_id = ?").bind(input.articleId).first<Record<string, unknown>>();
    if (existing) return Response.json({ error: "Este artigo já foi enviado ao WordPress.", publication: existing }, { status: 409 });
    const article = await db.prepare("SELECT id, title, slug, excerpt, content FROM articles WHERE id = ?").bind(input.articleId).first<ArticleRow>();
    if (!article) return Response.json({ error: "Artigo não encontrado." }, { status: 404 });
    const response = await fetch(`${current.baseUrl}/wp-json/wp/v2/posts`, {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ title: article.title, slug: article.slug, excerpt: article.excerpt, content: article.content, status: "draft" }),
    });
    const payload = await response.json() as { id?: number; link?: string; status?: string; message?: string };
    if (!response.ok || !payload.id) throw new Error(payload.message ?? `O WordPress respondeu com status ${response.status}.`);
    await db.prepare("INSERT INTO wordpress_publications (article_id, wordpress_post_id, wordpress_url, wordpress_status, created_at) VALUES (?, ?, ?, 'draft', ?)").bind(article.id, payload.id, payload.link ?? null, new Date().toISOString()).run();
    return Response.json({ success: true, postId: payload.id, url: payload.link ?? null, status: "draft" }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Falha no WordPress." }, { status: 400 }); }
}

