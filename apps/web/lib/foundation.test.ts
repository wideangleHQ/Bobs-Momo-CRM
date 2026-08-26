import { expect, test, afterEach } from 'bun:test';
import { money, qty, shortDate, longDate, time, relative, duration } from './format';
import { apiGet, ApiError, errorMessage, setAccessToken } from './api';

test('money uses Indian grouping and two decimals', () => {
  expect(money('4427.5')).toBe('Rs 4,427.50');
  expect(money(123456.78)).toBe('Rs 1,23,456.78');
});

test('quantity pads to three decimals and takes a unit', () => {
  expect(qty('15')).toBe('15.000');
  expect(qty('12.4', 'KG')).toBe('12.400 KG');
});

test('dates and times render in IST whatever the device clock says', () => {
  expect(shortDate('2026-08-26')).toBe('26 Aug');
  expect(longDate('2026-08-26')).toBe('26 Aug 2026');
  // 03:54 UTC is 09:24 IST.
  expect(time('2026-08-26T03:54:00.000Z')).toBe('09:24');
});

test('relative and duration', () => {
  expect(relative(new Date(Date.now() - 2 * 3600 * 1000).toISOString())).toBe('2 hours ago');
  expect(duration(206)).toBe('3h 26m');
  expect(duration(26)).toBe('26m');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setAccessToken(null);
});

test('concurrent 401s share one refresh, then each retries once', async () => {
  let refreshes = 0;
  let dataCalls = 0;
  // @ts-expect-error a two field stub is enough for the code path under test
  globalThis.fetch = async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith('/auth/refresh')) {
      refreshes += 1;
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({ accessToken: 'fresh' }), { status: 200 });
    }
    dataCalls += 1;
    // Every first attempt is unauthorised; the retry carries the new token.
    if (dataCalls <= 3) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  setAccessToken('stale');
  const results = await Promise.all([
    apiGet<{ ok: boolean }>('/inventory/stock'),
    apiGet<{ ok: boolean }>('/tasks'),
    apiGet<{ ok: boolean }>('/notifications'),
  ]);

  // Three refreshes would present a rotated token twice and kill the family.
  expect(refreshes).toBe(1);
  expect(dataCalls).toBe(6);
  expect(results.every((r) => r.ok)).toBe(true);
});

test('an error envelope becomes an ApiError carrying code and requestId', async () => {
  // @ts-expect-error a one field stub is enough here
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: 'INVENTORY_NEGATIVE_STOCK_BLOCKED', message: 'Only 2.400 KG on hand.', requestId: '01JTEST' },
      }),
      { status: 422 },
    );

  await expect(apiGet('/inventory/stock')).rejects.toMatchObject({
    name: 'ApiError',
    status: 422,
    code: 'INVENTORY_NEGATIVE_STOCK_BLOCKED',
    requestId: '01JTEST',
  });
  expect(new ApiError(422, 'X', 'y')).toBeInstanceOf(Error);
});

// A lockout that says "try again shortly" for a twelve minute wait teaches the
// user nothing, so they keep retrying. The API sends the seconds; show them.
test('errorMessage surfaces the lockout wait time', () => {
  const locked = new ApiError(423, 'AUTH_ACCOUNT_LOCKED', 'Too many attempts. Try again shortly', {
    retryAfterSeconds: 741,
  });
  expect(errorMessage(locked)).toBe('Too many attempts. Try again shortly. Try again in 13 minutes');

  const nearly = new ApiError(423, 'AUTH_ACCOUNT_LOCKED', 'Too many attempts', {
    retryAfterSeconds: 45,
  });
  expect(errorMessage(nearly)).toBe('Too many attempts. Try again in 45 seconds');

  const one = new ApiError(429, 'COMMON_RATE_LIMITED', 'Slow down', { retryAfterSeconds: 60 });
  expect(errorMessage(one)).toBe('Slow down. Try again in 1 minute');

  // No retry hint means no invented one.
  const plain = new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Wrong username or password');
  expect(errorMessage(plain)).toBe('Wrong username or password');
});
