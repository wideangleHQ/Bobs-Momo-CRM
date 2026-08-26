// Bun loads .env from the working directory, so `bun test` typed at the repo
// root ran the API suite with no DATABASE_URL and buried the real result under
// a page of Prisma internals. Preloaded for every test run, so the suite works
// from wherever it is invoked.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// Cron jobs firing under test would race the assertions.
process.env['JOBS_ENABLED'] ??= 'false';

// The NestJS suite additionally needs apps/api as the working directory, or
// Bun resolves the root tsconfig and the decorator metadata never gets emitted.
// `bun run test` handles that. Bare `bun test` at the root will not.
