type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

export function rateLimit(request: Request, scope: string, limit = 30, windowMs = 60_000) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = `${scope}:${forwarded || "unknown"}`;
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    cleanup(now);
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return Response.json({ error: "Muitas solicitações. Tente novamente em instantes." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
}

function cleanup(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
}
