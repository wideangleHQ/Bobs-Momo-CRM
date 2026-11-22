/**
 * Prisma sizes its pool at 2 x CPU cores + 1 when the URL says nothing. On a
 * 12 core laptop that is 25 connections per client, against a Supabase Session
 * Pooler that allows 15 for the whole project, so one process was enough to
 * hit EMAXCONNSESSION. Every client in this app gets an explicit size instead.
 *
 * A `connection_limit` or `pool_timeout` already written in the URL wins: it is
 * a deliberate per-environment choice and this only fills the gap.
 */
export interface PoolSettings {
  limit: number;
  timeoutSeconds: number;
}

export function withPoolParams(url: string, pool: PoolSettings): string {
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(pool.limit));
  if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', String(pool.timeoutSeconds));
  return u.toString();
}

/** host:port plus the effective pool, safe to log: no user, password or database name. */
export function describePool(url: string): string {
  const u = new URL(url);
  const limit = u.searchParams.get('connection_limit') ?? 'default';
  const timeout = u.searchParams.get('pool_timeout') ?? 'default';
  return `${u.hostname}:${u.port || '5432'} connection_limit=${limit} pool_timeout=${timeout}s`;
}
