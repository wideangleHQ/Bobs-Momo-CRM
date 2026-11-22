/**
 * Caps how many of one request's queries are in flight at once. Each caller
 * makes its own limiter, so it bounds a single fan-out (a dashboard) without
 * serialising unrelated requests the way a process-wide queue would.
 *
 *   const limit = createLimiter(3);
 *   const [a, b] = await Promise.all([limit(() => qa()), limit(() => qb())]);
 *
 * Tasks start in call order. A rejected task rejects its own promise only; the
 * slot is freed either way.
 */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) throw new Error(`limiter needs a positive integer, got ${max}`);
  let active = 0;
  const waiting: Array<() => void> = [];

  // A finishing task hands its slot straight to the next waiter instead of
  // freeing it, so a caller arriving in between cannot take it and push the
  // count over `max`.
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
