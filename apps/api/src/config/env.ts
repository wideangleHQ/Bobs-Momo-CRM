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
  return cached;
}

export function corsOrigins(): string[] {
  return env()
    .CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// The two secrets doing double duty would make a refresh token a valid access
// token. Cheap check, catastrophic miss.
export function assertSecretsDiffer(): void {
  const e = env();
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
}
