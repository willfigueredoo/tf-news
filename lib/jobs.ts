export async function acquireJobLock(db: D1Database, name: string, ttlSeconds: number) {
  const owner = crypto.randomUUID();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const result = await db.prepare("INSERT INTO job_locks (name, owner, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, locked_until=excluded.locked_until, updated_at=excluded.updated_at WHERE job_locks.locked_until < excluded.updated_at")
    .bind(name, owner, lockedUntil, now.toISOString()).run();
  return result.meta.changes > 0 ? owner : null;
}

export async function releaseJobLock(db: D1Database, name: string, owner: string) {
  await db.prepare("DELETE FROM job_locks WHERE name = ? AND owner = ?").bind(name, owner).run();
}
