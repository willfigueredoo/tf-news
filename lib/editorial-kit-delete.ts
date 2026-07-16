import type { Database } from "../db/runtime.ts";

export type EditorialKitDeletionResult = {
  deleted: boolean;
  kitId: number;
  newsItemId: number | null;
  removedRelations: number;
};

export async function deleteEditorialKit(db: Database, kitId: number): Promise<EditorialKitDeletionResult> {
  const kit = await db.prepare("SELECT id, news_item_id FROM editorial_kits WHERE id = ?")
    .bind(kitId)
    .first<{ id: number; news_item_id: number }>();
  if (!kit) return { deleted: false, kitId, newsItemId: null, removedRelations: 0 };

  const [relations, deletedKit] = await db.batch([
    db.prepare("DELETE FROM editorial_kit_sources WHERE editorial_kit_id = ? RETURNING id").bind(kitId),
    db.prepare("DELETE FROM editorial_kits WHERE id = ? RETURNING id").bind(kitId),
  ]);

  if (!deletedKit.meta.changes) {
    throw new Error("O Kit Editorial não pôde ser excluído atomicamente.");
  }

  return {
    deleted: true,
    kitId,
    newsItemId: kit.news_item_id,
    removedRelations: relations.meta.changes,
  };
}

export function isEditorialDeleteAuthorized(request: Request, environment = process.env.NODE_ENV) {
  const authenticatedEmail = request.headers.get("oai-authenticated-user-email")?.trim();
  if (authenticatedEmail) return true;
  if (environment === "production") return false;

  try {
    const hostname = new URL(request.url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}
