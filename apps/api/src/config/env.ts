import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  API_PREFIX: z.string().default('api/v1'),
  TZ: z.string().default('Asia/Kolkata'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(30),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  WHATSAPP_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Failed sign-ins per client address per 15 minutes before further attempts are
  // refused. The test runner raises it so one suite's wrong-password tests cannot
  // throttle the next; production uses the default.
  LOGIN_IP_FAILURE_LIMIT: z.coerce.number().int().positive().default(20),
  // Connections the main Prisma client may hold. Applied only when DATABASE_URL has
  // no connection_limit of its own. Unset: 5 in production, 10 under test (local
  // Postgres has no cap), 3 otherwise. The Supabase Session Pooler allows 15 for
  // the whole project, shared by every process pointed at it.
  DB_POOL_SIZE: z.coerce.number().int().positive().optional(),
  // Seconds a query waits for a free pooled connection before failing.
  DB_POOL_TIMEOUT_S: z.coerce.number().int().positive().default(20),
  SLOW_REQUEST_MS: z.coerce.number().int().positive().default(1000),
  SLOW_QUERY_MS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail at boot with the exact missing keys, not on the first request.
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  // Every suite signs in from one address and several fail on purpose, so the
  // limiter is effectively off under `bun test` unless a test sets its own limit.
  if (cached.NODE_ENV === 'test' && process.env['LOGIN_IP_FAILURE_LIMIT'] === undefined) {
    cached.LOGIN_IP_FAILURE_LIMIT = 100_000;
  }
  return cached;
}

/** Pool size for the main Prisma client. See DB_POOL_SIZE above for the budget. */
export function dbPoolSize(): number {
  const e = env();
  if (e.DB_POOL_SIZE !== undefined) return e.DB_POOL_SIZE;
  if (e.NODE_ENV === 'production' || e.NODE_ENV === 'staging') return 5;
  return e.NODE_ENV === 'test' ? 10 : 3;
}

/**
 * The browser sends Origin as scheme://host[:port] with no path and no trailing
 * slash, and the cors middleware compares it byte for byte. A value pasted into a
 * dashboard as `https://crm.example.com/` or with surrounding quotes or spaces
 * would match nothing and the preflight would come back with no
 * Access-Control-Allow-Origin, so each entry is normalised first.
 * A wildcard is refused outright: credentials are on, and the browser rejects `*`
 * with credentials anyway.
 */
export function parseCorsOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (origins.includes('*')) throw new Error('CORS_ORIGINS must list explicit origins, not *');
  return [...new Set(origins)];
}

export function corsOrigins(): string[] {
  return parseCorsOrigins(env().CORS_ORIGINS);
}

/** Shared by main.ts and the CORS tests so they cannot drift apart. */
export function corsOptions() {
  return { origin: corsOrigins(), credentials: true };
}

// The two secrets doing double duty would make a refresh token a valid access
// token. Cheap check, catastrophic miss.
export function assertSecretsDiffer(): void {
  const e = env();
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
}
