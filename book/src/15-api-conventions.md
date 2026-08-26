# API conventions

Every rule in this chapter applies to every endpoint in the system. If a module
chapter says something different, this chapter wins and the module chapter is a
bug. The point of writing them down once is that a new engineer picking up a
ticket in the purchase module should be able to guess the shape of the request,
the shape of the response and the shape of the failure without opening the
controller.

## Base path and versioning

Everything lives under `/api/v1`. The prefix is set once:

```ts
// apps/api/src/main.ts
app.setGlobalPrefix('api/v1', {
  exclude: ['healthz', 'readyz'],
});
```

Health endpoints sit outside the prefix because Railway's probe configuration
does not know or care about API versions.

Version 1 is the only version Phase 1 ships, and the policy for a future `v2` is
narrow on purpose. Additive changes stay in v1: a new endpoint, a new optional
request field, a new field in a response object, a new enum value that only
appears in newly created rows. Clients tolerate all of those.

A `v2` is triggered by exactly three things. Removing or renaming a response
field that the web app reads. Changing the type or units of an existing field,
for example moving `quantity` from a string to a number or from kilograms to
grams. Changing the meaning of a status code on an existing path, for example a
`POST` that used to return `201` with the created object now returning `202`
with a job id. Anything else is a v1 change with a migration note.

When v2 does happen, both versions are mounted from the same NestJS app with
versioned controllers, v1 is frozen, and the deprecation window is at least one
month, because the only client is our own web app and the two deploy together.

## Content type, casing and formats

Requests and responses are `application/json; charset=utf-8`. The one exception
is task proof upload, which is `multipart/form-data` and is documented in the
tasks chapter.

JSON keys are `camelCase`, matching the Prisma model fields exactly, so nothing
in the stack transforms a key name. Postgres columns are snake_case through
Prisma's `@map`, and that mapping is the only place naming changes.

| Kind | Wire format | Example | Note |
|---|---|---|---|
| Business date | `YYYY-MM-DD` | `"2026-08-24"` | Asia/Kolkata calendar date, no time, no zone |
| Timestamp | RFC 3339 UTC with `Z` | `"2026-08-24T13:45:02.117Z"` | Always UTC on the wire |
| Time of day | `HH:mm` 24 hour | `"07:30"` | Shift start and end only |
| UUID | canonical v4 | `"c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05"` | Lowercase |
| Enum | SCREAMING_SNAKE | `"TRANSFER_OUT"` | Exactly the Prisma enum value |
| Boolean | `true` / `false` | | Never `0`, `1`, `"yes"` |
| Money | string | `"1450.00"` | Always two decimal places |
| Quantity | string | `"12.500"` | Always three decimal places |
| Null | `null` | | Optional fields are present and null, not absent |

A business date is not a timestamp with the time zeroed. `"2026-08-24"` means
the trading day that started at 04:00 IST on 24 August, which is the rule the
data chapter owns. Sending `"2026-08-24T00:00:00Z"` where a business date is
expected fails validation with `VALIDATION_FAILED`, deliberately, because that
value is 05:30 IST on the same day and quietly means something else.

## Decimals are strings

Money is `Decimal(14, 2)` and quantity is `Decimal(14, 3)`. Both are serialised
as JSON strings.

JavaScript numbers are IEEE 754 doubles with 53 bits of mantissa, so integers
stay exact up to 9,007,199,254,740,991. `Decimal(14,3)` allows values up to
99,999,999,999.999, which as a scaled integer is 99,999,999,999,999, well past
the safe range once you also account for the fractional part not being
representable in binary at all. `0.1 + 0.2` is `0.30000000000000004` in any JS
runtime, and a purchase total that arrives as `1450.0000000000002` is a support
ticket that costs more to explain than the feature was worth.

So the API never emits a bare JSON number for a decimal column. Prisma returns a
`Prisma.Decimal`, and one global interceptor stringifies it on the way out:

```ts
// apps/api/src/common/interceptors/decimal.interceptor.ts
function serialise(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) {
    return value.toFixed(value.dp() > 2 ? 3 : 2);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialise(v)]),
    );
  }
  return value;
}
```

In practice the scale is decided per field by the schema rather than by
inspection, and the interceptor reads a per-model scale map so `totalAmount`
always renders `"1450.00"` and `quantity` always renders `"12.500"`. Trailing
zeros are kept. `"12.5"` and `"12.500"` mean the same thing to a computer and
different things to a Store Manager reading a stock register.

On the frontend, the rule is that the browser never does money arithmetic. Every
total, subtotal, tax figure and stock balance in a response is already computed
by the API. The web app parses a decimal string only to format it:

```ts
// apps/web/src/lib/money.ts
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export const formatMoney = (v: string) => INR.format(Number(v));
export const formatQty = (v: string, unit: string) =>
  `${Number(v).toFixed(3).replace(/\.?0+$/, '')} ${unit}`;
```

`Number(v)` for display is safe because a rendered figure that is off in the
fifteenth decimal place rounds away at two. The one place the browser must
compute is the live line total preview on the purchase form, and that helper
multiplies in integer paise:

```ts
export const lineTotalPaise = (qty: string, unitPrice: string) =>
  Math.round(Number(qty) * 1000) * Math.round(Number(unitPrice) * 100) / 1000;
```

The preview is a convenience. The server recomputes every line total and the
purchase subtotal from the submitted quantities and prices, and the server's
number is the one that is stored. If the two disagree, the server is right.

## Request validation

Every request body, query string and route param is validated by a zod schema
that lives in `packages/shared`. The API imports it, the web form imports the
same object, and the DTO type is inferred from it. One definition, not two.

```ts
// packages/shared/src/inventory/record-transaction.schema.ts
import { z } from 'zod';

export const decimalString = (scale: number) =>
  z.string().regex(new RegExp(`^\\d{1,11}(\\.\\d{1,${scale}})?$`),
                   `Must be a number with up to ${scale} decimal places`);

export const recordTxnSchema = z
  .object({
    itemId: z.string().uuid(),
    outletId: z.string().uuid(),
    type: z.enum(['OPENING', 'RECEIVED', 'ISSUED', 'WASTAGE',
                  'ADJUSTMENT', 'CLOSING']),
    quantity: decimalString(3),
    businessDate: z.string().date(),
    reason: z.string().trim().min(3).max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => !['WASTAGE', 'ADJUSTMENT'].includes(v.type) || !!v.reason,
    { path: ['reason'], message: 'Reason is required for this type' },
  );

export type RecordTxnDto = z.infer<typeof recordTxnSchema>;
```

The pipe is 20 lines and is the only place a zod error becomes an HTTP error:

```ts
// apps/api/src/common/pipes/zod-validation.pipe.ts
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    throw new AppError('VALIDATION_FAILED', 400, {
      details: parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        issue: i.code,
        message: i.message,
      })),
    });
  }
}
```

Three consequences follow from inferring the DTO. A field added to the schema
appears in the type immediately, so the service fails to compile until it is
handled. A field removed from the schema breaks every reference. And the web
form validates with the identical rules, so a request that passes client
validation and fails server validation is a bug in the shared schema rather than
a difference of opinion between two codebases.

Never hand-write an `interface` next to a schema. If you find one, delete it and
use `z.infer`.

## Response envelopes

A collection endpoint returns `data` and `meta`:

```json
{
  "data": [
    { "id": "c1a4...", "sku": "ITM-CHICKEN-MINCE", "name": "Chicken Mince" },
    { "id": "9f21...", "sku": "ITM-MAIDA",         "name": "Maida" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 137 }
}
```

A single resource returns the object directly, with no wrapper:

```json
{
  "id": "c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05",
  "sku": "ITM-CHICKEN-MINCE",
  "name": "Chicken Mince",
  "isActive": true,
  "createdAt": "2026-08-01T06:12:44.001Z"
}
```

`204 No Content` has no body at all. A `POST` that creates returns `201` with
the created object, not with an id in a wrapper, so the client can put it
straight into the TanStack Query cache.

## Error envelope

Every failure on every endpoint, including a 500, returns this and nothing else:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Cannot issue 5.000 KG of Chicken Mince. Only 2.400 KG on hand.",
    "details": [ { "field": "quantity", "issue": "exceeds_on_hand" } ],
    "requestId": "01JK8Y3M2QW9V0X4"
  }
}
```

`code` is stable and machine readable. The web app switches on it. Renaming a
code is a breaking change and needs the same treatment as removing a response
field.

`message` is written for the person reading it on a phone in a kitchen. It names
the item, the quantity and the number that would fix the problem. It never
contains a stack trace, a SQL fragment, a Prisma error code, an internal id or a
file path. `AllExceptionsFilter` guarantees this: any exception that is not an
`AppError` is logged in full with the `requestId` and returned to the caller as
`INTERNAL_ERROR` with a fixed message.

`details` is optional and is an array of `{ field, issue }` objects. It exists
so a form can highlight the offending input. It is never prose.

`requestId` is always present, including on a 500, and is the same value as the
`X-Request-Id` response header.

## Error code registry

Fifty-seven codes. This table is the whole registry, and a module may not invent
a code outside it without adding a row here in the same pull request.

| Code | HTTP | Fires when | Message template | Module |
|---|---|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Unknown identifier, or password verify fails | `Incorrect username or password.` | auth |
| `ACCOUNT_LOCKED` | 423 | Password correct, `lockedUntil` in the future | `Account locked. Try again in {minutes} minutes.` | auth |
| `ACCOUNT_DISABLED` | 403 | `User.status` is `DISABLED` or `SUSPENDED` | `This account is no longer active. Contact your manager.` | auth |
| `TOKEN_MISSING` | 401 | No bearer token, or no refresh cookie | `Please sign in to continue.` | auth |
| `TOKEN_INVALID` | 401 | Signature fails, or refresh hash not found | `Your session is not valid. Please sign in again.` | auth |
| `TOKEN_EXPIRED` | 401 | Access token past `exp`, or refresh past `expiresAt` | `Your session has expired. Please sign in again.` | auth |
| `TOKEN_REUSED` | 401 | Revoked refresh token presented outside the 5s window | `Your session was ended for security. Please sign in again.` | auth |
| `PERMISSIONS_STALE` | 401 | `permHash` claim differs from the compiled hash | `Your access has changed. Please sign in again.` | auth |
| `PASSWORD_RESET_REQUIRED` | 403 | `mustReset` is true and route is not the change screen | `Set a new password before continuing.` | auth |
| `WEAK_PASSWORD` | 422 | Deny list hit, or password contains the username | `Choose a stronger password. {reason}` | auth |
| `SAME_PASSWORD` | 422 | New password equals the current one | `New password must be different from the current one.` | auth |
| `FORBIDDEN` | 403 | Role lacks the required permission key | `You do not have permission to do that.` | common |
| `OUTLET_SCOPE_VIOLATION` | 403 | Body names an outlet the caller cannot write to on a create | `You can only record this for {outletName}.` | common |
| `VALIDATION_FAILED` | 400 | Body, query or params fail the zod schema | `Please check the highlighted fields.` | common |
| `INVALID_DATE_RANGE` | 400 | `from` after `to`, or range wider than 366 days | `Choose a date range where the start is before the end.` | common |
| `UNSUPPORTED_FILE_TYPE` | 415 | Upload mime type outside jpeg, png, webp, pdf | `Only JPG, PNG, WEBP and PDF files can be attached.` | common |
| `FILE_TOO_LARGE` | 413 | Upload over 5 MB after client-side compression | `File is too large. Maximum size is 5 MB.` | common |
| `ITEM_NOT_FOUND` | 404 | `itemId` does not exist | `That item no longer exists.` | inventory |
| `ITEM_INACTIVE` | 422 | Transaction or purchase line names a deactivated item | `{itemName} is deactivated and cannot be used.` | inventory |
| `INSUFFICIENT_STOCK` | 422 | Issue, wastage or transfer exceeds `qtyOnHand` | `Cannot issue {qty} {unit} of {itemName}. Only {onHand} {unit} on hand.` | inventory |
| `NEGATIVE_STOCK_BLOCKED` | 422 | Adjustment would push `qtyOnHand` below zero | `This would take stock below zero. Record an adjustment with a reason instead.` | inventory |
| `REASON_REQUIRED` | 422 | `WASTAGE` or `ADJUSTMENT` submitted with no reason | `A reason is required for {type}.` | inventory |
| `CLOSING_ALREADY_RECORDED` | 409 | Second `CLOSING` row for the same item, outlet and date | `Closing stock for {date} is already recorded.` | inventory |
| `TRANSFER_SAME_OUTLET` | 422 | Transfer source equals destination | `Choose a different outlet to transfer to.` | inventory |
| `STOCK_LOCKED_FOR_DATE` | 409 | Backdated write into a closed business day | `{date} is closed. Ask a manager to record an adjustment.` | inventory |
| `REQUEST_NOT_PENDING` | 409 | Approve or reject on a request that is not `PENDING` | `This request is already {status}.` | purchase |
| `REQUEST_ALREADY_DECIDED` | 409 | Second decision on the same request | `This request was already decided by {decidedBy}.` | purchase |
| `PURCHASE_ALREADY_VOIDED` | 409 | Void on a purchase whose status is `VOIDED` | `This purchase was already voided.` | purchase |
| `VENDOR_INACTIVE` | 422 | Purchase names a vendor with `isActive: false` | `{vendorName} is no longer an active vendor.` | purchase |
| `PRICE_REQUIRED` | 422 | Purchase line with a null or zero unit price | `Enter a unit price for {itemName}.` | purchase |
| `PURCHASE_LINE_EMPTY` | 422 | Purchase submitted with zero lines | `Add at least one item to the purchase.` | purchase |
| `ALREADY_PUNCHED_IN` | 409 | Punch in while an open `IN` punch exists | `You are already punched in since {time}.` | workforce |
| `NOT_PUNCHED_IN` | 409 | Punch out or break start with no open `IN` punch | `Punch in first.` | workforce |
| `BREAK_ALREADY_OPEN` | 409 | Break start while a `BreakLog` has no `endedAt` | `A break is already running since {time}.` | workforce |
| `OVERLAPPING_SHIFT` | 409 | New shift overlaps an existing `SCHEDULED` shift | `{employeeName} already has a shift from {start} to {end}.` | workforce |
| `LEAVE_OVERLAP` | 409 | Leave dates overlap a `PENDING` or `APPROVED` request | `You already have leave requested for {date}.` | workforce |
| `LEAVE_NOT_PENDING` | 409 | Decision on a request that is not `PENDING` | `This leave request is already {status}.` | workforce |
| `LEAVE_PAST_DATE` | 422 | `fromDate` earlier than today, non-manager caller | `Leave cannot be requested for a past date.` | workforce |
| `SALARY_PERIOD_OVERLAP` | 409 | New salary record overlaps an existing effective range | `A salary record already covers {date}.` | workforce |
| `TASK_NOT_ASSIGNED_TO_YOU` | 403 | Complete or update on a task with a different assignee | `This task is assigned to {assigneeName}.` | task |
| `TASK_ALREADY_COMPLETED` | 409 | Complete on a task already `COMPLETED` or `VERIFIED` | `This task was already completed at {time}.` | task |
| `CHECKLIST_INCOMPLETE` | 422 | Checklist submitted with unanswered items | `{count} checklist items still need an answer.` | task |
| `PHOTO_REQUIRED` | 422 | Item with `requiresPhoto` marked without an attachment | `Attach a photo for "{label}".` | task |
| `VERIFICATION_REQUIRED` | 409 | Task with `requiresVerification` closed without verify | `This task needs a manager to verify it.` | task |
| `SALES_ENTRY_EXISTS` | 409 | Second entry for the same outlet and business date | `Sales for {date} are already recorded.` | sales |
| `SALES_ENTRY_LOCKED` | 409 | Amend on an entry with `lockedAt` set | `Sales for {date} are locked. Ask the owner to unlock.` | sales |
| `PAYMENT_SPLIT_MISMATCH` | 422 | Cash plus UPI plus card plus other differs from `netSales` | `Payment split is {split} but net sales is {net}.` | sales |
| `WHATSAPP_DISABLED` | 503 | WhatsApp send attempted while the feature flag is off | `WhatsApp messages are switched off right now.` | notification |
| `TEMPLATE_NOT_APPROVED` | 422 | Send uses a template Meta has not approved | `That message template is not approved yet.` | notification |
| `RATE_LIMITED` | 429 | Sliding window limit exceeded | `Too many requests. Try again in {seconds} seconds.` | common |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Idempotent endpoint called without the header | `Missing Idempotency-Key header.` | common |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key replayed with a different body hash | `This request was already submitted with different data.` | common |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Same key replayed while the first call is still running | `Still saving. Please wait a moment.` | common |
| `NOT_FOUND` | 404 | Resource missing, or outside the caller's outlet scope | `Not found.` | common |
| `CONFLICT` | 409 | Unique constraint or state machine violation with no specific code | `That change conflicts with existing data.` | common |
| `INTERNAL_ERROR` | 500 | Any unhandled exception | `Something went wrong. Reference {requestId}.` | common |
| `SERVICE_UNAVAILABLE` | 503 | Postgres or Redis unreachable during a request | `The system is temporarily unavailable. Try again shortly.` | common |

Message templates are stored next to the code in
`packages/shared/src/errors/registry.ts`, and `AppError` interpolates the
placeholders from the `context` object passed at throw time. That is why the
registry is a table and not a set of string literals scattered across 20
services: changing the wording of `INSUFFICIENT_STOCK` is a one line diff and
cannot miss a call site.

## Pagination, sorting and filtering

Offset pagination only. Cursor pagination is not in Phase 1 and is not needed at
137 rows.

```text
  GET /api/v1/inventory/items?page=2&pageSize=50
  GET /api/v1/purchases?outletId=c1a4...&from=2026-08-01&to=2026-08-24
  GET /api/v1/tasks?status=OPEN&status=IN_PROGRESS&sort=-dueAt
  GET /api/v1/attendance/days?employeeId=7a2e...&from=2026-08-01&to=2026-08-31
```

| Parameter | Default | Rule |
|---|---|---|
| `page` | 1 | Integer, minimum 1 |
| `pageSize` | 25 | Integer, 1 to 100, values above 100 fail validation rather than clamp |
| `sort` | per endpoint | Field name, `-` prefix for descending, one field only |
| `from` / `to` | none | `YYYY-MM-DD` business dates, inclusive on both ends |
| `outletId` | caller's scope | UUID, must sit inside the caller's outlet scope |
| `status` | none | Repeatable, treated as OR within the parameter |

Every list query goes through one shared schema so these rules cannot drift:

```ts
// packages/shared/src/common/list-query.schema.ts
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().regex(/^-?[a-zA-Z]+$/).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  outletId: z.string().uuid().optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to,
          { path: ['to'], message: 'INVALID_DATE_RANGE' });
```

Sorting is restricted to an allowlist per endpoint. `sort=-dueAt` is fine on
tasks, `sort=passwordHash` fails with `VALIDATION_FAILED`, because the allowlist
is a literal union type in the endpoint's own schema, not a pass-through to
Prisma.

`meta.total` comes from a second `count` query inside the same request. On the
largest table Phase 1 will see, `StockTransaction` at maybe 60,000 rows after a
year, a filtered count on the `(outletId, businessDate)` index runs in single
digit milliseconds. When that stops being true, the fix is a cached count, not
cursor pagination.

## Idempotency

Three endpoints require an `Idempotency-Key` header, and calling them without it
fails with `400 IDEMPOTENCY_KEY_REQUIRED`:

| Endpoint | Why |
|---|---|
| `POST /api/v1/purchases` | Double submit creates a duplicate purchase, duplicate stock receipt and a duplicate price history point |
| `POST /api/v1/inventory/transactions` | Double submit moves stock twice |
| `POST /api/v1/attendance/punch` | Double tap on a laggy counter tablet creates a second punch |

The key is a UUID v4. The Redis record:

```text
  key    idem:<userId>:<idempotencyKey>
  value  { "bodyHash": "<sha256 of the canonical JSON body>",
           "status": 201,
           "body": { ...the exact response that was returned... } }
  ttl    86400 seconds (24 hours)
```

The interceptor runs before the controller and after it:

```text
  request arrives with Idempotency-Key
        │
        ▼
  SET idem:<user>:<key> "{in_progress}" NX EX 60
        │
        ├── set succeeded ──► run the handler
        │                     │
        │                     ├─ 2xx ─► overwrite the key with the full
        │                     │         record, TTL 24h, return response
        │                     │
        │                     └─ 4xx/5xx ─► DELETE the key, return the error
        │                                   (a failure is retryable)
        │
        └── key exists ──► GET it
                    │
                    ├─ in_progress ──► 409 IDEMPOTENCY_IN_PROGRESS
                    ├─ bodyHash matches ──► replay stored status
                    │                       and body verbatim
                    └─ bodyHash differs ──► 409 IDEMPOTENCY_KEY_REUSED
```

Failed requests release the key. A purchase rejected with `VENDOR_INACTIVE`
should be re-submittable with the same key after the user picks a different
vendor, and the body hash check still protects against the double-tap case.

The client-side rule matters as much as the server side. The key is generated
once per user intent, when the form is opened or when the submit handler first
fires, and is reused across every retry of that intent. Generating a fresh key
inside the retry loop defeats the entire mechanism, because each retry then
looks like a new purchase to the server.

```ts
// apps/web/src/features/purchase/use-record-purchase.ts
export function useRecordPurchase() {
  const idempotencyKey = useRef(crypto.randomUUID()).current; // once per form
  return useMutation({
    mutationFn: (body: RecordPurchaseDto) =>
      api.post('/purchases', body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    retry: 2,
  });
}
```

## Rate limiting

Three tiers, all enforced by one Redis-backed guard.

| Tier | Applies to | Limit | Key |
|---|---|---|---|
| Public game | `POST /api/v1/public/game/plays`, `GET /api/v1/public/game/:slug` | 10 per minute, and 30 plays per hour | `rl:game:<sha256(ip)>` and `rl:play:<sessionKey>` |
| Auth | `POST /auth/login` | 20 per 15 minutes per IP, 10 per 15 minutes per identifier | `rl:login:<sha256(ip)>`, `rl:login:<identifier>` |
| Auth refresh | `POST /auth/refresh` | 60 per hour per user | `rl:refresh:<userId>` |
| App write | Any authenticated `POST`, `PATCH`, `DELETE` | 60 per minute per user | `rl:w:<userId>` |
| App read | Any authenticated `GET` | 300 per minute per user | `rl:r:<userId>` |

The public game tier is strictest because it is the only surface an anonymous
stranger can reach, and open question 6 in the SRS settles the fraud posture at
"rate limiting plus one play per session key per cooldown", with no ML and no
device fingerprinting.

The window is a sliding window over a Redis sorted set, evaluated in one Lua
script so the read, prune, insert and count are atomic:

```lua
-- apps/api/src/common/redis/sliding-window.lua
local key    = KEYS[1]
local now    = tonumber(ARGV[1])   -- ms
local window = tonumber(ARGV[2])   -- ms
local limit  = tonumber(ARGV[3])
local member = ARGV[4]             -- requestId, unique per call

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return { 0, limit, 0, math.ceil((oldest[2] + window - now) / 1000) }
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return { 1, limit, limit - count - 1, 0 }
```

A sorted set rather than a fixed-window counter because a fixed window lets an
attacker send 20 login attempts at 14:59:59 and 20 more at 15:00:00. The memory
cost is bounded by the limit itself, at most 300 small members per user per
minute, and Upstash's 250 MB fixed plan absorbs that without noticing.

Every response on a rate limited route carries the headers, not just the 429:

```text
  RateLimit-Limit: 60
  RateLimit-Remaining: 57
  RateLimit-Reset: 34
```

And the 429 adds `Retry-After: 34` alongside the standard error envelope with
code `RATE_LIMITED`.

## Request tracing

A middleware at the very front of the chain assigns every request an id: 16
Crockford base32 characters, 48 bits of millisecond timestamp followed by 32
bits of randomness, which sorts lexicographically by time and reads back as a
timestamp when you need one. `01JK8Y3M2QW9V0X4` is the shape.

The id travels through four places:

```text
  edge middleware
    ├─► req.id                        available to every handler
    ├─► X-Request-Id response header  on success and on failure
    ├─► every log line for the request (pino child logger bound to req.id)
    ├─► error envelope requestId      what the user reads out on the phone
    └─► OutboxEvent.payload.requestId written inside the business transaction
```

The outbox link is the one that pays for itself at 02:00. A WhatsApp message
went out saying a purchase request was approved, the Purchase Manager says they
never approved it, and the `Notification` row carries the `eventKey` and the
payload. The payload carries the `requestId`. That id finds the exact HTTP
request in the logs, with its user id, its IP, its route and its timing. Without
it you are grepping a log window by timestamp and hoping.

If the incoming request already has an `X-Request-Id` header and it matches the
expected format, the middleware keeps it. That lets the Next.js server component
fetches carry their id through to the API, so one page render is one traceable
id end to end.

## Health endpoints

Two endpoints, mounted outside the `/api/v1` prefix, both unauthenticated.

`GET /healthz` is liveness. It returns `200 {"status":"ok"}` if the Node process
is running and the event loop is not wedged. It touches nothing external. It
must never fail because Postgres is slow.

`GET /readyz` is readiness. It runs `SELECT 1` against Postgres with a 2 second
timeout and `PING` against Redis with a 1 second timeout, in parallel.

```json
{
  "status": "degraded",
  "checks": {
    "postgres": { "ok": true,  "latencyMs": 14 },
    "redis":    { "ok": false, "error": "ETIMEDOUT" }
  }
}
```

That response returns `503`. An all-clear returns `200` with
`"status": "ready"`. The failing dependency is named, because at 02:00 the first
question is always "is it us or is it Supabase".

Railway needs the distinction for two different jobs. Its deploy healthcheck
points at `/readyz`, so a new container does not receive traffic until Prisma
has connected and Redis answers, which prevents a deploy from serving 500s for
the first three seconds. Uptime monitoring points at `/healthz`, because if it
pointed at `/readyz` a 40 second Supabase maintenance blip would look like an
application outage and, worse, could trigger a platform restart of a process
that was perfectly healthy and would have recovered on its own. Restarting a
healthy process during a database blip makes the outage longer, not shorter.

## OpenAPI

The spec is generated, never hand-written. `@asteasolutions/zod-to-openapi`
registers the same zod schemas that validate requests, so the documented shape
and the enforced shape cannot disagree.

```ts
// apps/api/src/main.ts
if (process.env.NODE_ENV !== 'production') {
  const document = buildOpenApiDocument(registry); // from packages/shared
  SwaggerModule.setup('api/docs', app, document);
}
```

Swagger UI is served at `/api/docs` in development and staging and is not
mounted in production. The generated JSON is written to
`apps/api/openapi.json` by `bun run openapi:gen` and committed, so a schema
change shows up as a readable diff in the pull request. CI regenerates it and
fails if the committed file is stale. There is no `@ApiProperty` decorator
anywhere in the codebase, and a pull request that adds one gets rejected: it
creates a second definition of the request shape that will drift from the zod
schema within a month.

## A complete request cycle

Recording a purchase. Purchase Manager, at the vendor, on a phone.

```text
POST /api/v1/purchases HTTP/1.1
Host: api.bobsmomo.in
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI...
Idempotency-Key: 4f1c9a2e-77d8-4b31-9a5c-0e6b8d2c1f04
X-Request-Id: 01JK8Y3M2QW9V0X4
```

```json
{
  "outletId": "c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05",
  "vendorId": "8b21d5f0-63ac-4d17-b0e2-95f7c4a10d3b",
  "requestId": "2e77b901-45cd-4a6f-8b12-3c9e0d7f5a66",
  "invoiceNo": "SG/2026/1184",
  "purchaseDate": "2026-08-24",
  "taxAmount": "0.00",
  "lines": [
    { "itemId": "d3a1...", "quantity": "12.500", "unitPrice": "268.00" },
    { "itemId": "9f21...", "quantity": "50.000", "unitPrice": "42.50" }
  ]
}
```

Success, `201 Created`:

```text
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
X-Request-Id: 01JK8Y3M2QW9V0X4
RateLimit-Limit: 60
RateLimit-Remaining: 58
RateLimit-Reset: 41
```

```json
{
  "id": "6c0f9b74-2a18-4e35-91cd-7f4b2e08a5d1",
  "purchaseNo": "PO-2026-0117",
  "outletId": "c1a44e83-0d2b-4e7a-9f61-77c0a2b91e05",
  "vendorId": "8b21d5f0-63ac-4d17-b0e2-95f7c4a10d3b",
  "vendorName": "Sai Ganesh Traders",
  "status": "RECORDED",
  "invoiceNo": "SG/2026/1184",
  "purchaseDate": "2026-08-24",
  "subtotal": "5475.00",
  "taxAmount": "0.00",
  "totalAmount": "5475.00",
  "items": [
    {
      "id": "a1b2...", "itemId": "d3a1...", "itemName": "Chicken Mince",
      "quantity": "12.500", "unitPrice": "268.00", "lineTotal": "3350.00"
    },
    {
      "id": "c3d4...", "itemId": "9f21...", "itemName": "Maida",
      "quantity": "50.000", "unitPrice": "42.50", "lineTotal": "2125.00"
    }
  ],
  "recordedById": "b3f1c2d4-9a71-4f0e-8c33-2b6f5d1e77c9",
  "createdAt": "2026-08-24T04:52:11.338Z"
}
```

Failure one, the vendor was deactivated last week and the phone was showing a
cached list. `422 Unprocessable Entity`:

```json
{
  "error": {
    "code": "VENDOR_INACTIVE",
    "message": "Sai Ganesh Traders is no longer an active vendor.",
    "details": [ { "field": "vendorId", "issue": "inactive" } ],
    "requestId": "01JK8Y3M2QW9V0X4"
  }
}
```

Failure two, the submit button was tapped twice and the second tap carried an
edited quantity. `409 Conflict`:

```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "This request was already submitted with different data.",
    "details": [ { "field": "Idempotency-Key", "issue": "body_mismatch" } ],
    "requestId": "01JK8Y3M2QX2C1B7"
  }
}
```

Failure three, a Store Manager tried the same call. `403 Forbidden`:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to do that.",
    "details": [ { "field": "permission", "issue": "purchase.record.create" } ],
    "requestId": "01JK8Y3N0P4RA9M2"
  }
}
```

The `details` entry on that last one names the missing permission key. That is
safe to expose, because the full matrix is in
[Roles, permissions and outlet scope](14-rbac-and-permissions.md) and every user
can already discover their own grants from the login response. It saves an
engineer 20 minutes when a manager reports that a button does nothing.
