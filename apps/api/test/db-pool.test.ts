import { describe, expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { createLimiter } from '../src/common/concurrency/limiter';
import { describePool, withPoolParams } from '../src/common/prisma/database-url';

describe('withPoolParams', () => {
  const pool = { limit: 3, timeoutSeconds: 20 };

  test('fills in a missing limit and timeout', () => {
    const out = new URL(withPoolParams('postgresql://u:p@host.example:5432/postgres', pool));
    expect(out.searchParams.get('connection_limit')).toBe('3');
    expect(out.searchParams.get('pool_timeout')).toBe('20');
  });

  test('keeps values already in the URL', () => {
    const out = new URL(
      withPoolParams('postgresql://u:p@host.example:5432/postgres?connection_limit=7&pool_timeout=5', pool),
    );
    expect(out.searchParams.get('connection_limit')).toBe('7');
    expect(out.searchParams.get('pool_timeout')).toBe('5');
  });

  test('keeps other parameters such as schema', () => {
    const out = new URL(withPoolParams('postgresql://u:p@localhost:54322/db?schema=public', pool));
    expect(out.searchParams.get('schema')).toBe('public');
  });

  test('description never contains credentials or the database name', () => {
    const text = describePool(withPoolParams('postgresql://someuser:s3cret@host.example:5432/mydb', pool));
    expect(text).toBe('host.example:5432 connection_limit=3 pool_timeout=20s');
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('someuser');
    expect(text).not.toContain('mydb');
  });
});

describe('createLimiter', () => {
  test('never runs more than max tasks at once and returns every result in order', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, (_, i) =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return i;
      }),
    );
    expect(await Promise.all(tasks)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peak).toBe(3);
  });

  test('a rejected task frees its slot and rejects only itself', async () => {
    const limit = createLimiter(1);
    const bad = limit(() => Promise.reject(new Error('boom')));
    const good = limit(async () => 'ok');
    await expect(bad).rejects.toThrow('boom');
    expect(await good).toBe('ok');
  });

  test('rejects a non-positive size', () => {
    expect(() => createLimiter(0)).toThrow();
  });
});

describe('database faults reach the client as 503, not 500', () => {
  const run = (exception: unknown) => {
    const out: { status?: number; headers: Record<string, string>; body?: { error: { code: string } } } = { headers: {} };
    const res = {
      status(s: number) {
        out.status = s;
        return res;
      },
      setHeader(k: string, v: string) {
        out.headers[k] = v;
      },
      json(b: { error: { code: string } }) {
        out.body = b;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ headers: {}, method: 'GET', url: '/x' }) }),
    };
    new AllExceptionsFilter().catch(exception, host as never);
    return out;
  };
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

  test('pool timeout (P2024) and unreachable database (P1001)', () => {
    for (const code of ['P2024', 'P1001']) {
      const out = run(known(code));
      expect(out.status).toBe(503);
      expect(out.body?.error.code).toBe('COMMON_UNAVAILABLE');
      expect(out.headers['Retry-After']).toBe('2');
    }
  });

  test('the Supabase pooler refusing a session (EMAXCONNSESSION)', () => {
    const err = new Prisma.PrismaClientUnknownRequestError('FATAL: (EMAXCONNSESSION) max clients reached in session mode', {
      clientVersion: 'test',
    });
    expect(run(err).status).toBe(503);
  });

  test('a normal unique violation is still a 409 and an unknown error still a 500', () => {
    expect(run(known('P2002')).status).toBe(409);
    expect(run(new Error('bug')).status).toBe(500);
  });
});
