# Customer CRM and the game layer

## The scope risk

This module is committed in the timeline, the cost and the acceptance criteria,
and it is not specified anywhere in the SRS. Here are the facts.

The executive summary names five business pillars and Customer Experience is one
of them. The TO-BE section immediately after it says the system "will be
organized into five business pillars, detailed in Section 6" and then lists
four bullets. Customer Experience is not among them.

Section 6, Module Architecture, is numbered 6.1 Operations Management, 6.2
Workforce Management, 6.4 Management and Analytics, 6.5 Internal Communication.
There is no 6.3. The module that would have been scoped there is the one the
executive summary promised.

Open question 7 asks for a decision on "Guest vs identified-customer handling in
the Customer CRM" and cites "Section 15.7 / FR-CRM-001". Section 15 is the
Database Overview and has no subsection 15.7. The string FR-CRM-001 appears
exactly once in the document, in that citation. There is no such requirement.

Section 13, which holds every functional requirement, has FR blocks for AUTH,
INV, PUR, EMP, TASK and NOTIF. It has none for CRM or the game.

Meanwhile the commitments are explicit. The week 3 plan reads "Customer/game
CRM, game configuration/publishing, rewards, integrations, testing, bug fixing,
UAT, production deployment". Acceptance criterion 3 requires that "inventory,
purchase, employee, task, and game/reward workflows operate end-to-end". The
analytics report list includes Customer Game / Reward Trends. The notification
table includes "Reward Issued to Customer". The AS-IS table lists customer
engagement as "Website games (isolated), scores/coins/rewards not connected to
management visibility". The backend architecture section lists Game and CRM as
NestJS modules by name.

So the build has a deadline, a test and a sign-off gate, and no requirement.

### Impact

This is the single largest scope risk in the project, for three reasons that
compound.

It is unbounded. Nothing in the SRS caps what "Customer/game CRM" means. The
same phrase covers a two week build and a two day build, and the client and the
agency currently have no shared picture of which one was priced at Rs 45,000.

It sits in week 3. Week 3 also carries integrations, testing, bug fixing, UAT
and production deployment. Every one of those is a fixed commitment that cannot
absorb overrun. The least specified module in the project shares its week with
the work that cannot slip, and it is scheduled after the point where scope can
be traded against time.

It is the only module that faces the open internet. The game endpoints take
requests from anonymous browsers and hand out things that have cash value at a
counter. That is a different security posture from the rest of the system, and
it needs design attention that a rushed week 3 will not give it.

### Recommendation

Get a written scope for the customer CRM and game layer signed in week 1, or
move it to Phase 2 and amend acceptance criterion 3 in writing.

Those are the only two acceptable outcomes. The unacceptable one is arriving at
day 15 with a week 3 plan that says "game CRM" and a client who expects
something nobody has drawn. The rest of this chapter exists to make the first
outcome cheap: it is a minimum viable specification concrete enough to put in
front of the client as a one page agreement.

## What the SRS fragments actually support

The proposal below is built only from what the document already says, not from
what a CRM usually contains.

| Fragment in the SRS | What it implies |
|---|---|
| "Website games (isolated)" in the AS-IS table | A game already exists on the website. The ERP is not being asked to build one |
| "Scores/coins/rewards not connected to management visibility" | The gap is reporting and control, not gameplay |
| "the customer-facing website game layer, which consumes game/reward configuration and submits scores through secured APIs" | The ERP owns configuration and receives scores |
| "game configuration/publishing" in the week 3 plan | Configuration is versioned and has a publish step |
| "Reward Issued to Customer" in the notification table | Coupons are issued to a customer and the customer is notified |
| "Customer Game / Reward Trends" in the report list | Plays, coins and redemptions are reportable |
| "rate limiting on public-facing game APIs to mitigate abuse" in the NFR table | Abuse control is rate limiting, explicitly |
| "caching frequently read data (e.g., published game configuration)" | Published config is cached in Redis |

Everything in this chapter follows from that list. Nothing in it invents a
loyalty programme, a customer segment engine or a campaign tool.

## Proposed Phase 1 scope

The ERP owns game configuration and publishing. It receives scores from the
existing website game through a secured public API. It converts scores to coins
by a configured rule. It lets a customer with a verified phone number spend
coins on a reward coupon. It lets outlet staff redeem that coupon in person. It
reports on all of it.

The ERP does not build a game. The game stays where it is, on the website, and
the only change on that side is that it fetches its configuration from the ERP
and posts its scores back.

```text
  Open internet                    │  Authenticated ERP
  ─────────────                    │  ─────────────────
                                   │
  ┌──────────────┐                 │
  │ Website game │                 │
  │  (existing)  │                 │
  └──────┬───────┘                 │
         │ GET  /public/game/:slug/config
         │ POST /public/game/:slug/play
         ▼                         │
  ┌─────────────────────────┐      │      ┌──────────────────────┐
  │ Public controller       │      │      │ Admin: GameConfig    │
  │ no JWT, rate limited,   │◀─────┼──────│ rulesJson, publish   │
  │ score ceiling enforced  │      │      │ crm.game.publish     │
  └──────────┬──────────────┘      │      └──────────────────────┘
             │ writes GamePlay     │
             │ awards coins        │      ┌──────────────────────┐
             ▼                     │      │ Staff: redeem coupon │
  ┌─────────────────────────┐      │      │ crm.reward.redeem    │
  │ Customer, coinBalance   │──────┼─────▶│ sets REDEEMED        │
  │ RewardIssue, couponCode │      │      └──────────────────────┘
  └─────────────────────────┘      │
             │                     │      ┌──────────────────────┐
             └─────────────────────┼─────▶│ GET /analytics/crm   │
                                   │      └──────────────────────┘
```

The vertical line is the trust boundary. Everything on the left is written by a
browser nobody controls. Everything on the right has a JWT, a role and an outlet
scope behind it.

## The data model

Five models, all already in the shared schema in
[chapter 10](10-data-model.md).

`Customer` holds one row per person, keyed on a unique `phone`. `name` is
optional because the verification flow does not ask for it. `isGuest` marks a
row created without verification, which in the proposed scope never happens,
and the flag exists so a later phase can change that without a migration.
`coinBalance` is a denormalised running total, maintained inside the same
transaction that writes the `GamePlay` or `RewardIssue` row that moves it.
`consentAt` records when the customer agreed to be contacted.

`GameConfig` holds one row per game, keyed on a unique `slug` that the website
uses in its URLs. `rulesJson` carries the entire rule set as a JSON blob.
`isPublished` and `publishedAt` gate whether the public config endpoint returns
it. `version` increments on every publish, which makes it possible to read a
`GamePlay` row and know which rule set awarded its coins.

`GamePlay` is append only. One row per completed play, carrying the raw `score`,
the `coinsEarned` the server computed, the `sessionKey` the play was made under,
an optional `customerId` if the player was verified, and `ipHash`. The IP is
hashed rather than stored, because a raw IP against a phone number is personal
data with no operational use here; the hash is enough to rate limit and to spot
a burst from one address.

`RewardDefinition` is the catalogue. A code, a name, a `coinCost`, and an
optional `gameId` if the reward is only available from one game. `isActive`
takes it out of circulation without deleting history.

`RewardIssue` is one coupon. It links a customer to a definition, carries a
unique `couponCode`, a `status`, an `expiresAt`, and the outlet and user that
redeemed it.

```text
  Customer ──1:n──▶ GamePlay ──n:1──▶ GameConfig
     │                                    │
     │                                    │ 1:n
     │ 1:n                                ▼
     └────────────▶ RewardIssue ──n:1──▶ RewardDefinition
                         │
                         └──▶ redeemedOutletId, redeemedById
```

### The RewardIssue state machine

```text
                    customer spends coins
                             │
                             ▼
                      ┌─────────────┐
                      │   ISSUED    │  couponCode generated
                      │             │  coinBalance decremented
                      └──┬───┬───┬──┘  REWARD_ISSUED event queued
                         │   │   │
     staff redeems it    │   │   │    expiry sweep, 04:30 IST
     at the counter      │   │   │    expiresAt has passed
      ┌──────────────────┘   │   └──────────────────┐
      │                      │                      │
      ▼                      ▼                      ▼
┌───────────┐          ┌───────────┐          ┌───────────┐
│ REDEEMED  │          │  VOIDED   │          │  EXPIRED  │
│ terminal  │          │ terminal  │          │ terminal  │
└───────────┘          └───────────┘          └───────────┘
  redeemedAt             manager or             no coin
  redeemedOutletId       fraud response,        refund
  redeemedById           coins refunded
```

All three end states are terminal. There is no un-redeem. A coupon redeemed in
error is handled by issuing a new one, not by rewinding the old one, because a
reversible redemption is a free meal for anyone who can talk a cashier into it.
`VOIDED` refunds coins because it is an administrative action; `EXPIRED` does
not, because the customer had thirty days.

Every transition writes an `AuditLog` row.

## Guest versus identified customer

This is open question 7, and the answer is in Q7 of
[chapter 04](04-decisions-register.md).

A guest plays with an anonymous `sessionKey`, gets a score, sees it on the
leaderboard for that session, and earns nothing. Coins and rewards require a
phone number verified by a one-time code.

The line sits there because a reward has real cash value. A coupon is handed to
a cashier who gives away food. If coins accrued to anonymous sessions, anyone
could clear their browser storage, play again, and accumulate a balance with no
identity attached to it, and there would be no way to redeem that balance at a
counter anyway because there is nothing to look the customer up by. An
unverified identity makes abuse trivial and redemption impossible at the same
time.

What it costs is real and worth naming. A verification step in the funnel loses
players. Someone who enjoyed the game and would happily have collected coins now
has to type a phone number, wait for a code, and type that. A meaningful share
will not. The mitigation is placement: the game does not ask for a phone number
before play. It asks after the score is on screen and the coin total is showing
as "sign in to keep 24 coins", which is the moment the player has something to
lose.

## The public API

These six endpoints are the only part of the system exposed to the open
internet, so they get the most care. They live in
`apps/api/src/modules/crm/public-crm.controller.ts` under `/api/v1/public`. None
of them uses `JwtAuthGuard`. All of them are behind the Redis rate limiter.

### GET /public/game/:slug/config

Returns the published configuration and issues a session token.

```json
{
  "slug": "momo-catch",
  "version": 7,
  "rules": {
    "maxScore": 5000,
    "coinsPerPoint": 0.01,
    "coinRounding": "floor",
    "maxCoinsPerPlay": 25,
    "cooldownSeconds": 300,
    "display": { "title": "Catch the momo", "instructions": "..." }
  },
  "sessionToken": "eyJhbGciOiJIUzI1NiJ9...",
  "sessionExpiresIn": 1800
}
```

The response deliberately omits the server side abuse limits. `maxScore` has to
ship because the client uses it to normalise its own display, but
`maxCoinsPerCustomerPerDay` and `playsPerSessionKeyPerDay` are not sent, because
telling an attacker exactly where the ceiling sits saves them the trouble of
finding it.

`sessionToken` is a short JWT signed with a key separate from the staff auth
key, with an audience of `game-session`, a 30 minute expiry, and a random `jti`.
That `jti` is what lands in `GamePlay.sessionKey`. Returns `404 NOT_FOUND` for
an unknown slug and `404 GAME_NOT_PUBLISHED` for a slug that exists but is not
published, so an unpublished game cannot be discovered by probing.

Rate limit: 60 per IP per minute.

### POST /public/game/:slug/play

Submits a score.

```ts
export const submitPlaySchema = z.object({
  sessionToken: z.string().min(20).max(2048),
  score:        z.number().int().nonnegative(),
  durationMs:   z.number().int().positive().max(3_600_000),
}).strict();
```

Success, `201 Created`:

```json
{
  "score": 2400,
  "coinsEarned": 24,
  "coinsCredited": false,
  "coinBalance": null,
  "message": "Verify your phone to keep these coins"
}
```

`coinsCredited` is false and `coinBalance` is null for a guest. With a customer
token in the `Authorization` header, `coinsEarned` is credited, `coinsCredited`
is true and `coinBalance` carries the new total.

| Code | HTTP | Fires when |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Schema failure, negative or non-integer score |
| `SESSION_INVALID` | 401 | Token signature bad, expired, or issued for a different slug |
| `GAME_NOT_PUBLISHED` | 404 | The game was unpublished after the session was issued |
| `SCORE_OUT_OF_RANGE` | 422 | `score` exceeds `rulesJson.maxScore` |
| `PLAY_COOLDOWN_ACTIVE` | 429 | Another play from this session inside `cooldownSeconds` |
| `COIN_CAP_REACHED` | 200 | Not an error. Play is recorded with `coinsEarned` of 0 and a `capReached` flag |

The coin cap returns a success rather than a failure on purpose. The play
happened and the score is real; the player simply stops earning. Returning 429
there would make the game look broken to someone who was enjoying it.

### POST /public/customer/verify/start

Body is `{ "phone": "+919876543210" }`, E.164 only. The server generates a six
digit code, stores `sha256(code)` in Redis under `crm:otp:{sha256(phone)}` with
a 300 second TTL and an attempt counter, and sends the code over the WhatsApp
Cloud API. There is no OTP table. A one-time code that outlives its TTL is a
liability, and Redis expiry is the cheapest correct implementation.

Response is always `202 Accepted` with `{ "expiresIn": 300 }`, whether or not
the phone number is already a customer. Returning different responses for known
and unknown numbers turns this endpoint into a customer list oracle.

Rate limits: 1 per phone per 60 seconds, 5 per phone per 24 hours, 20 per IP per
hour. Exceeding any of them returns `429 OTP_THROTTLED`.

### POST /public/customer/verify/confirm

Body is `{ "phone": "...", "code": "482913", "consent": true }`.

On success the server upserts the `Customer` row, sets `consentAt` if it is
null, deletes the Redis key, and returns a customer token: a JWT with an
audience of `customer`, a 30 day expiry, and the customer id as subject. The
game site stores it and sends it as a bearer token on the remaining endpoints.

| Code | HTTP | Fires when |
|---|---|---|
| `OTP_INVALID` | 401 | Code does not match. Attempt counter incremented |
| `OTP_EXPIRED` | 401 | No Redis key. Also returned after 5 failed attempts, which delete the key |
| `CONSENT_REQUIRED` | 422 | `consent` is not true |

Five wrong attempts destroy the code. A six digit code with unlimited attempts
is a four minute brute force.

### POST /public/rewards/redeem

The customer spends coins and receives a coupon. Requires a customer token.

Body is `{ "definitionId": "..." }`. Inside one transaction the service locks
the `Customer` row, checks `coinBalance >= definition.coinCost`, decrements the
balance, inserts a `RewardIssue` in `ISSUED` with a generated `couponCode` and
`expiresAt` set from `rulesJson.couponValidityDays`, inserts an `AuditLog` row,
and inserts an `OutboxEvent` with `eventKey` of `REWARD_ISSUED`.

```json
{
  "couponCode": "BM-7K4QX2M9TR",
  "rewardName": "One free plate of steamed momo",
  "expiresAt": "2026-09-24T18:29:59.000Z",
  "coinBalance": 12
}
```

| Code | HTTP | Fires when |
|---|---|---|
| `CUSTOMER_TOKEN_INVALID` | 401 | Missing, expired or wrong audience |
| `NOT_FOUND` | 404 | Unknown or inactive `definitionId` |
| `INSUFFICIENT_COINS` | 422 | Balance below `coinCost`. `details` carries both numbers |

The row lock is the whole correctness argument. Two concurrent redemptions from
two tabs must not both pass the balance check. `SELECT ... FOR UPDATE` on the
customer row, inside the transaction, before reading the balance.

Naming note, because it will confuse someone: this endpoint is the customer
redeeming coins for a coupon. The staff endpoint further down is the counter
redeeming the coupon for food. Two different verbs, same English word.

### GET /public/customer/me

Requires a customer token. Returns the coin balance, the last 10 plays, and
every coupon that is still `ISSUED` with its code and expiry. This is the
customer's wallet screen. It returns nothing about outlets, staff or the
business.

## Abuse controls

This is open question 6, resolved to what three weeks can actually deliver.
Q6 in [chapter 04](04-decisions-register.md) records the decision.

| Control | Where | Setting |
|---|---|---|
| IP rate limit | Redis, per endpoint | 60/min on config, 20/min on play, 20/hour on OTP start |
| Session key rate limit | Redis, keyed on `jti` | One play per `cooldownSeconds`, default 300 |
| Plays per session key per day | Redis counter, 24 hour TTL | `rulesJson.playsPerSessionKeyPerDay`, default 10 |
| Score ceiling | Server, from `rulesJson.maxScore` | Score above it is rejected outright, not clamped |
| Coins per play | Server, from `rulesJson.maxCoinsPerPlay` | Caps the award regardless of score |
| Coins per customer per day | Redis counter, IST calendar day | `rulesJson.maxCoinsPerCustomerPerDay`, default 60 |
| OTP attempts | Redis counter | 5 wrong codes destroy the key |
| Coupon codes | `crypto.randomBytes`, Crockford base32 | 10 characters, about 50 bits, unique index, single use |
| Audit | `AuditLog` | Every issue, every redemption, every void |

The score ceiling is the important one and it is worth being precise about why
it is a rejection rather than a clamp. The ceiling is server authoritative and
lives in `rulesJson`, which the client cannot change. A submitted score above
`maxScore` is impossible under honest play, so it is evidence of tampering, and
the right response to evidence of tampering is a 422 and a log line, not a
silently corrected score that lets the attacker keep probing until they find the
edge.

Coupon codes use `crypto.randomBytes(7)` encoded as Crockford base32, which
drops the ambiguous characters I, L, O and U so a code read aloud across a
counter does not turn into a support call. Roughly 50 bits of entropy makes
guessing a valid code hopeless, and the unique index on `couponCode` catches the
astronomically unlikely collision with a retry.

### What is not done

There is no device fingerprinting. There is no behavioural analysis of play
patterns. There is no signed replay of the game session, so the server cannot
verify that a submitted score was actually earned by playing. A determined
attacker who reads the JavaScript can call `POST /public/game/:slug/play`
directly with a plausible score, verify a phone number they control, and farm
coins up to the daily cap.

The controls raise the cost of that from trivial to tedious. They do not make it
impossible, and no set of controls that fits in this budget would.

The business recommendation follows directly: keep Phase 1 reward values small.
A free soft drink or a ten percent discount is worth the engagement and survives
a handful of people gaming it. A free meal is not. Set `coinCost` high enough
that the daily coin cap means several days of honest play per coupon, and revisit
the values after a month of real redemption data. The SRS already lists advanced
fraud detection under Future Scope, which is the right place for it.

## The staff side

One screen at the counter. A text field, a lookup, and a confirm button.

`GET /crm/rewards/:couponCode` requires `crm.reward.read` and returns the
coupon's status, the reward name, the customer's masked phone (`+91 98xxxx3210`)
and the expiry, so the cashier can see what they are about to give away before
committing.

`POST /crm/rewards/:couponCode/redeem` requires `crm.reward.redeem`. It sets
`status` to `REDEEMED`, stamps `redeemedAt`, `redeemedOutletId` from the
caller's outlet scope and `redeemedById` from the JWT, and writes an `AuditLog`
row. The transition is conditional in SQL, updating only where `status` is
`ISSUED`, so two cashiers scanning the same code at the same moment produce one
redemption and one `COUPON_ALREADY_REDEEMED`.

| Code | HTTP | Fires when |
|---|---|---|
| `COUPON_NOT_FOUND` | 404 | No such code. Rate limited to 20 lookups per user per minute to stop code guessing from inside |
| `COUPON_ALREADY_REDEEMED` | 409 | `details` carries the outlet and timestamp of the first redemption |
| `COUPON_EXPIRED` | 422 | `expiresAt` has passed |
| `COUPON_VOIDED` | 422 | A manager voided it |

The response shows which outlet redeemed it and when, because the most common
real dispute is a customer at Patia insisting the coupon is unused when it was
redeemed at Saheed an hour earlier.

## The admin side

Game configuration is `GET /crm/games`, `POST /crm/games`,
`PATCH /crm/games/:id` and `POST /crm/games/:id/publish`, with permission keys
`crm.game.read`, `crm.game.create`, `crm.game.update` and `crm.game.publish`.
The publish key is already named in this handbook.

`rulesJson` is validated by a zod schema on every write, so a malformed rule set
cannot reach the database and break the public config endpoint:

```json
{
  "maxScore": 5000,
  "coinsPerPoint": 0.01,
  "coinRounding": "floor",
  "maxCoinsPerPlay": 25,
  "maxCoinsPerCustomerPerDay": 60,
  "cooldownSeconds": 300,
  "playsPerSessionKeyPerDay": 10,
  "couponValidityDays": 30,
  "display": {
    "title": "Catch the momo",
    "instructions": "Tap the momo before it reaches the steamer.",
    "themeColor": "#B71C1C"
  }
}
```

Coins are computed as
`min(floor(score * coinsPerPoint), maxCoinsPerPlay)`, with `coinRounding`
selecting between `floor` and `round`. `floor` is the default because a rule
that rounds up gives a coin for a score of zero.

`PATCH` edits a draft or a published game without affecting what the public
endpoint serves. `POST /crm/games/:id/publish` is the only thing that changes
the live game. It sets `isPublished` true, stamps `publishedAt`, increments
`version`, writes an `AuditLog` row, and deletes the Redis key
`crm:game:config:{slug}`. [Chapter 25](25-caching-and-performance.md) owns the cache policy; the relevant part
here is that the config cache has a 600 second TTL and an explicit invalidation
on publish, because a manager who changes a reward rule and then watches the
website for ten minutes to see if it took will file a bug.

Versioning is deliberately shallow. `version` is a counter, not a history table.
The system can tell you which version awarded a play's coins but not what that
version contained. Storing rule set history would be a `GameConfigVersion` table
and a diff view, which is a week 3 luxury. The mitigation is the `AuditLog` row
on publish, which carries the full `before` and `after` `rulesJson`, so the
history exists in the audit trail even though there is no screen for it.

`RewardDefinition` CRUD sits behind `crm.reward.define` and is a plain master
data screen.

## Consent and data protection

A phone number is personal data. It is the only personal data this system holds
about anyone who is not an employee, and it is collected from members of the
public over the open internet, which makes it the most sensitive collection
point in the product.

`consentAt` is stamped once, on the first successful
`POST /public/customer/verify/confirm`, and never cleared by anything except a
deletion request. The confirm endpoint requires `consent: true` in the body and
rejects the call with `422 CONSENT_REQUIRED` without it. A pre-ticked box on the
game site is not consent, and the checkbox ships unticked.

The text next to that checkbox, which is what the customer is actually agreeing
to:

> I agree to Bob's Momo storing my phone number to hold my game coins and send
> me reward coupons on WhatsApp. I can ask for my number to be deleted at any
> time by messaging the same number.

Three things are named in that sentence: what is stored, what it is used for,
and how to get out. Nothing else is collected. The game does not ask for a name,
an email, a birthday or a location, because the ERP has no use for any of it and
every field collected is a field that has to be protected.

WhatsApp opt-in is not separate from this consent, and that is a deliberate
simplification worth stating: `REWARD_ISSUED` is the only message this system
sends to a customer, it is transactional, and it goes only to someone who just
spent coins on a coupon. If marketing messages are ever added, they need their
own opt-in and their own flag, and that is Phase 2 work.

Deletion requests arrive by WhatsApp or in person and are handled by the Owner
through a support path rather than a self-service screen, because at two outlets
the volume does not justify building one. The handling is defined:

| Data | On deletion |
|---|---|
| `Customer.phone` | Replaced with a tombstone value, `deleted-{uuid}` |
| `Customer.name`, `consentAt` | Nulled |
| `GamePlay.customerId` | Nulled. The play row survives so play counts stay correct |
| `RewardIssue` | Retained with `customerId` intact if redeemed, because it is a record of a transaction at an outlet |
| `AuditLog` | Retained. It is append only and it is the record of what was done |

The rule underneath that table is that aggregate history survives and identity
does not. Deleting a customer must not silently change last month's play count.
The target for completion is 30 days from the request, and the deletion itself
writes an `AuditLog` row.

## Failure modes

| What goes wrong | How it shows up | What to do |
|---|---|---|
| Attacker posts scores directly to the play endpoint | Coin issuance rises without matching web traffic | Score ceiling caps each play, daily coin cap caps the day. Watch `GET /analytics/crm` for a plays-to-customers ratio that stops looking human |
| Two tabs redeem coins at once | Balance could go negative | Cannot: `SELECT ... FOR UPDATE` on the customer row inside the transaction. Test 11 covers it |
| Two cashiers redeem one coupon | Free meal given twice | Cannot: the update is conditional on `status = 'ISSUED'`. Second call gets `COUPON_ALREADY_REDEEMED` |
| WhatsApp OTP delivery fails | Customers cannot verify, funnel dies silently | The verify start response is always 202, so failures are invisible to the caller. Alert on WhatsApp send failures for the OTP template specifically, not just in aggregate |
| Manager unpublishes a game mid-session | Live players get errors | `POST /public/game/:slug/play` returns `GAME_NOT_PUBLISHED`. The game site shows "this game has ended" rather than a crash |
| Config cache not invalidated on publish | Rule change appears not to work | Publish deletes the Redis key inside the same operation. Test 16 asserts the key is gone |
| Coupon code collision | Unique constraint violation on insert | Retry once with a new code, then fail. At 50 bits this will not happen |
| Customer token leaked from a shared phone | Someone else spends the coins | Accepted risk. Balances are small by design. Token expiry is 30 days and there is no session revocation screen in Phase 1 |
| Reward values set too high | Coordinated farming becomes worth someone's time | A business control, not a technical one. See the recommendation above |

## Test plan

`apps/api/test/crm-public.e2e-spec.ts` and `crm-staff.e2e-spec.ts`.

| # | Case | Expected |
|---|---|---|
| 1 | `GET /public/game/:slug/config` for a published game | 200, `rules` present, `sessionToken` set, no `maxCoinsPerCustomerPerDay` in the body |
| 2 | Same for an unpublished game | 404 `GAME_NOT_PUBLISHED` |
| 3 | Same for an unknown slug | 404 `NOT_FOUND`, identical shape to case 2 |
| 4 | Play with a valid session and score 2400, `coinsPerPoint` 0.01 | 201, `coinsEarned` 24, `coinsCredited` false |
| 5 | Play with score 9999 against `maxScore` 5000 | 422 `SCORE_OUT_OF_RANGE`, no `GamePlay` row written |
| 6 | Play with a score of 999999 and `maxCoinsPerPlay` 25 | Rejected by the ceiling before the cap is reached |
| 7 | Two plays on one session inside `cooldownSeconds` | Second call 429 `PLAY_COOLDOWN_ACTIVE` |
| 8 | Play with a session token issued for a different slug | 401 `SESSION_INVALID` |
| 9 | Play with a staff access token as the bearer | 401 `CUSTOMER_TOKEN_INVALID`. Audience separation holds |
| 10 | Verify start for a known and an unknown phone | Byte-identical 202 responses |
| 11 | Verify confirm with `consent` omitted | 422 `CONSENT_REQUIRED`, no `Customer` row created |
| 12 | Six wrong OTP codes | Sixth returns `OTP_EXPIRED`, Redis key gone after the fifth |
| 13 | Verify confirm twice for the same phone | One `Customer` row, `consentAt` unchanged on the second |
| 14 | Two concurrent `POST /public/rewards/redeem` with exactly enough coins for one | One 201, one 422 `INSUFFICIENT_COINS`, balance never negative |
| 15 | Redeem a coupon at the counter | `REDEEMED`, `redeemedOutletId` matches the caller's outlet, `AuditLog` row written |
| 16 | Two concurrent staff redemptions of one code | One 200, one 409 `COUPON_ALREADY_REDEEMED` naming the first outlet |
| 17 | Redeem an expired coupon | 422 `COUPON_EXPIRED`, status unchanged |
| 18 | Redeem as a role without `crm.reward.redeem` | 403 `FORBIDDEN` |
| 19 | Publish a game | `version` incremented, `publishedAt` set, Redis key `crm:game:config:{slug}` absent |
| 20 | `GET /public/game/:slug/config` immediately after publish | New `version` in the body, no stale cache |
| 21 | Coin cap reached, then another play | 200 with `coinsEarned` 0 and `capReached` true, `GamePlay` row still written |
| 22 | Deletion request on a customer with 4 plays and 1 redeemed coupon | Phone tombstoned, `GamePlay.customerId` null, play count in `GET /analytics/crm` unchanged |
| 23 | 25 OTP starts from one IP in an hour | 429 `OTP_THROTTLED` |
| 24 | `GET /public/customer/me` with no token | 401 `CUSTOMER_TOKEN_INVALID` |

Cases 14 and 16 are the two that matter most. Both are money. Both must run as
real concurrent HTTP calls against a real database, because a mocked repository
will pass a test that production fails.

## If this is deferred

If the client agrees to move the customer CRM and game layer to Phase 2, this is
the exact cut. Making the list now means the deferral is a clean removal on day
one of week 3 rather than a scramble on day three.

| Artefact | What drops |
|---|---|
| Prisma models | `Customer`, `GameConfig`, `GamePlay`, `RewardDefinition`, `RewardIssue` |
| Enums | `RewardStatus` |
| Backend module | The whole of `apps/api/src/modules/crm/` |
| Public endpoints | All six under `/api/v1/public` |
| Staff endpoints | `GET /crm/rewards/:couponCode`, `POST /crm/rewards/:couponCode/redeem` |
| Admin endpoints | Game CRUD, publish, `RewardDefinition` CRUD |
| Permission keys | `crm.customer.read`, `crm.game.read`, `crm.game.create`, `crm.game.update`, `crm.game.publish`, `crm.reward.define`, `crm.reward.read`, `crm.reward.redeem`, `crm.report.read` |
| Event keys | `REWARD_ISSUED` drops from the notification table and the WhatsApp template list |
| Analytics | Report 4 and `GET /analytics/crm` in [chapter 31](31-analytics-and-reporting.md), plus tile 9 on the owner dashboard |
| Cache keys | `crm:game:config:{slug}`, `crm:otp:*`, the game rate limit keys |
| Jobs | The coupon expiry sweep at 04:30 IST |
| Screens | The game config admin screen, the reward catalogue screen, the counter redemption screen, the customer wallet page on the website |
| Acceptance criteria | Criterion 3 loses the words "and game/reward workflows" |
| Traceability matrix | The Customer Game / Reward Trends row |
| Timeline | Week 3 loses "Customer/game CRM, game configuration/publishing, rewards" |

Two things do not drop. The website game keeps running exactly as it does today,
because the ERP was never going to build it. And the AS-IS problem the SRS
identified, that scores and coins and rewards are not connected to management
visibility, remains unsolved and should be written into the Phase 2 scope in the
same document that defers it.

The deferral has to be in writing and signed by both parties, in the same way as
the sign-off in the SRS, because acceptance criterion 3 and the week 3 plan
currently commit this work. A verbal agreement to drop it leaves an unmet
acceptance criterion in a document both sides signed.
