# Authentication

The SRS is blunt about this one. Google OAuth is excluded by client instruction,
so the system owns its own credentials, its own password hashes and its own
tokens. FR-AUTH-001 (custom user login) and FR-AUTH-003 (session and token
management) are both Must-Have. This chapter is the whole of the auth module:
what a credential is, how it is hashed, what a token carries, how a session is
refreshed, and what happens when somebody tries to guess a password 400 times.

Authorisation, meaning who may call which endpoint and see which outlet, is the
next chapter: [Roles, permissions and outlet scope](14-rbac-and-permissions.md).

## The credential model

A login credential is a row in `User`. The fields that matter here:

| Field | Type | Rule |
|---|---|---|
| `username` | `String @unique` | Required. Lowercase, 3 to 32 chars, `[a-z0-9._-]`. |
| `email` | `String? @unique` | Optional. Kitchen staff do not have one. |
| `passwordHash` | `String` | argon2id encoded string, roughly 97 chars. |
| `status` | `UserStatus` | `ACTIVE`, `SUSPENDED` or `DISABLED`. |
| `mustReset` | `Boolean` | True on every admin-provisioned account. |
| `failedLogins` | `Int` | Consecutive failures since the last success. |
| `lockedUntil` | `DateTime?` | Non-null and in the future means locked. |
| `lastLoginAt` | `DateTime?` | Set on every successful login. |

Login accepts one field called `identifier`. If it contains an `@` the service
looks the user up by `email`, otherwise by `username`. Both columns are unique,
so there is no ambiguity and no need to ask the user which one they typed. Half
the staff at Bob's Momo have no email address at all, which is why `email` is
nullable and `username` is not.

`passwordHash` never leaves the service layer. Every Prisma read that can reach
a controller goes through one shared select constant, and that constant does not
list the column:

```ts
// apps/api/src/modules/users/user.select.ts
export const userSafeSelect = {
  id: true,
  username: true,
  email: true,
  status: true,
  roleKey: true,
  mustReset: true,
  lastLoginAt: true,
  createdAt: true,
  employee: { select: { id: true, fullName: true, outletId: true } },
  outlets: { select: { outletId: true } },
} satisfies Prisma.UserSelect;
```

Only `AuthService.validateCredentials()` reads the hash, using an explicit
`select: { id: true, passwordHash: true, status: true, ... }` inline. There is
exactly one call site. A code review that finds a second one rejects the pull
request. The check is one grep:

```bash
grep -rn "passwordHash" apps/api/src --include="*.ts" \
  | grep -v "auth.service.ts"
```

That command should return only the Prisma schema import and the password
service. Anything else is a leak waiting to happen.

## Password hashing with argon2id

Hashing uses the `argon2` npm package (native binding, not the pure JS port)
with these parameters:

| Parameter | Value | Note |
|---|---|---|
| `type` | `argon2id` | Hybrid of argon2i and argon2d. |
| `memoryCost` | `19456` | KiB, so 19 MiB per hash operation. |
| `timeCost` | `2` | Iterations over the memory block. |
| `parallelism` | `1` | One lane. Single vCPU on Railway Hobby. |
| `hashLength` | `32` | Output bytes. |
| Salt | 16 random bytes | Generated per hash by the library. |

```ts
// apps/api/src/modules/auth/password.service.ts
import * as argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain).catch(() => false);
  }
}
```

Those numbers are the OWASP Password Storage minimum for argon2id at
`parallelism: 1`. On the Railway Hobby container a single hash or verify takes
40 to 60 ms of wall clock. That is the point. It is slow enough that an attacker
with the database dump gets a few thousand guesses per second per core instead
of a few billion, and fast enough that a cashier tapping login on a mid-range
Android phone over 4G does not notice it against the 200 ms of network latency.

argon2id rather than bcrypt for two reasons. First, bcrypt silently truncates
the input at 72 bytes, which means a long passphrase is weaker than it looks and
the truncation is invisible to the user. Second, bcrypt's work factor is CPU
time only, with a fixed 4 KiB working set, so a GPU or an FPGA cracks it far
faster per rupee than it cracks argon2id, which needs 19 MiB of real memory per
guess. There is no legacy hash to migrate, so there is no reason to pick the
older algorithm.

The API holds only one hashing budget concern: 19 MiB times the number of
concurrent logins. With 20 to 30 staff and a single shift change per day, the
peak is roughly 10 simultaneous logins, so 190 MiB of transient allocation on a
512 MiB container. Login is also rate limited (see
[API conventions](15-api-conventions.md)), which caps the worst case.

## Password policy

`packages/shared/src/auth/password.schema.ts` holds one schema used by the API
and by the web form, so the rules cannot drift:

```ts
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/i.test(v), 'Must contain a letter')
  .refine((v) => /[0-9]/.test(v) || /[^a-z0-9]/i.test(v),
          'Must contain a number or a symbol');
```

The service adds two checks that a schema cannot do: the password must not
contain the username, and it must not appear in a 200 entry deny list of the
obvious local choices (`bobsmomo`, `momo1234`, `password`, `12345678`,
`patia123` and similar). Both failures return `WEAK_PASSWORD` with the reason in
`details`. There is no rotation policy and no expiry. Forced periodic rotation
produces `Momo@2026`, then `Momo@2027`, and nothing else.

## Token design

Two tokens, two jobs.

The access token is a signed JWT, HS256, 15 minute lifetime, sent as
`Authorization: Bearer <jwt>` on every API call. It is stateless. Nothing
touches the database to validate it.

| Claim | Example | Purpose |
|---|---|---|
| `sub` | `"b3f1...c9"` | `User.id`. |
| `roleKey` | `"STORE_MANAGER"` | One of the nine `RoleKey` values. |
| `employeeId` | `"7a2e...41"` | `Employee.id`, or `null` for an admin-only account. |
| `outletIds` | `["c1..","d4.."]` | Resolved outlet scope. Empty for `ALL_OUTLETS`. |
| `permHash` | `"9f2a41c07b6d"` | First 12 hex chars of sha256 over the sorted permission list. |
| `mustReset` | `false` | Forces the password screen when true. |
| `jti` | `"01JK8Y3M2QW9V0X4"` | Token id, logged, not stored. |
| `iat` / `exp` | epoch seconds | 900 seconds apart. |

`outletIds` is resolved once at login, not per request. `OWNER` and
`OPERATIONS_MANAGER` get `[]` plus `scope: "ALL_OUTLETS"`, which the
`OutletGuard` reads as every active outlet at query time. Everybody else gets
their `UserOutlet` rows expanded into the array. A user with a new outlet
assignment picks it up within 15 minutes, when the access token expires. That is
an acceptable delay for a business that adds an outlet twice a decade.

`permHash` exists so a role change takes effect without waiting for a
deployment or a manual logout. `PermissionsGuard` compares the claim against the
hash of the role's current permission list. A mismatch, which happens after
`admin.user.assign_role` or after a release that changed the `PERMISSIONS`
constant, returns `401 PERMISSIONS_STALE`. The web client treats that exactly
like an expired token: refresh once, retry once, and if it fails again send the
user to the login screen.

The refresh token is not a JWT. It is 32 random bytes from
`crypto.randomBytes(32)`, base64url encoded, with a 30 day lifetime. The server
stores `sha256(token)` in `RefreshToken.tokenHash` and never stores the token
itself. A database dump therefore does not hand out sessions. Because it is
opaque and backed by a row, revocation is a single UPDATE, which a stateless JWT
cannot give you without a deny list that is really just a session table with
extra steps.

Every refresh token carries a `familyId`. All tokens descended from one login
share it. That is what makes reuse detection possible.

## Token lifecycle

```text
                    POST /auth/login
                          │
                          ▼
                 ┌──────────────────┐
                 │ family F created │
                 │ token T1 ACTIVE  │
                 └────────┬─────────┘
                          │ POST /auth/refresh presents T1
                          ▼
        ┌──────────────────────────────────────────┐
        │ T1.revokedAt = now      (T1 -> ROTATED)  │
        │ T2 inserted, familyId F (T2 -> ACTIVE)   │
        │ new access JWT issued, new cookie set    │
        └───────┬─────────────────────────┬────────┘
                │                         │
      refresh with T2            refresh with T1 again
                │                         │
                ▼                         ▼
        ┌───────────────┐   ┌──────────────────────────────┐
        │ T2 -> ROTATED │   │ REUSE DETECTED               │
        │ T3 -> ACTIVE  │   │ revoke every token in F      │
        └───────────────┘   │ clear cookie, 401 TOKEN_REUSED│
                            │ AuditLog: auth.token.reuse   │
                            └──────────────────────────────┘

  Terminal states: EXPIRED (expiresAt passed, cron prunes after 7 days),
                   REVOKED (logout, password change, admin reset, reuse).
```

Rotation is unconditional. Every successful refresh revokes the presented token
and issues a new one, so a stolen refresh token is useful only until the real
user's browser refreshes, at which point one of the two is presenting a revoked
token and the family dies. The user loses their session and has to log in again.
That is the correct outcome: somebody has their token.

One practical exception. A browser with three tabs open can fire two refresh
calls within milliseconds of each other, and the second one would present an
already rotated token through no fault of anybody. The service therefore keeps a
5 second replay window in Redis:

```text
  key   auth:rot:<sha256(presentedToken)>
  value the JSON response issued for that token
  ttl   5 seconds
```

If a rotated token is presented and that key exists, the service returns the
cached response instead of killing the family. If the key has expired, it is a
real reuse and the family dies. Five seconds covers a tab race. It does not
cover an attacker who stole a token an hour ago.

```ts
// apps/api/src/modules/auth/auth.service.ts (refresh, abridged)
async refresh(presented: string, ctx: RequestCtx) {
  const tokenHash = sha256(presented);
  const row = await this.repo.findRefreshToken(tokenHash);

  if (!row) throw new AppError('TOKEN_INVALID', 401);
  if (row.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED', 401);

  if (row.revokedAt) {
    const replay = await this.redis.get(`auth:rot:${tokenHash}`);
    if (replay) return JSON.parse(replay);        // tab race, 5s window
    await this.repo.revokeFamily(row.familyId);   // real reuse
    await this.audit.write('auth.token.reuse', row.userId, ctx);
    throw new AppError('TOKEN_REUSED', 401);
  }

  const issued = await this.prisma.$transaction(async (tx) => {
    await this.repo.revoke(tx, row.id);
    return this.issuePair(tx, row.userId, row.familyId, ctx);
  });

  await this.redis.set(`auth:rot:${tokenHash}`, JSON.stringify(issued),
                       'EX', 5);
  return issued;
}
```

## Endpoint contracts

All five live in `apps/api/src/modules/auth/auth.controller.ts` under the base
path `/api/v1`.

### POST /auth/login

Public. No token required. Rate limited to 20 attempts per 15 minutes per IP and
10 per 15 minutes per identifier.

```ts
export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(128),
});
export type LoginDto = z.infer<typeof loginSchema>;
```

Success, `200 OK`, plus `Set-Cookie: bm_rt=...`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiM2Y...",
  "expiresIn": 900,
  "mustReset": false,
  "user": {
    "id": "b3f1c2d4-9a71-4f0e-8c33-2b6f5d1e77c9",
    "username": "sunita.k",
    "roleKey": "STORE_MANAGER",
    "employeeId": "7a2e0f11-3c5d-4a92-9f18-4d0b7e2c8a41",
    "fullName": "Sunita Kar",
    "outletIds": ["c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05"],
    "scope": "OWN_OUTLET"
  }
}
```

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Body fails `loginSchema`. |
| `INVALID_CREDENTIALS` | 401 | Unknown identifier, or wrong password. |
| `ACCOUNT_LOCKED` | 423 | Password correct, `lockedUntil` in the future. |
| `ACCOUNT_DISABLED` | 403 | `status` is `DISABLED` or `SUSPENDED`. |
| `RATE_LIMITED` | 429 | Attempt limit hit for this IP or identifier. |

Business rules:

1. Look up by `email` when the identifier contains `@`, otherwise by `username`.
2. When no user is found, verify the password against a fixed dummy argon2id
   hash held in memory, then return `INVALID_CREDENTIALS`. The dummy verify is
   not optional.
3. Verify the password before checking `lockedUntil`.
4. On a wrong password, increment `failedLogins`, set `lockedUntil` when the
   threshold is reached, return `INVALID_CREDENTIALS`.
5. On a correct password with a live lock, return `ACCOUNT_LOCKED` and include
   `retryAfterSeconds` in `details`. Do not issue tokens. Do not reset the
   counter.
6. On a correct password with no lock, reset `failedLogins` to 0, clear
   `lockedUntil`, set `lastLoginAt`, create a new `familyId`, insert the refresh
   token row, and write an `AuditLog` row with action `auth.session.create`.
7. `SUSPENDED` and `DISABLED` both return `ACCOUNT_DISABLED`. The difference
   matters to HR, not to the login screen.

### POST /auth/refresh

Public in the sense that it needs no access token. It authenticates with the
`bm_rt` cookie and the `X-Refresh-Request: 1` header. No request body.

Success, `200 OK`, plus a new `Set-Cookie`:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiM2Y...",
  "expiresIn": 900,
  "mustReset": false
}
```

| Code | HTTP | Fires when |
|---|---|---|
| `TOKEN_MISSING` | 401 | No `bm_rt` cookie, or missing custom header. |
| `TOKEN_INVALID` | 401 | Hash not in `RefreshToken`. |
| `TOKEN_EXPIRED` | 401 | `expiresAt` has passed. |
| `TOKEN_REUSED` | 401 | Revoked token presented outside the 5 second window. |
| `ACCOUNT_DISABLED` | 403 | User was disabled since the token was issued. |
| `RATE_LIMITED` | 429 | More than 60 refreshes per hour per user. |

Business rules: rotation always happens, the `familyId` carries over, the row
records `userAgent` and `ip`, and a `TOKEN_REUSED` response always clears the
cookie so the browser stops re-presenting a dead token.

### POST /auth/logout

Authenticated. Permission key `auth.session.create` (holding a session is what
lets you end it). No body.

Success is `204 No Content` with `Set-Cookie: bm_rt=; Max-Age=0`.

| Code | HTTP | Fires when |
|---|---|---|
| `TOKEN_MISSING` | 401 | No access token. |
| `TOKEN_EXPIRED` | 401 | Access token past `exp`. |

Business rules: revoke the entire family of the presented refresh token, not
just the current token, so logging out on the counter tablet does not leave a
live rotation chain behind. Logout is idempotent. A second call with no cookie
still returns 204. Write `AuditLog` with action `auth.session.end`.

### POST /auth/change-password

Authenticated. Permission key `auth.password.change`, scope `SELF`. Reachable
even when `mustReset` is true, which is the point.

```ts
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
```

Success, `200 OK`, with a fresh cookie because every old family is now dead:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiM2Y...",
  "expiresIn": 900,
  "mustReset": false
}
```

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Body fails the schema. |
| `INVALID_CREDENTIALS` | 401 | `currentPassword` does not verify. |
| `WEAK_PASSWORD` | 422 | Deny list hit, or contains the username. |
| `SAME_PASSWORD` | 422 | New password equals the current one. |

Business rules: verify the current password even when `mustReset` is true, hash
the new one, set `mustReset` to false, revoke every refresh token for the user,
issue a new family, write `AuditLog` with action `auth.password.change`. The
response returns a working session so the user is not bounced to the login
screen immediately after setting a password.

### POST /auth/admin/reset-password

Authenticated. Permission key `auth.password.reset_other`. Held by `OWNER`,
`OPERATIONS_MANAGER` and `HR_ACCOUNTS` at all outlets, and by `STORE_MANAGER`
for users scoped to their own outlet.

```ts
export const adminResetSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});
export type AdminResetDto = z.infer<typeof adminResetSchema>;
```

Success, `200 OK`. The temporary password is returned exactly once, in this
response, because most staff have no email address and the manager is going to
read it out loud:

```json
{
  "userId": "9c7d2e10-55af-4b1c-8e02-1f9a6c3d4b88",
  "username": "raju.m",
  "temporaryPassword": "momo-7431-kite",
  "mustReset": true
}
```

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad UUID or missing reason. |
| `FORBIDDEN` | 403 | Caller lacks `auth.password.reset_other`. |
| `NOT_FOUND` | 404 | User does not exist, or is outside the caller's outlet scope. |
| `CONFLICT` | 409 | Target is the caller. Use change-password instead. |

Business rules: generate a three part passphrase from a 400 word list plus four
digits, hash it, set `mustReset` true, clear `failedLogins` and `lockedUntil`,
revoke every refresh token for that user, write `AuditLog` with action
`auth.password.reset_other` carrying the reason in `after`. The plaintext is
never logged and never persisted.

## Account lockout

Five failed attempts inside a 15 minute window lock the account for 15 minutes.

```text
  failure at T          failedLogins   lockedUntil
  ────────────          ────────────   ───────────
  first                       1        null
  second                      2        null
  third                       3        null
  fourth                      4        null
  fifth                       5        T + 15 min      <- locked
  sixth (while locked)        6        T + 15 min      (not extended)
  any success                 0        null
```

The window is enforced by the counter itself rather than by a timestamp column.
`failedLogins` resets to 0 on any successful password verification, and the
lock expires on its own, so a user who fails twice at 09:00 and three more times
at 16:00 is locked. That is a slightly conservative reading of "inside 15
minutes" and it costs a real user nothing, because a real user who typed the
password wrong twice in the morning got in on the third try and reset the
counter.

Lockout writes an `AuditLog` row with action `auth.login.locked`, actor id set
to the target user, and `after` carrying the IP and user agent. It notifies
nobody in Phase 1. There is no lockout email because there is often no email,
and a WhatsApp message saying "your account is locked" to a phone that may not
be the account holder's is worse than silence. The Store Manager can see the
audit row and use `auth.password.reset_other`, which is the actual recovery
path in a shop where everybody is in the same room.

### Why unknown user and wrong password look identical

Both return `401 INVALID_CREDENTIALS` with the same message, the same shape and,
importantly, the same latency. If an unknown username returned a different code,
or returned in 3 ms while a real username took 50 ms, anyone could walk a list
of names against the login endpoint and learn the staff roster. That roster is
also a list of WhatsApp targets for a social engineering call to the outlet.
Equalising the response is why step 2 of the login rules runs argon2id against a
dummy hash for users that do not exist. It burns 45 ms on purpose.

### Why the lockout signal is safe

`ACCOUNT_LOCKED` is returned only after the submitted password verified
correctly. An attacker who does not know the password can never see it. They see
`INVALID_CREDENTIALS` whether the account is locked, unlocked or fictional, so
the lockout state leaks nothing about which usernames exist.

Someone who does know the password gains nothing from the signal, because they
already hold the credential. What they gain is a useful message: the real user,
having just fumbled the password four times and then got it right, is told
exactly why they still cannot get in and how long to wait, instead of staring at
"invalid credentials" for a password they know is correct.

## First login and forced reset

Every account created by `admin.user.create` and every account touched by
`auth.password.reset_other` has `mustReset: true`.

```text
  login succeeds, mustReset = true
        │
        ▼
  200 OK, access token issued, claim mustReset: true
        │
        ├─► web app router redirect: /change-password (no other route renders)
        │
        └─► API: MustResetGuard rejects every request except
            POST /auth/change-password
            POST /auth/logout
            GET  /auth/me
            with 403 PASSWORD_RESET_REQUIRED
```

The token is real and the session works, which keeps the flow simple, but the
guard means an unchanged password cannot be used to reach any business endpoint
even by a client that ignores the flag. The web app is not the enforcement
point. `MustResetGuard` is registered globally in `app.module.ts` next to
`JwtAuthGuard` and reads `req.user.mustReset` from the verified claim.

## Session storage on the client

| Token | Where it lives | Lifetime |
|---|---|---|
| Access JWT | A module-scoped variable in the web app, never persisted | 15 min |
| Refresh token | `bm_rt` cookie, `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Domain=api.bobsmomo.in` | 30 days |

The access token lives in memory. A page reload loses it, and the app
immediately calls `POST /auth/refresh`, which succeeds because the cookie
survived. That round trip costs about 120 ms on the first paint and buys
something worth more: no XSS payload can read the access token, because there is
nothing on disk to read and no global to reach unless the attacker already has
script execution inside the app's own module scope at the right moment.

Nothing goes in `localStorage`. `localStorage` is readable by any script that
runs on the origin, including one injected through a dependency, a stored
comment or a task note that got rendered without escaping. A refresh token in
`localStorage` is a 30 day session handed to the first XSS bug anyone finds. An
`HttpOnly` cookie is not readable by script at all, which turns "attacker steals
a 30 day session" into "attacker makes requests while their payload is running
on the page".

`app.bobsmomo.in` and `api.bobsmomo.in` share the registrable domain
`bobsmomo.in`, so a fetch from the web app to the API is same-site and
`SameSite=Lax` lets the cookie through. The web app must send
`credentials: 'include'`, and the API must answer with
`Access-Control-Allow-Credentials: true` and an explicit
`Access-Control-Allow-Origin: https://app.bobsmomo.in`. A wildcard origin is
rejected by browsers when credentials are included, which is a useful accident.

> **Spec note:** if the two services ever end up on unrelated domains,
> for example a preview deployment on `*.up.railway.app`, the cookie needs
> `SameSite=None; Secure` and the CSRF story below loses its first layer. The
> deployment chapter pins a custom domain on both services for exactly this
> reason.

### The CSRF position

Only one endpoint in the system authenticates with a cookie:
`POST /auth/refresh`. Everything else needs an `Authorization` header, which a
cross-site form post cannot set, so it is structurally immune to CSRF. That
leaves one endpoint to defend, and it gets three layers:

1. `SameSite=Lax` stops the cookie from riding along on a cross-site POST at
   all. A form on `evil.example` submitting to `api.bobsmomo.in` sends no cookie.
2. The endpoint requires the header `X-Refresh-Request: 1`. A custom header
   forces a CORS preflight, and the preflight fails against the origin
   allowlist, so the real request never leaves the browser.
3. The endpoint checks `Origin` against the allowlist and returns
   `403 FORBIDDEN` on a mismatch.

There is no CSRF token table and no double-submit cookie. For one endpoint whose
worst case outcome is an attacker forcing a token rotation they cannot read, a
synchroniser token is machinery without a matching threat.

## Threat model

| Threat | Mitigation | Where it lives |
|---|---|---|
| Credential stuffing against known reused passwords | Lockout at 5 failures per 15 min, rate limit 20/IP and 10/identifier per 15 min, deny list on the 200 most likely local passwords | `auth.service.ts` (`recordFailure`), `ThrottlerGuard` config in `app.module.ts`, `password.service.ts` |
| Access token theft via XSS | Token in memory only, 15 minute expiry, refresh token unreadable by script, strict CSP with no `unsafe-inline` on the web app | `apps/web/src/lib/auth-store.ts`, `next.config.ts` headers block |
| Refresh token replay after theft | Rotation on every use, family-wide revocation on reuse, 5 second replay window only, `userAgent` and `ip` recorded per row | `auth.service.ts` (`refresh`), `RefreshToken` model |
| Privilege escalation by forging a claim | HS256 signature over a 256 bit secret from Railway secrets, `algorithms: ['HS256']` pinned so `alg: none` is rejected, `permHash` re-checked against the server-side `PERMISSIONS` constant on every request | `jwt.strategy.ts`, `permissions.guard.ts` |
| Timing attack that enumerates usernames | Dummy argon2id verify on the unknown-user path, identical error code and message, no early return before the hash | `auth.service.ts` (`validateCredentials`) |

Two mitigations are worth stating plainly because they are easy to break during
a refactor. Pinning `algorithms: ['HS256']` in the passport JWT strategy is what
stops a token with `"alg": "none"` from being accepted. And the dummy verify has
to run before any branch that returns, or a well-meaning early return
reintroduces the timing oracle in one line.

## Auth test checklist

The module is done when all of these pass in
`apps/api/test/auth.e2e-spec.ts` and `auth.service.spec.ts`.

| # | Case | Expected |
|---|---|---|
| 1 | Login with correct username and password | 200, access token, `bm_rt` cookie set with `HttpOnly` and `Secure` |
| 2 | Login with correct email instead of username | 200, same user id |
| 3 | Login with unknown identifier | 401 `INVALID_CREDENTIALS`, response time within 20 ms of case 4 |
| 4 | Login with known identifier and wrong password | 401 `INVALID_CREDENTIALS`, `failedLogins` incremented by 1 |
| 5 | Five wrong passwords then the correct one | 423 `ACCOUNT_LOCKED`, `lockedUntil` about 15 minutes ahead, no token issued |
| 6 | Correct password after `lockedUntil` passes | 200, `failedLogins` back to 0, `lockedUntil` null |
| 7 | Login on a `DISABLED` user | 403 `ACCOUNT_DISABLED`, no token, no counter change |
| 8 | Refresh with a valid cookie | 200, new access token, old `tokenHash` row has `revokedAt` set, new row shares `familyId` |
| 9 | Refresh twice with the same token, 10 seconds apart | Second call 401 `TOKEN_REUSED`, every row in the family revoked, cookie cleared |
| 10 | Refresh twice with the same token inside 5 seconds | Both calls 200 with byte-identical bodies, family intact |
| 11 | Refresh with a token whose `expiresAt` has passed | 401 `TOKEN_EXPIRED`, family untouched |
| 12 | Logout then refresh with the same cookie | 401 `TOKEN_INVALID` |
| 13 | Any business endpoint with `mustReset: true` | 403 `PASSWORD_RESET_REQUIRED`; `POST /auth/change-password` still reachable |
| 14 | Change password with the wrong current password | 401 `INVALID_CREDENTIALS`, hash unchanged |
| 15 | Change password successfully | 200, all prior refresh rows revoked, `mustReset` false, old access token still valid until `exp` |
| 16 | Password below 10 chars, or containing the username | 422 `WEAK_PASSWORD` with a populated `details` array |
| 17 | Admin reset by a `STORE_MANAGER` on a user in another outlet | 404 `NOT_FOUND` |
| 18 | Admin reset by `KITCHEN_STAFF` | 403 `FORBIDDEN` |
| 19 | Access token with a tampered `roleKey` payload | 401, signature verification fails before any guard runs |
| 20 | Access token signed with `"alg": "none"` | 401, algorithm not in the pinned list |
| 21 | 21 login attempts from one IP inside 15 minutes | 429 `RATE_LIMITED` with `Retry-After` set |
| 22 | Any user record returned by any endpoint | Response JSON contains no `passwordHash` key |

Case 3 needs care in CI. Assert on the median of 20 runs rather than a single
sample, because a cold Prisma connection makes the first call an outlier and
turns a real check into a flaky one.
