import { z } from "zod";
import { getRuntimeDb, type Database } from "../../../db/runtime";
import { acquireJobLock, releaseJobLock } from "../../../lib/jobs";
import { getWordPressConfig } from "../../../lib/runtime-config";
import { createWordPressDraft, listWordPressTaxonomies, testWordPressConnection, wordPressConfigured } from "../../../lib/wordpress";

const requestSchema = z.object({
  action: z.enum(["test", "taxonomies", "draft"]),
  articleId: z.number().int().positive().optional(),
  categoryIds: z.array(z.number().int().positive()).max(20).default([]),
  tagIds: z.array(z.number().int().positive()).max(50).default([]),
});
type ArticleRow = { id: number; title: string; slug: string; excerpt: string; content: string };

export async function GET() {
  const config = getWordPressConfig();
  return Response.json({ configured: wordPressConfigured(config), baseUrl: config.baseUrl ? new URL(config.baseUrl).origin : null, draftOnly: true });
}

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  let db: Database | null = null;
  let lockOwner: string | null = null;
  let lockName = "";
  try {
    const input = requestSchema.parse(await request.json());
    const config = getWordPressConfig();
    if (input.action === "test") return Response.json(await testWordPressConnection(config));
    if (input.action === "taxonomies") return Response.json(await listWordPressTaxonomies(config));
    if (!input.articleId) return Response.json({ error: "Selecione um artigo antes de enviar." }, { status: 400 });
    db = await getRuntimeDb();
    const existing = await db.prepare("SELECT wordpress_post_id, wordpress_url, wordpress_edit_url, wordpress_status FROM wordpress_publications WHERE article_id = ?").bind(input.articleId).first<Record<string, unknown>>();
    if (existing) return Response.json({ postId: existing.wordpress_post_id, url: existing.wordpress_url, editUrl: existing.wordpress_edit_url, status: existing.wordpress_status, alreadySent: true });
    lockName = `wordpress:${input.articleId}`;
    lockOwner = await acquireJobLock(db, lockName, 120);
    if (!lockOwner) return Response.json({ error: "Este artigo já está sendo enviado ao WordPress." }, { status: 409 });
    const article = await db.prepare("SELECT id, title, slug, excerpt, content FROM articles WHERE id = ?").bind(input.articleId).first<ArticleRow>();
    if (!article) return Response.json({ error: "Artigo não encontrado." }, { status: 404 });
    const result = await createWordPressDraft(config, { ...article, categoryIds: input.categoryIds, tagIds: input.tagIds });
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO wordpress_publications (article_id, wordpress_post_id, wordpress_url, wordpress_edit_url, wordpress_status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)").bind(article.id, result.postId, result.url, result.editUrl, now),
      db.prepare("UPDATE articles SET status = 'sent', updated_at = ? WHERE id = ?").bind(now, article.id),
      db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, metadata) VALUES ('wordpress', 'success', ?, ?, 1, ?)").bind(startedAt, now, JSON.stringify({ articleId: article.id, postId: result.postId, recoveredExistingDraft: result.existed })),
    ]);
    return Response.json({ ...result, alreadySent: result.existed }, { status: result.existed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no WordPress.";
    if (db) {
      try { await db.prepare("INSERT INTO job_logs (job_type, status, started_at, finished_at, processed_items, error_message) VALUES ('wordpress', 'failed', ?, ?, 0, ?)").bind(startedAt, new Date().toISOString(), message.slice(0, 800)).run(); } catch { /* preserve the original integration error */ }
    }
    return Response.json({ error: message }, { status: 400 });
  } finally {
    if (db && lockOwner && lockName) await releaseJobLock(db, lockName, lockOwner);
  }
}
