import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { corsOptions, parseCorsOrigins } from '../src/config/env';

const PROD = 'https://crm.bobsmomo.com';
const LOCAL = 'http://localhost:3000';

describe('parseCorsOrigins', () => {
  test('splits, trims and drops empties', () => {
    expect(parseCorsOrigins(` ${PROD} , ${LOCAL},, `)).toEqual([PROD, LOCAL]);
  });
  test('removes trailing slashes, quotes and duplicates', () => {
    expect(parseCorsOrigins(`"${PROD}/", '${PROD}'`)).toEqual([PROD]);
  });
  test('refuses a wildcard', () => {
    expect(() => parseCorsOrigins('*')).toThrow();
    expect(() => parseCorsOrigins(`${PROD},*`)).toThrow();
  });
});

describe('preflight against a Nest app using corsOptions()', () => {
  let app: INestApplication;
  let base = '';

  beforeAll(async () => {
    process.env['CORS_ORIGINS'] = `${PROD}/, ${LOCAL}`;
    const mod = await Test.createTestingModule({}).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.enableCors(corsOptions());
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => app?.close());

  const preflight = (origin: string) =>
    fetch(`${base}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization,idempotency-key,x-refresh-request',
      },
    });

  test('the production frontend is allowed, with credentials, and its headers and method', async () => {
    const r = await preflight(PROD);
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(PROD);
    expect(r.headers.get('access-control-allow-credentials')).toBe('true');
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
    const headers = r.headers.get('access-control-allow-headers')?.toLowerCase() ?? '';
    for (const h of ['content-type', 'authorization', 'idempotency-key', 'x-refresh-request']) {
      expect(headers).toContain(h);
    }
  });

  test('local development is still allowed', async () => {
    expect((await preflight(LOCAL)).headers.get('access-control-allow-origin')).toBe(LOCAL);
  });

  test('another origin gets no allow-origin header, and the answer is never a wildcard', async () => {
    for (const origin of ['https://evil.example', 'https://crm.bobsmomo.com.evil.example', 'http://crm.bobsmomo.com']) {
      const r = await preflight(origin);
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});
