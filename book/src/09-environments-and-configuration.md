# Environments and configuration

Three environments. Local runs on a laptop against containers. Staging runs on
Railway against a separate Supabase project. Production runs on Railway against
the real one. The code is identical in all three. Only `process.env` differs,
which is the property that makes a staging test worth anything.

## What each environment points at

| | Local | Staging | Production |
|---|---|---|---|
| Database | Postgres 15 in Docker, port 54322 | Supabase project `bobsmomo-staging`, pooler 6543 | Supabase project `bobsmomo-prod`, pooler 6543 |
| Migrations run via | same container, port 54322 | `DIRECT_URL` port 5432, from CI | `DIRECT_URL` port 5432, from CI |
| Redis | Redis 7 in Docker, port 63790 | Upstash free tier, separate DB | Upstash Fixed 250 MB |
| Storage | Supabase staging bucket `task-proof-dev` | Supabase staging bucket `task-proof` | Supabase prod bucket `task-proof` |
| WhatsApp | logging stub, nothing sent | logging stub, nothing sent | WhatsApp Cloud API, live |
| Seed data | full seed, fake names | full seed, fake names | real master data only, no seed |
| Web URL | `http://localhost:3000` | `https://staging.bobsmomo.in` | `https://app.bobsmomo.in` |
| API URL | `http://localhost:3001` | `https://api-staging.bobsmomo.in` | `https://api.bobsmomo.in` |
| Log level | `debug` | `debug` | `info` |
| Who can access | any engineer | any engineer, plus client during UAT | two engineers with Railway access, owner via the app |

Neither local nor staging can send a WhatsApp message. `WHATSAPP_ENABLED=false`
selects a stub adapter that logs the rendered template, the recipient and the
parameters at `info` level and returns a fake provider reference. This is
deliberate. Meta bills per conversation, template quality ratings are scored on
real sends, and a test loop that fires 200 messages to a staff member's phone
at 2am is a way to get a number banned.

Staging uses its own Supabase project, not a schema inside production. A shared
project means one bad migration takes both down, and the whole point of staging
is that it is the place where a bad migration is allowed to happen.

Production has no seed. Master data (items, vendors, employees, outlets) is
loaded by an import script and reviewed by the client. Chapter 37 owns that
procedure.

## Environment variable reference

Required means the process refuses to boot without it. Optional means there is
a working default in the schema.

| Name | Example | Required in | Owner | What breaks if wrong |
|---|---|---|---|---|
| `NODE_ENV` | `production` | all | engineering | Nest disables the error filter's stack redaction outside production |
| `PORT` | `3001` | all | Railway injects it | Railway health check fails, service marked unhealthy and restarts |
| `DATABASE_URL` | `postgresql://postgres.abcd:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` | all | engineering | `P1001` at boot, or `prepared statement "s0" already exists` under load if `pgbouncer=true` is missing |
| `DIRECT_URL` | `postgresql://postgres.abcd:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` | all | engineering | `prisma migrate deploy` hangs on the advisory lock and the deploy times out |
| `REDIS_URL` | `rediss://default:token@apn1-xx.upstash.io:6379` | all | engineering | Cache and rate limiting are disabled, requests still succeed, latency rises |
| `JWT_ACCESS_SECRET` | 64 hex characters | all | engineering | Every request returns 401 `JWT malformed`. Changing it invalidates all live sessions |
| `JWT_REFRESH_SECRET` | 64 hex characters, different from the access secret | all | engineering | Refresh returns 401, users are logged out every 15 minutes |
| `ACCESS_TOKEN_TTL` | `15m` | optional, default `15m` | engineering | Too long widens the window on a stolen token, too short causes constant refreshes |
| `REFRESH_TOKEN_TTL` | `30d` | optional, default `30d` | engineering | Too short logs staff out mid-shift, which they will report as the app being broken |
| `ARGON2_MEMORY_COST` | `19456` | optional, default `19456` | engineering | Too high and login takes seconds or OOMs the container, too low and hashes are weak |
| `SUPABASE_URL` | `https://abcdefgh.supabase.co` | all | engineering | Photo upload returns 500, task completion with a required photo is blocked |
| `SUPABASE_SERVICE_ROLE_KEY` | JWT beginning `eyJ...` | all | engineering | Storage returns 403. This key bypasses row level security, treat it as a root credential |
| `SUPABASE_STORAGE_BUCKET` | `task-proof` | all | engineering | Uploads land in the wrong bucket, or 404 if it does not exist |
| `WHATSAPP_PHONE_NUMBER_ID` | `109876543210987` | production | client's Meta account | Meta returns 400 `Unsupported post request`, no messages send |
| `WHATSAPP_ACCESS_TOKEN` | long-lived system user token | production | client's Meta account | 401 from Meta. Expires if a short-lived token was used by mistake |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | 32 random characters | production | engineering | Meta's webhook verification handshake fails and delivery receipts stop |
| `WHATSAPP_ENABLED` | `false` local and staging, `true` production | all | engineering | If true outside production, real messages go to real phones from a test run |
| `APP_TIMEZONE` | `Asia/Kolkata` | all | engineering | Business dates shift by 5h30m, so late-night entries land on the wrong trading day |
| `BUSINESS_DAY_START_HOUR` | `4` | optional, default `4` | engineering | A closing checklist submitted at 00:30 is filed against the wrong business date |
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.bobsmomo.in/api/v1` | all, web app | engineering | Browser requests 404 or hit CORS. This value is compiled into the bundle |
| `CORS_ORIGINS` | `https://app.bobsmomo.in` | all | engineering | Browser blocks every API call with a CORS error. A wildcard here breaks cookie auth |
| `RATE_LIMIT_GLOBAL_PER_MIN` | `300` | optional, default `300` | engineering | Too low and staff hit 429 during closing, too high and the game page is open to abuse |
| `RATE_LIMIT_AUTH_PER_MIN` | `10` | optional, default `10` | engineering | Too high weakens brute-force protection on `/auth/login` |
| `RATE_LIMIT_GAME_PER_MIN` | `20` | optional, default `20` | engineering | Governs the public game endpoints, the only unauthenticated write path |
| `LOG_LEVEL` | `info` | optional, default `info` | engineering | `debug` in production floods Railway's log retention and can print request bodies |

Two notes on that table. `NEXT_PUBLIC_API_BASE_URL` is compiled into the
client bundle at build time, so changing it requires a rebuild of `web`, not a
restart. And `SUPABASE_SERVICE_ROLE_KEY` bypasses Postgres row level security
entirely. It never goes near the browser and it never appears in a log line.

## Config validation at boot

The application validates the entire environment once, at startup, before Nest
builds a single module. A missing variable is a boot failure with a readable
message, not a 500 three hours later when somebody opens the purchase screen.

```ts
// apps/api/src/common/config/env.schema.ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production'])
             .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url().startsWith('postgres'),
  DIRECT_URL:   z.string().url().startsWith('postgres'),
  REDIS_URL:    z.string().url().optional(),

  JWT_ACCESS_SECRET:  z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL:   z.string().default('15m'),
  REFRESH_TOKEN_TTL:  z.string().default('30d'),
  ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).default(19456),

  SUPABASE_URL:              z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  SUPABASE_STORAGE_BUCKET:   z.string().min(1).default('task-proof'),

  WHATSAPP_ENABLED: z.enum(['true', 'false']).default('false')
                     .transform((v) => v === 'true'),
  WHATSAPP_PHONE_NUMBER_ID:       z.string().optional(),
  WHATSAPP_ACCESS_TOKEN:          z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN:  z.string().optional(),

  CHAT_ENABLED: z.enum(['true', 'false']).default('true')
                 .transform((v) => v === 'true'),
  GAME_ENABLED: z.enum(['true', 'false']).default('true')
                 .transform((v) => v === 'true'),

  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  BUSINESS_DAY_START_HOUR: z.coerce.number().int().min(0).max(23)
                            .default(4),

  CORS_ORIGINS: z.string().transform((v) =>
                  v.split(',').map((s) => s.trim()).filter(Boolean)),

  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().default(300),
  RATE_LIMIT_AUTH_PER_MIN:   z.coerce.number().int().default(10),
  RATE_LIMIT_GAME_PER_MIN:   z.coerce.number().int().default(20),

  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace'])
              .default('info'),
})
.superRefine((env, ctx) => {
  if (env.WHATSAPP_ENABLED) {
    for (const key of ['WHATSAPP_PHONE_NUMBER_ID',
                       'WHATSAPP_ACCESS_TOKEN',
                       'WHATSAPP_WEBHOOK_VERIFY_TOKEN'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `required when WHATSAPP_ENABLED=true`,
        });
      }
    }
  }
  if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.includes('*')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGINS'],
      message: 'wildcard origin is not allowed in production',
    });
  }
});

export type Env = z.infer<typeof envSchema>;
```

The loader collects every problem before exiting, so one boot tells you about
all four missing keys instead of one per restart.

```ts
// apps/api/src/common/config/load-env.ts
export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map(
    (i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  console.error(
    [
      '',
      'Configuration is invalid. The API did not start.',
      `Found ${lines.length} problem(s) in the environment:`,
      '',
      ...lines,
      '',
      'Copy .env.example to apps/api/.env and fill in the blanks.',
      'See book chapter 09 for what each variable does.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
```

Real output from a fresh clone where somebody forgot to create `.env`:

```text
Configuration is invalid. The API did not start.
Found 5 problem(s) in the environment:

  DATABASE_URL: Required
  DIRECT_URL: Required
  JWT_ACCESS_SECRET: Required
  JWT_REFRESH_SECRET: Required
  SUPABASE_URL: Required

Copy .env.example to apps/api/.env and fill in the blanks.
See book chapter 09 for what each variable does.
```

`loadEnv()` is called from `main.ts` on the first line, before
`NestFactory.create`. The parsed object is registered as a provider so services
inject a typed `Env` rather than reading `process.env` directly. Reading
`process.env` anywhere outside this file is a review rejection: it bypasses
validation, loses the type, and is invisible to this chapter.

## Secret handling

`.env.example` is committed and contains every key with an empty or obviously
fake value. `.env`, `.env.local` and `.env.*.local` are in `.gitignore` and are
never committed. There is no exception to this, including "just for a minute so
the other engineer can see it".

Real values live in exactly two places: Railway's variable store for staging and
production, and a shared password manager vault for the credentials the client
owns. Nothing sits in Slack, WhatsApp or a ticket comment.

CI reads secrets from GitHub Actions repository secrets, scoped per
environment. The staging job cannot read production secrets.

### Rotation

| Secret | How | Effect on users |
|---|---|---|
| `JWT_ACCESS_SECRET` | Generate 64 hex chars, set in Railway, redeploy | Everyone is logged out. Do it outside 06:00 to 23:00 IST |
| `JWT_REFRESH_SECRET` | Same, and delete all `RefreshToken` rows in the same window | Everyone is logged out. Same timing rule |
| `DATABASE_URL` password | Rotate in the Supabase dashboard, update both `DATABASE_URL` and `DIRECT_URL` in Railway, redeploy | Roughly 30 seconds of failed requests during the redeploy |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard, API settings, roll the key | Photo upload fails until the redeploy completes |
| `REDIS_URL` token | Upstash console, reset password | None. Cache misses for a few seconds |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business Manager, system user, generate a new never-expiring token | Outbound WhatsApp pauses. Queued outbox events retry and catch up |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Generate, set in Railway, then re-verify the webhook in Meta | Delivery receipts stop until re-verified |

Rotate the JWT secrets on a fixed schedule of every 90 days, and immediately on
any suspicion. Rotate the rest on staff change or on suspicion.

### If a secret leaks

Rotate first, investigate second. The order matters because investigation takes
hours and rotation takes minutes.

For a leaked database password, rotate it in Supabase, update Railway, redeploy,
then read the Supabase connection logs for connections from unexpected IP
addresses. For a leaked service role key, roll it, then audit the storage bucket
for objects created outside business hours. For a leaked JWT secret, rotate it
and delete every `RefreshToken` row, which forces a full re-login.

If the secret reached a git commit, rotating is not enough on its own but it is
still the first step. Rewriting history with `git filter-repo` and force-pushing
comes after, and it does not help if the repository was ever cloned or if the
commit was pushed to a fork. Assume the value is public and treat rotation as
the real fix.

Every leak gets a written note in the incident log in chapter 36: what leaked,
where, when it was rotated, and what changed so it does not happen again.

## Feature flags

Three flags exist in Phase 1, all as environment booleans.

| Flag | Default | Controls |
|---|---|---|
| `WHATSAPP_ENABLED` | `false` | Selects the real Cloud API adapter or the logging stub. In-app notifications are unaffected |
| `CHAT_ENABLED` | `true` | The `messaging` module's routes and the chat entry in the web navigation |
| `GAME_ENABLED` | `true` | The public game page, the play and reward endpoints, and the CRM section of the dashboard |

Two of the three exist because of delivery risk rather than product choice.
WhatsApp depends on Meta approving a business account and a set of templates,
which is outside our control and has no committed timeline. Chat is
Should-Have in the SRS, so it is the first thing to drop if week three is
tight. The game layer carries the largest scope risk in the project, since the
SRS references section 15.7 and FR-CRM-001 and neither exists in the document.
Chapter 32 covers that gap. Each flag is the switch that lets the rest of the
system ship on time if one of those three does not land.

A flag turns a feature off at the module level, not with `if` statements
sprinkled through controllers. `AppModule` conditionally includes the module,
and the web app hides the navigation entry by reading a public flag from
`GET /api/v1/health/features`.

```ts
// app.module.ts
const env = loadEnv();

@Module({
  imports: [
    // ...always-on modules
    ...(env.CHAT_ENABLED ? [MessagingModule] : []),
    ...(env.GAME_ENABLED ? [CrmModule] : []),
  ],
})
export class AppModule {}
```

With the module absent, its routes return 404 rather than 403 or a broken page.
That is the correct answer: the feature does not exist in this deployment.

Environment booleans rather than a flag service, for three reasons that all
come down to size. A flag service (LaunchDarkly, Unleash, or a self-hosted
equivalent) costs money or an extra deployable, and both fight the Rs 5,000
ceiling from ADR-005. Nobody here needs a percentage rollout or a per-user
targeting rule, because there are 30 users in two buildings and a feature is
either on for everybody or off. And a flag that flips without a deploy is a
flag whose behaviour is not reproducible from a git commit, which is a bad
trade when the team is two people and the debugging tool of choice is "check
out the commit that was running".

The cost is real: changing a flag needs a Railway variable edit and a restart,
which is roughly 90 seconds of downtime on Hobby. At three flags and an
expected handful of changes across the whole project, that is a fine price.

Flags are not permanent. Each one has an exit condition. `WHATSAPP_ENABLED`
becomes unconditional once Meta approves the templates and the client accepts
the per-conversation cost. `CHAT_ENABLED` and `GAME_ENABLED` are removed at the
Phase 1 sign-off, one way or the other. A flag still in the codebase six months
after its decision was made is dead configuration, and it will be the thing
that is set wrong in the environment nobody checked.
