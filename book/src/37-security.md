# Security

This system holds salary figures for 25 people, the purchase history of a small
business, and coupons that a cashier will accept as money. It also exposes a
public game endpoint to the open internet. That combination is worth about thirty
minutes of threat modelling and a lot of discipline about the boring controls.

Nothing here is exotic. The attacks that will actually be attempted against a
two-outlet QSR ERP are credential stuffing, a curious employee poking at URLs, and
a bot farming coupons. Defend against those properly and the rest follows.

## Trust boundaries

```text
   PUBLIC INTERNET (untrusted)
   ┌──────────────────────────────────────────────────────────┐
   │  Customer phone browser                                   │
   │    GET  /api/v1/public/games/:slug        no auth          │
   │    POST /api/v1/public/games/:slug/play   no auth          │
   │    POST /api/v1/public/customers/verify   no auth, OTP     │
   └───────────────────────────┬──────────────────────────────┘
                               │  HTTPS only, rate limited by IP
   ───────────────────────────═╪═──────────────  BOUNDARY 1  ──
                               │
   AUTHENTICATED STAFF (semi-trusted, 25 to 30 people)
   ┌───────────────────────────┴──────────────────────────────┐
   │  Next.js app on staff phones and the manager's laptop     │
   │  Bearer access JWT (15 min) + HttpOnly refresh cookie      │
   │  Nine roles, two outlet scopes, one SELF scope             │
   └───────────────────────────┬──────────────────────────────┘
                               │  CORS allowlist, JwtAuthGuard
   ───────────────────────────═╪═──────────────  BOUNDARY 2  ──
                               │
   API (trusted, holds every secret)
   ┌───────────────────────────┴──────────────────────────────┐
   │  NestJS on Railway                                        │
   │   guards: JwtAuthGuard ▶ PermissionsGuard ▶ OutletGuard   │
   │   pipe:   ZodValidationPipe on every body, query, param   │
   │   holds:  DB password, Redis password, Supabase service    │
   │           key, WhatsApp access token, JWT secrets          │
   └──────┬─────────────────┬──────────────────┬──────────────┘
          │                 │                  │
   ──────═╪════════════════─╪──────────────────╪──  BOUNDARY 3 ──
          │                 │                  │
   ┌──────┴──────┐  ┌───────┴──────┐  ┌────────┴─────────┐
   │ Supabase    │  │ Upstash      │  │ Meta WhatsApp    │
   │ Postgres    │  │ Redis (TLS)  │  │ Cloud API        │
   │ + Storage   │  │ sessions,    │  │ outbound only,   │
   │ private     │  │ rate limits, │  │ no inbound       │
   │ bucket      │  │ idempotency  │  │ webhook in P1    │
   └─────────────┘  └──────────────┘  └──────────────────┘
```

Boundary 1 is the one that matters most, because anyone on the internet can cross
it. Everything behind it assumes an authenticated user with a known role, which is
exactly the assumption the public game endpoints must not be allowed to smuggle
past.

Boundary 2 is where an employee sits. Semi-trusted means we assume they are honest
but curious, and we assume one of them will eventually have their password
guessed or shared.

Boundary 3 is where the credentials live. If the API is compromised, everything
is compromised. There is no second layer at this budget, and pretending otherwise
would be dishonest.

### Assets worth protecting

| Asset | Where | Impact if lost or leaked |
|---|---|---|
| Staff salary records | `SalaryRecord` | Serious. In a 25-person business everyone finding out everyone's pay is a management crisis, and this is personal data under Indian law. |
| Staff personal data | `Employee.phone`, `fullName`, join and exit dates | Personal data. Phone numbers are the identifier used for everything else in the person's life. |
| Stock and purchase records | `StockTransaction`, `Purchase`, `ItemPriceHistory` | Competitive and financial. Vendor pricing is what the client negotiates with. Tampered stock hides theft. |
| Reward coupons | `RewardIssue.couponCode` | Direct cash value. A cashier honours a valid code. Predictable codes are free food. |
| WhatsApp access token | env var on the API service | A stolen token can message the client's entire customer list from the client's verified business number. Reputational, and Meta will suspend the number. |
| Audit trail | `AuditLog` | The record of who did what. If it can be edited, every other control is theatre. |
| Session tokens | `RefreshToken`, JWTs in browsers | A stolen refresh token is a persistent login as that user until it is revoked. |

## STRIDE

| Category | Concrete threat here | Control | Where |
|---|---|---|---|
| Spoofing | Credential stuffing against `/auth/login` using passwords leaked elsewhere. Staff reuse passwords. | argon2id hashing, lockout after 5 failed attempts for 15 minutes, per-IP and per-username rate limit on login, a forced strong password on first login | `modules/auth/auth.service.ts`, `common/guards/throttle` |
| Spoofing | A shared login. Two cashiers using one account so the audit trail names the wrong person. | One user per employee enforced by the unique `Employee.userId`, `actorLabel` on every audit row, and a policy stated in training. This is a process control, not a technical one. | `modules/users`, training |
| Tampering | An employee edits their own attendance punch to hide lateness. | Punches are append only. Edits create a new `AttendancePunch` with `source: MANAGER_EDIT`, `editedById` and a mandatory `editReason`, and only a manager permission can do it. | `modules/attendance/attendance.service.ts` |
| Tampering | A stock row is quietly changed to cover a shortage. | `StockTransaction` is append only. Corrections are new `ADJUSTMENT` rows with a required reason. The nightly reconciliation job in [chapter 36](36-observability-and-audit.md) detects any balance that stops matching the ledger sum. | `modules/inventory` |
| Tampering | Someone deletes audit rows. | No delete or update path exists in application code for `AuditLog`. A lint rule blocks the SQL strings. | `common/audit` |
| Repudiation | "I never approved that leave." | Every state-changing action writes an `AuditLog` row with actor, IP, user agent, before and after. | `common/interceptors/audit.interceptor.ts` |
| Information disclosure | A kitchen staff user browses to `/api/v1/workforce/salary/<colleague id>`. | `PermissionsGuard` requires `workforce.salary.read`, which KITCHEN_STAFF does not have. 403. | `common/guards/permissions.guard.ts` |
| Information disclosure | A Patia store manager enumerates Saheed's purchase records by id. | `OutletGuard` returns 404, not 403, so the existence of the other outlet's row is never confirmed. | `common/guards/outlet.guard.ts` |
| Information disclosure | A stack trace or SQL fragment reaches the browser. | `AllExceptionsFilter` maps everything to the error envelope in [chapter 15](15-api-conventions.md). Only registered codes and safe messages leave the process. | `common/filters/all-exceptions.filter.ts` |
| Information disclosure | A salary figure or WhatsApp token ends up in a log line. | The redaction helper in [chapter 36](36-observability-and-audit.md), with a regression test. | `common/logging/redact.ts` |
| Denial of service | A bot hammers the public game endpoint, filling `GamePlay` and burning the Supabase row budget. | Per-IP rate limit, per-session-key cooldown, and a hard daily cap per IP hash. See [chapter 32](32-customer-crm-and-game.md). | `modules/crm/game.controller.ts` |
| Denial of service | Someone requests `?pageSize=100000`. | zod caps `pageSize` at 100 and rejects anything larger with 400. | `packages/shared/pagination.ts` |
| Elevation of privilege | A new endpoint ships without a permission decorator and defaults to open. | The table-driven RBAC test in [chapter 33](33-testing-strategy.md) fails the build on any undecorated route. | `test/rbac/route-matrix.e2e-spec.ts` |
| Elevation of privilege | A STORE_MANAGER assigns themselves the OWNER role. | `admin.user.role_change` requires a permission only OWNER holds, and the action is audited with before and after. | `modules/users/users.service.ts` |

## Transport and headers

HTTPS everywhere. Railway terminates TLS and issues certificates for both custom
domains. There is no HTTP listener to redirect from, because Railway does not
route plain HTTP to the service.

```ts
// apps/api/src/main.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],          // the API serves JSON, nothing else
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31_536_000,                // 1 year
    includeSubDomains: true,
    preload: false,                    // preload only after 3 months stable
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  noSniff: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
}));

app.enableCors({
  origin: (origin, cb) => {
    const allow = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
    // Same-origin and server-to-server requests have no Origin header.
    if (!origin) return cb(null, true);
    if (allow.includes(origin)) return cb(null, true);
    return cb(new Error('origin not allowed'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 600,
});
```

`CORS_ORIGINS` is `https://erp.bobsmomo.in` in production and
`https://staging.erp.bobsmomo.in,http://localhost:3001` in staging. A wildcard is
unacceptable here for one specific reason: `credentials: true` is required so the
refresh cookie travels, and a browser will not send credentials to a wildcard
origin, so the only way a wildcard "works" is by reflecting whatever origin asks.
That turns any website a logged-in manager visits into something that can call
this API as them.

The Next.js app sets its own CSP with a nonce for inline scripts. That
configuration lives in [chapter 28](28-ui-system.md).

Cookie flags on the refresh token: `HttpOnly`, `Secure`, `SameSite=Lax`,
`Path=/api/v1/auth`, and an explicit `Max-Age` matching the token lifetime.
`HttpOnly` keeps it out of reach of any JavaScript, including an XSS payload.
`SameSite=Lax` blocks it on cross-site POSTs, which is the CSRF control given the
API is otherwise stateless. `Path` restricts it to the three auth endpoints that
need it, so it is not attached to every inventory request. The access token is
never in a cookie; it lives in memory in the browser tab and dies with it.

## Authentication and session

[Chapter 13](13-authentication.md) owns this in full. The controls in summary, so
this chapter is a complete list without duplicating the detail: argon2id with the
OWASP-recommended parameters, a 15 minute access JWT, an opaque refresh token
stored as a SHA-256 hash with rotation and reuse detection by `familyId`, lockout
after 5 failed logins, `mustReset` forcing a password change on first login, and
revocation of an entire token family on any reuse of a rotated token.

Two additions that belong under security rather than under auth mechanics. First,
the login response time is equalised: a login for a username that does not exist
still performs an argon2 verify against a dummy hash, so response timing does not
reveal which usernames are real. Second, the error message is identical for a
wrong username and a wrong password, with the same `INVALID_CREDENTIALS` code.

## Authorisation

[Chapter 14](14-rbac-and-permissions.md) owns the matrix. The security rules on
top of it:

Every controller method carries a `@Permissions('module.resource.action')`
decorator. There is no default-allow. `PermissionsGuard` denies when metadata is
absent rather than passing through, and the table-driven test from
[chapter 33](33-testing-strategy.md) fails the build if any route lacks the
decorator. Both halves are needed: the guard catches it at runtime, the test
catches it at review time.

Outlet scope is enforced in the guard, not in the query. The guard resolves the
caller's allowed outlet ids once per request and puts them in the request context;
repositories then take `outletId IN (...)` from that context. This means a
forgotten filter in a new repository method fails closed with an empty result
rather than open with everything.

The code review checklist item, in the pull request template: "does every new
controller method have a permission decorator, is the route in `route-table.ts`,
and is there a 404 test for a caller outside outlet scope".

## Input validation

Every endpoint validates through a zod schema. The schema lives in
`packages/shared` and is the only place that shape is defined. The DTO type is
`z.infer<typeof Schema>`, the frontend form resolver uses the same schema, and the
`ZodValidationPipe` runs it on body, query and params before the handler is
entered.

```ts
// packages/shared/inventory/record-transaction.schema.ts
import { z } from 'zod';

export const recordTransactionSchema = z.object({
  itemId: z.string().uuid(),
  outletId: z.string().uuid(),
  type: z.enum(['OPENING','RECEIVED','ISSUED','WASTAGE',
                'ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','CLOSING']),
  quantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'max 3 decimal places'),
  businessDate: z.string().date().optional(),
  reason: z.string().min(3).max(500).optional(),
  note: z.string().max(1000).optional(),
}).strict()                                  // unknown keys are rejected
  .refine((v) => !['WASTAGE','ADJUSTMENT'].includes(v.type) || !!v.reason, {
    path: ['reason'],
    message: 'reason is required for wastage and adjustment',
  });

export type RecordTransactionInput = z.infer<typeof recordTransactionSchema>;
```

`.strict()` on every object schema is deliberate. Mass assignment is the classic
way an extra field like `balanceAfter` or `roleKey` rides in on a request body and
lands in a Prisma `create`. Rejecting unknown keys with a 400 means it cannot.

Quantities and money arrive as strings and are parsed to `Prisma.Decimal`, never
as JavaScript numbers. A number field would silently lose precision on a value the
business cares about, which is a correctness bug that presents as a security
problem the first time a total does not match an invoice.

## Injection

Prisma parameterises everything it generates. `prisma.purchase.findMany({ where:
{ purchaseNo: userInput } })` cannot be injected regardless of what `userInput`
contains. That covers roughly 98 percent of the data access in this codebase.

The risk is the escape hatch. `$queryRaw` and `$executeRaw` exist and are used in
a handful of places: the truncate helper in the test setup, the nightly stock
reconciliation query, the `SKIP LOCKED` outbox claim, and two analytics
aggregations that are awkward to express through the query builder.

The rules:

1. Use the tagged template form, always. `prisma.$queryRaw\`SELECT ... WHERE id =
   ${id}\`` parameterises `${id}`. The interpolation is not string concatenation,
   Prisma turns it into `$1`.
2. Never use `$queryRawUnsafe` or `$executeRawUnsafe` with any value that came
   from a request. The only permitted use is the test truncate helper, where the
   table names come from `pg_tables` on a schema we created, and even there the
   result is cached and never touches user input.
3. Never build a raw query by concatenation, template literal assembly, or
   `.join()` on request data. If you need a dynamic column or table name, use a
   lookup table mapping an allowlisted enum to a literal, and switch on it.
4. Every `$queryRaw` call site carries a one-line comment saying why the query
   builder was not enough. If you cannot write that line, use the query builder.

```ts
// Correct. Prisma parameterises the interpolations.
const rows = await prisma.$queryRaw<Drift[]>`
  SELECT s."itemId", s."outletId"
  FROM "ItemStock" s
  WHERE s."outletId" = ${outletId}::uuid
    AND s."updatedAt" > ${since}
`;

// Wrong. Never do this. Injectable, and it will be caught in review.
const bad = await prisma.$queryRawUnsafe(
  `SELECT * FROM "ItemStock" WHERE "outletId" = '${outletId}'`,
);
```

Code review checklist item: "any new `$queryRaw` or `$executeRaw` uses the tagged
template form, has no concatenation, and carries a justification comment". An
eslint rule flags `$queryRawUnsafe` and `$executeRawUnsafe` outside
`apps/api/test/`, so the unsafe variants cannot appear in application code without
an explicit disable comment that a reviewer will see.

## File upload

The only upload path is a proof photo on task completion. It is small, and it is
still the most dangerous endpoint in the application, because it is the one place a
user hands the server a file.

| Control | Value | Reason |
|---|---|---|
| MIME allowlist | `image/jpeg`, `image/png`, `image/webp` | No SVG. SVG is XML and carries scripts. No PDF, no HEIC. |
| Content check | magic bytes verified against the declared type | The `Content-Type` header is user input. A `.php` renamed to `.jpg` fails the byte check. |
| Size limit | 5 MB per file, enforced by multer and again by the storage policy | A phone photo is 2 to 4 MB. Five is generous. |
| Count limit | 1 file per checklist item, 10 per task | Bounds the write volume per request. |
| Stored filename | `task-proof/{outletId}/{taskId}/{uuid}.{ext}` where uuid is server-generated | The original filename is never used, never stored, never echoed. Path traversal, null bytes and unicode tricks in a filename cannot reach the storage key. |
| Original filename | discarded entirely | Nothing needs it. `TaskAttachment` stores `storageKey`, `mimeType` and `sizeBytes`. |
| Extension | derived from the verified MIME type, not from the upload | A verified `image/png` becomes `.png` regardless of what the client called it. |
| Bucket policy | private, `service_role` insert and select only | An anonymous GET on a known object path returns 403. |
| Serving | signed URL with 15 minute expiry, minted per request by the API after checking the caller may read that task | A leaked URL expires. A user outside outlet scope never gets one. |
| Image stripping | EXIF removed on upload | Phone photos carry GPS coordinates. A kitchen photo does not need to record the employee's location. |

```ts
// apps/api/src/modules/tasks/attachment.service.ts
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
]);

async function store(file: Express.Multer.File, taskId: string, outletId: string) {
  const detected = await fileTypeFromBuffer(file.buffer);   // magic bytes
  if (!detected || !ALLOWED.has(detected.mime)) {
    throw new BusinessError('UNSUPPORTED_MEDIA_TYPE',
      'Only JPEG, PNG and WebP images are accepted.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new BusinessError('FILE_TOO_LARGE', 'Maximum file size is 5 MB.');
  }

  const cleaned = await sharp(file.buffer)
    .rotate()                       // apply EXIF orientation, then drop EXIF
    .toFormat(detected.ext as keyof FormatEnum)
    .toBuffer();

  // Server-generated key. file.originalname is never read.
  const key = `${outletId}/${taskId}/${randomUUID()}.${ALLOWED.get(detected.mime)}`;
  await supabase.storage.from(BUCKET).upload(key, cleaned, {
    contentType: detected.mime,
    upsert: false,
  });
  return { storageKey: key, mimeType: detected.mime, sizeBytes: cleaned.length };
}
```

Running every upload through sharp also neutralises a polyglot file. A buffer that
is both a valid GIF and a valid JavaScript file does not survive a re-encode.

## Rate limiting and abuse

Three tiers, all backed by Upstash Redis with a fixed window counter.
[Chapter 25](25-caching-and-performance.md) covers the implementation and
[chapter 32](32-customer-crm-and-game.md) covers the game-specific rules.

| Scope | Limit | Key |
|---|---|---|
| `POST /auth/login` | 10 per 15 min per IP, 5 per 15 min per username | `rl:login:ip:{ip}` and `rl:login:user:{username}` |
| `POST /auth/refresh` | 60 per hour per user | `rl:refresh:{userId}` |
| Authenticated API, general | 300 per minute per user | `rl:api:{userId}` |
| Public game read | 60 per minute per IP | `rl:game:read:{ipHash}` |
| Public game play submit | 10 per hour per IP, 1 per cooldown per session key | `rl:game:play:{ipHash}` |
| OTP send for customer verification | 3 per hour per phone, 10 per hour per IP | `rl:otp:{phoneHash}` |
| Reward redemption | 20 per hour per outlet | `rl:redeem:{outletId}` |

Exceeding a limit returns 429 with `Retry-After` and the `RATE_LIMITED` error
code. The IP is hashed before it becomes a Redis key, so a Redis dump does not
hand over a list of customer IP addresses.

When Redis is unavailable, the limiter fails open for authenticated staff routes
and fails closed for the public game routes. A kitchen manager should not be
blocked from recording stock because a cache is down. An anonymous coupon farmer
should be.

## Secrets

[Chapter 09](09-environments-and-configuration.md) owns the variable list and the
loading rules. The security rules on top:

No secret is ever committed. `.env` is in `.gitignore`, `.env.example` contains
only names and dummy values, and a `gitleaks` pre-commit hook scans staged content
against patterns for JWT-shaped strings, `EAA` Meta tokens, `postgres://` URLs
with credentials, and generic high-entropy strings. The same scan runs in CI on
the pull request diff, because a hook only protects people who installed it.

Production secrets live in the Railway dashboard and in GitHub Actions secrets.
Nowhere else. Not in a shared document, not in the client WhatsApp group, not in
a ticket, not in a password manager note that gets pasted into Slack.

Staging and production have different values for every secret. A staging leak must
not grant production access, and the WhatsApp token in staging points at a test
number so a mistake there cannot message a real customer.

If a secret is committed, follow Procedure 6 in
[chapter 35](35-deployment-runbook.md). The order is: rotate first, then decide
about history. Rotating kills the value in seconds. Rewriting history takes an hour
and does not help if someone already cloned. Treat any secret that touched a
commit, even one that was never pushed, as compromised, because "never pushed" is
a claim about a laptop nobody audited.

## Dependency security

`bun.lockb` is committed and CI installs with `--frozen-lockfile`, so a build can
never resolve a version nobody reviewed.

A scheduled workflow runs the audit weekly and opens an issue when something is
found:

```yaml
# .github/workflows/audit.yml
name: dependency audit
on:
  schedule: [{ cron: '0 4 * * 1' }]     # Monday 09:30 IST
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: '1.1.38' }
      - run: bun install --frozen-lockfile
      - name: Audit
        run: bun audit --audit-level=high
      - name: Open an issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Dependency advisory ${new Date().toISOString().slice(0,10)}`,
              body: 'bun audit reported a high or critical advisory.',
              labels: ['security'],
            })
```

The policy on an advisory: critical severity with a reachable code path gets a
patch release within 48 hours. High severity gets assessed within a week and
patched in the next release if the vulnerable path is reachable from a request.
Moderate and low are noted and picked up during normal dependency updates. The
assessment step matters, because most advisories in a Node dependency tree are in
a build-time package or a code path this application never calls, and patching
those on reflex burns time that has a better use.

One honest note for the client. This is a fixed-price Rs 45,000 engagement with a
three week scope. Dependency patching is ongoing work with no end date, and it is
not covered by the build fee. Agree a maintenance arrangement before go-live:
either a small monthly retainer that includes the weekly audit review and patch
releases, or an explicit written statement that the client accepts the system will
not receive dependency updates after handover and understands what that means over
a two year horizon. Silence on this becomes an argument in month seven.

## Data protection and privacy

Personal data held by this system:

| Data | Subject | Where | Why it is held |
|---|---|---|---|
| Full name, phone, designation, join and exit dates | staff | `Employee` | Rostering, attendance, notifications |
| Salary structure | staff | `SalaryRecord` | The client asked for historical salary storage |
| Attendance and break times | staff | `AttendanceDay`, `AttendancePunch`, `BreakLog` | Shift management |
| Leave reasons | staff | `LeaveRequest.reason` | Approval decisions |
| Phone number | customer | `Customer.phone` | Identity for coins and coupon delivery |
| Optional name | customer | `Customer.name` | Personalising a coupon message |
| IP hash | customer | `GamePlay.ipHash` | Abuse control only |

Minimisation is applied where it costs nothing. No customer email is collected,
because WhatsApp is the delivery channel. No customer address is collected,
because there is no delivery. No date of birth, no ID numbers, no bank details for
staff, because payroll computation is out of scope per
[chapter 04](04-decisions-register.md). No photographs of people; the task proof
photo is of a kitchen surface or a piece of equipment, and the training says so.

Retention position for Phase 1: staff records are retained for the life of the
employment plus three years, which is the practical window for a labour dispute.
Customer records are retained while the coin balance is non-zero or a coupon is
unexpired, plus twelve months. `GamePlay` rows for guest sessions are pruned after
90 days, because a guest earns nothing and the row has no further purpose. These
are positions written into the handover document, not automated jobs. Automating
deletion in a three week build with no legal review is how you delete something
you needed.

Customer consent is recorded, not assumed. `Customer.consentAt` is set only when
the customer completes phone verification, and the verification screen states in
one sentence what the number will be used for: sending coupon codes and reward
notifications on WhatsApp, nothing else. A guest who plays without verifying has
no `Customer` row at all, so there is nothing to consent to.

A deletion request path exists as a procedure, not a button. The customer asks at
the counter or on WhatsApp, the request reaches the Operations Manager, and the
agency runs a script that anonymises the `Customer` row (phone replaced with a
tombstone value, name nulled, `consentAt` cleared), voids any unredeemed coupons,
and leaves `GamePlay` rows with the customer link removed. Redeemed coupons stay,
because a redeemed coupon is a financial record of a transaction at the counter,
and removing it would break the reward reconciliation. That distinction should be
explained to anyone who asks rather than hidden.

Staff data is not deletable while employed, and after exit the `Employee` row is
retained because the attendance and task history attached to it is the business's
record of work done. `EmploymentStatus` moves to `EXITED` and the linked `User` is
disabled, which removes all access.

India's Digital Personal Data Protection Act 2023 is the direction of travel here,
and the design above (purpose limitation, recorded consent, minimisation, a
deletion path, a named person accountable) is consistent with where it points.
This book is not legal advice and nobody on this project is a lawyer. If the
client wants a compliance position they can rely on, they should get one from
counsel. What the agency commits to is that the system does not make compliance
harder: consent is timestamped, personal data is in a small number of named
columns, and there is an audit trail of who accessed salary records.

## Pre-launch security checklist

Work through this in one sitting before go-live. Roughly two hours.

Transport and headers

- [ ] Both custom domains serve HTTPS with a valid certificate and plain HTTP does not route.
- [ ] `helmet` is applied in `main.ts` with HSTS at one year and `includeSubDomains`.
- [ ] `CORS_ORIGINS` in production lists exactly one origin and contains no wildcard.
- [ ] A request from an unlisted origin is rejected. Verified with `curl -H "Origin: https://evil.test"`.
- [ ] The refresh cookie carries `HttpOnly`, `Secure`, `SameSite=Lax` and a scoped `Path`. Verified in devtools.
- [ ] No `X-Powered-By` header on any response.

Authentication

- [ ] Every seeded and manually created user has `mustReset: true` until they log in.
- [ ] No default or shared account exists. No account named `admin` with a known password.
- [ ] Lockout fires after 5 failed attempts and releases after 15 minutes. Tested by hand against production.
- [ ] Login for a non-existent username and a wrong password return the identical code and message.
- [ ] Access token lifetime is 15 minutes and refresh rotation is on in production config.
- [ ] Reusing a rotated refresh token revokes the family. Tested against staging.

Authorisation

- [ ] The RBAC route matrix test passes and covers every route in `route-table.ts`.
- [ ] No route lacks a `@Permissions` decorator. The discovery test returns an empty list.
- [ ] A cross-outlet request returns 404 and the response body names no other outlet.
- [ ] A KITCHEN_STAFF token cannot read `/workforce/salary`, `/analytics/pnl` or another employee's attendance. Tested by hand.
- [ ] `admin.audit.read` is granted to OWNER and OPERATIONS_MANAGER only.

Input and injection

- [ ] Every controller method has a zod schema on its body, query and params.
- [ ] Every object schema uses `.strict()`.
- [ ] `pageSize` above 100 returns 400.
- [ ] No `$queryRawUnsafe` or `$executeRawUnsafe` exists outside `apps/api/test/`. Verified by grep.
- [ ] Every `$queryRaw` call site uses the tagged template form and carries a justification comment.

Files and storage

- [ ] The `task-proof` bucket is private. An anonymous GET on a known key returns 403.
- [ ] Uploading a `.svg` renamed to `.png` is rejected by the magic byte check.
- [ ] A 6 MB file is rejected with `FILE_TOO_LARGE`.
- [ ] The stored key contains a server-generated UUID and no part of the original filename.
- [ ] A signed URL expires after 15 minutes. Verified by waiting.

Secrets and configuration

- [ ] `gitleaks` finds nothing in the full repository history.
- [ ] Staging and production have different values for both JWT secrets, the database password, the Redis password and the Supabase service key.
- [ ] `WHATSAPP_ENABLED` is false in staging and the staging token points at a test number.
- [ ] `NODE_ENV` is `production` on both production services.
- [ ] `LOG_LEVEL` is `info`, not `debug`, in production.
- [ ] The config validator refuses to boot with a missing required variable. Verified by removing one on staging.

Data and logging

- [ ] The redaction test passes and no salary figure, token or full phone number appears in a sampled hour of production logs.
- [ ] An `AuditLog` row exists for every action in the table in [chapter 36](36-observability-and-audit.md). Verified by performing each one on staging.
- [ ] No application code path can delete or update an `AuditLog` row.
- [ ] Supabase daily backups are on and a restore has been rehearsed once on staging.
- [ ] The nightly stock reconciliation job is scheduled and has run successfully at least once.

Abuse

- [ ] The login rate limit returns 429 after 10 attempts from one IP.
- [ ] The public game play endpoint returns 429 after 10 submissions in an hour from one IP.
- [ ] Coupon codes drawn 1,000 times show no sequential or time-correlated pattern.
- [ ] The uptime monitor is configured against `/healthz` and has alerted correctly on a deliberate test failure.

## Not done in Phase 1

Stated plainly so the client is deciding rather than discovering. Each item is a
real gap with a real risk, and each is a reasonable thing to omit from a Rs 45,000
three week build for a two-outlet restaurant. None of them should be a surprise in
month four.

No penetration test. Nobody independent has attacked this system. The controls
above are the ones the build team knew to apply, tested by the build team's own
tests. Risk: an implementation flaw that a tester would find in a day sits in
production indefinitely. A one day external test is roughly the cost of a quarter
of this build, and is the single highest-value security spend if the client wants
one.

No web application firewall. Railway does not include one and Cloudflare is not in
front of the domains. Risk: no automated blocking of scanners, no managed rule set
for common attacks, no DDoS absorption. The mitigation in place is application
level rate limiting, which handles a bot and does not handle a determined flood.
Cloudflare's free tier in front of both domains would close most of this and is
worth doing at handover.

No multi-factor authentication. A password is the only factor for every role,
including OWNER. Risk: a phished or reused owner password grants full access to
salary data and every outlet. Kitchen staff on a shared phone in a hot kitchen
would not tolerate a TOTP prompt, which is why it is out, but MFA on the two or
three admin-level accounts is a small piece of work and a large risk reduction.
Recommend it for Phase 2.

No field-level encryption at rest. Supabase encrypts the volume, which protects
against a stolen disk and nothing else. Salary figures are readable to anyone with
the database password or a successful SQL injection. Risk: a single compromise
exposes every salary at once. Application-level encryption of `SalaryRecord`
amounts is a contained change if the client wants it, at the cost of losing the
ability to sum or sort those columns in SQL.

No SIEM and no log retention beyond the provider window. Railway logs age out in
days. Risk: an incident discovered three weeks later cannot be investigated,
because the evidence is gone. The partial mitigation is `AuditLog`, which is
permanent and covers business actions, so "who changed this stock figure" is
answerable forever even when "what HTTP requests happened that afternoon" is not.

No formal incident response retainer. There is a support window, stated honestly
in [chapter 35](35-deployment-runbook.md), and it is business hours with best
effort outside. Risk: a breach discovered at 22:00 on a Saturday waits until
Monday morning unless somebody happens to be reachable. For a two-outlet momo
business this is a defensible position. It stops being defensible if the customer
CRM grows into a real list of thousands of phone numbers, which is worth
revisiting when it does.
