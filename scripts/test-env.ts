// Bun loads .env from the working directory, so `bun test` typed at the repo
// root ran the API suite with no DATABASE_URL and buried the real result under
// a page of Prisma internals. Preloaded for every test run, so the suite works
// from wherever it is invoked.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const loadedFromEnv = { skip: Boolean(process.env['DATABASE_URL']) };
if (!process.env['DATABASE_URL']) {
  const envPath = join(import.meta.dir, '..', 'apps', 'api', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = (raw ?? '').trim().replace(/^["']|["']$/g, '');
    }
  }
}

// The fallback above is a convenience for a local database. apps/api/.env can
// just as easily point at the shared Supabase project, and the e2e suites create,
// mutate and delete rows. If the fallback produced a non-local database, drop it
// so the suite fails loudly instead of writing to shared data. Exporting
// DATABASE_URL yourself, or ALLOW_REMOTE_TEST_DB=1, remains an explicit choice.
if (!loadedFromEnv.skip && process.env['ALLOW_REMOTE_TEST_DB'] !== '1') {
  const url = process.env['DATABASE_URL'];
  let host = '';
  try {
    host = url ? new URL(url).hostname : '';
  } catch {
    host = '';
  }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal'];
  if (url && !local.includes(host)) {
    delete process.env['DATABASE_URL'];
    delete process.env['DIRECT_URL'];
    console.error(
      `[test-env] apps/api/.env points at a non-local database (host: ${host}). ` +
        'It was NOT used. Export a local DATABASE_URL/DIRECT_URL/REDIS_URL, or set ' +
        'ALLOW_REMOTE_TEST_DB=1 if you really mean it. DB-backed suites will fail.',
    );
  }
}

// Cron jobs firing under test would race the assertions.
process.env['JOBS_ENABLED'] ??= 'false';

// The NestJS suite additionally needs apps/api as the working directory, or
// Bun resolves the root tsconfig and the decorator metadata never gets emitted.
// `bun run test` handles that. Bare `bun test` at the root will not.
