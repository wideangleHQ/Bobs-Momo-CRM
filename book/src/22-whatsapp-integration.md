# WhatsApp integration

This is the only part of Phase 1 that depends on an approval process the team
does not control. The SRS classifies WhatsApp Business API as third-party
dependent functionality, subject to provider approval, availability and usage
pricing, and it puts the usage cost outside the fixed infrastructure budget.
Meta decides whether the business account is verified, whether each message
template is approved, and how fast. None of that is on the three week
schedule's critical path unless you let it be.

So the design rule is stated once and enforced everywhere: with
`WHATSAPP_ENABLED=false` the product is complete. Every notification still
fires, every recipient still resolves, every in-app inbox still fills, every
test still passes. WhatsApp adds a second delivery channel to a pipeline that
already works. If Meta approves nothing by the UAT date, the client gets a
working system and turning the flag on later is a deploy, not a project.

Everything below is about the channel. The engine it plugs into is in
[Notification engine](21-notification-engine.md).

## How the Cloud API actually works

If you have never used it, the model is five nouns and one rule.

A Meta Business account is the company identity, and it needs business
verification (a certificate of incorporation, a utility bill, a matching
website) before message volume rises above the unverified tier. A WhatsApp
Business Account, the WABA, hangs off it and owns phone numbers and templates.
A phone number id identifies the sending number: it is not the phone number
itself, it is an opaque numeric id you get from the dashboard, and it is what
goes in the request URL. A system user access token is the credential. Generate
it against a system user, not your personal login, and give it the
`whatsapp_business_messaging` and `whatsapp_business_management` scopes. A
token generated from a personal login expires when that person's session does,
which is a bad way to discover the difference on a Sunday.

The rule that shapes the whole design: outside a 24 hour customer service
window, you may only send pre-approved message templates.

The window opens when a user messages your business number and stays open for
24 hours. Inside it you can send free-form text. Outside it, free-form text is
rejected with error 131047, and only a template send is accepted.

Bob's Momo staff will never message the ERP's number. There is nothing to say
to it. So the window is closed, always, for every recipient, and every message
this system sends is a template send. That single fact means:

- No message copy can be written at runtime. Every sentence a manager receives
  on WhatsApp is fixed at template approval time, with only numbered variables
  filled in.
- The `Notification.body` text and the WhatsApp text are different strings. The
  in-app body is free-form and can be as long and specific as it needs to be.
  The WhatsApp text is whatever Meta approved.
- Adding a new notification event that needs WhatsApp is a two step change:
  code, plus a template submission with its own review latency.

There is one asymmetry worth knowing. `REWARD_ISSUED` goes to a customer, and a
customer who has just played a game on the website may well message the
business number. That does not change the design, because the system cannot
know whether a window is open without tracking inbound messages, and it does
not. Everything is a template send.

## The templates this system needs

Eleven templates, one per WhatsApp-enabled event key in the event table in chapter 21.
All of them are category UTILITY.

Category matters twice. For approval: a UTILITY template must relate to an
existing transaction or an account the recipient has with you, which is exactly
what these are, and Meta reviews them against that standard. A template that
reads like promotion gets reclassified as MARKETING, and MARKETING templates to
users who have not opted in get blocked or flagged. For pricing: UTILITY is the
cheapest paid category in India and service messages inside an open window are
free, while MARKETING is several times the price. Getting `low_stock_alert`
classified as MARKETING would be both a delivery problem and a bill.

Meta rejects vague templates. A body that is mostly variables, or that reads
like a generic notice, comes back as "content is too generic" or "variable
parameters missing example values". Write short, specific, concrete copy where
a reader can tell what happened from the fixed words alone.

| Template name | Event key | Body | Variables |
|---|---|---|---|
| `low_stock_alert` | `LOW_STOCK` | `Stock alert. {{1}} at {{2}} is down to {{3}}. Reorder level is {{4}}. Open the ERP to raise a purchase request.` | 1 item name, 2 outlet name, 3 qty with unit, 4 reorder level with unit |
| `task_assigned` | `TASK_ASSIGNED` | `New task for you at {{2}}: {{1}}. Due by {{3}}. Mark it complete in the ERP when done.` | 1 task title, 2 outlet name, 3 due time IST |
| `task_overdue` | `TASK_OVERDUE` | `Task overdue at {{2}}: {{1}}. It was due at {{3}} and is still open. Assigned to {{4}}.` | 1 task title, 2 outlet, 3 due time, 4 assignee name |
| `leave_requested` | `LEAVE_REQUESTED` | `{{1}} has requested {{2}} leave from {{3}} to {{4}}. Reason: {{5}}. Approve or reject in the ERP.` | 1 employee name, 2 leave type, 3 from date, 4 to date, 5 reason |
| `leave_decision` | `LEAVE_DECIDED` | `Your leave request from {{2}} to {{3}} has been {{1}} by {{4}}. Check the ERP for details.` | 1 approved or rejected, 2 from date, 3 to date, 4 decider name |
| `purchase_requested` | `PURCHASE_REQUESTED` | `Purchase request {{1}} raised by {{2}} for {{3}}. {{4}} items, needed by {{5}}. Approve or reject in the ERP.` | 1 request no, 2 requester, 3 outlet, 4 line count, 5 needed-by date |
| `audit_item_failed` | `AUDIT_ITEM_FAILED` | `Audit failure at {{1}}. Checklist "{{2}}" item "{{3}}" was marked FAIL by {{4}}. A follow-up task has been created.` | 1 outlet, 2 checklist name, 3 item label, 4 recorded by |
| `sales_entry_missing` | `SALES_ENTRY_MISSING` | `No sales entry recorded for {{1}} on {{2}}. Please enter today's sales figures in the ERP before closing.` | 1 outlet name, 2 business date |
| `broadcast_message` | `BROADCAST` | `Message from {{1}} to {{2}}: {{3}}` | 1 sender name, 2 scope label, 3 message body |
| `reward_issued` | `REWARD_ISSUED` | `Thanks for playing at Bob's Momo. Your reward: {{1}}. Use code {{2}} at any outlet before {{3}}.` | 1 reward name, 2 coupon code, 3 expiry date |
| `operational_alert` | `OPERATIONAL_ALERT` | `Operational alert from {{1}} at {{2}}: {{3}}. Please action this now.` | 1 raised by, 2 outlet, 3 alert text |

Two notes on the copy. Every body names the thing that happened in fixed text,
so a template with all variables blank still reads as a sentence. And every
staff-facing body ends by telling the reader what to do, because these messages
arrive on a phone that already has 200 unread WhatsApp threads.

Templates take a language code. All eleven are submitted as `en` (or `en_GB`,
pick one and keep it consistent, because the language code is part of the send
payload and a mismatch is error 132001, template not found).

## Approval, and why it goes in week 1

Submission is through the WhatsApp Manager UI or the management API. For each
template you supply the name, category, language, body with `{{n}}`
placeholders, and an example value for every placeholder. The example values
are not optional and templates get rejected for missing them.

Review is automated for most templates and takes minutes to a few hours. It can
take up to 24 hours, and a rejected template that you edit and resubmit starts
the clock again. Business verification, which is a separate process, is the one
that can take days, because it involves a human reviewing documents.

Common rejections and the fix:

| Rejection reason | What triggers it | How to write around it |
|---|---|---|
| Content is too generic | Body is mostly `{{1}}` with no fixed context | Add fixed words naming the event, as every template above does |
| Variable formatting | A variable at the very start or very end of the body, or two adjacent variables | Put fixed text at both ends, separate variables with words |
| Incorrect category | UTILITY body that reads as promotion | Remove offers, discounts and calls to buy from staff templates |
| Missing sample values | Placeholders submitted with no examples | Fill every example field with a realistic value |
| Policy violation | Requesting sensitive data, or a URL that does not match the business | Never ask for a password or payment detail in a template |

The scheduling point. Templates cannot be submitted until the WABA exists, the
WABA cannot exist until the Meta Business account exists, and the business
account cannot pass verification until the client supplies documents. Every one
of those steps is waiting on somebody who is not on the development team. In a
three week build the schedule risk is not writing the adapter, which is a day.
It is the eight days of waiting that only start when somebody uploads a
certificate of incorporation.

So: create the business account and submit all eleven templates in week 1, on
day one or two, with placeholder copy if the final wording is not settled. A
template can be edited after approval and re-reviewed. What cannot be
compressed is the initial verification queue. Doing this in week 3 alongside
UAT is how a project ships with WhatsApp disabled and a client who expected it.

## The adapter

One interface, two implementations, one factory. The whole surface is a single
method, because a template send is the only thing this system ever does.

```ts
// modules/whatsapp/whatsapp.types.ts
export interface WhatsAppSendResult {
  providerRef: string;       // wamid.HBgM... or "stub:<uuid>"
  accepted: boolean;
}

export interface WhatsAppProvider {
  send(
    to: string,              // E.164, with the leading +
    templateName: string,
    variables: string[],
  ): Promise<WhatsAppSendResult>;
}
```

The real implementation:

```ts
@Injectable()
export class MetaCloudWhatsAppService implements WhatsAppProvider {
  private readonly url: string;

  constructor(private readonly cfg: ConfigService) {
    this.url =
      `https://graph.facebook.com/v21.0/` +
      `${cfg.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`;
  }

  async send(to: string, templateName: string, variables: string[]) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.get('WHATSAPP_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: variables.map((v) => ({ type: 'text', text: v })),
            },
          ],
        },
      }),
    });

    const json = await res.json();
    if (!res.ok) throw new WhatsAppError(res.status, json?.error);
    return { providerRef: json.messages[0].id, accepted: true };
  }
}
```

The null implementation:

```ts
@Injectable()
export class NullWhatsAppService implements WhatsAppProvider {
  private readonly log = new Logger('WhatsApp(stub)');

  async send(to: string, templateName: string, variables: string[]) {
    this.log.log(
      `[stub] would send ${templateName} to ${maskPhone(to)} ` +
        `vars=${JSON.stringify(variables)}`,
    );
    return { providerRef: `stub:${randomUUID()}`, accepted: true };
  }
}
```

Wiring, in `whatsapp.module.ts`:

```ts
{
  provide: WHATSAPP_PROVIDER,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) =>
    cfg.get('WHATSAPP_ENABLED') === 'true'
      ? new MetaCloudWhatsAppService(cfg)
      : new NullWhatsAppService(),
}
```

The dispatcher injects `WHATSAPP_PROVIDER` and never checks the flag itself.
That is the whole point of the null implementation: there is no `if
(whatsappEnabled)` scattered through the notification code, so the enabled and
disabled paths are the same code path and the tests cover both.

The interface exists for a second reason. Indian aggregators (Gupshup,
Interakt, AiSensy and others) resell the same Cloud API with a different
request shape and their own template management. If the client already has an
aggregator relationship, or if direct Meta onboarding stalls, swapping in a
third implementation of `WhatsAppProvider` is a file and a factory branch. That
is the one abstraction in this module that earns its keep, because the
probability of needing it is real rather than hypothetical.

Environment variables:

```bash
WHATSAPP_ENABLED=false
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
```

## Phone numbers

Meta accepts a number in E.164 without the plus sign. Everything else is
rejected or, worse, silently delivered to the wrong country.

`Employee.phone` is typed by an HR user in a text box. In Odisha that means it
arrives as `9876543210`, `09876543210`, `+91 98765 43210`, `91-9876543210` or
`+919876543210`, all describing the same handset. Normalisation runs on write
and on read, and the stored format is E.164 with the plus: `+919876543210`.

```ts
export function toE164India(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');          // drop +, spaces, dashes

  // 10 digits, valid Indian mobile prefix
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;

  // 11 digits with a trunk 0
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;

  // 12 digits already carrying the country code
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;

  // 13 with 00 international prefix
  if (/^0091[6-9]\d{9}$/.test(digits)) return `+${digits.slice(2)}`;

  return null;
}
```

Indian mobile numbers are ten digits starting with 6, 7, 8 or 9. A landline or
a mistyped number fails all four branches and returns null.

Two rules follow. The employee create and update endpoints run
`toE164India` and return 400 with `INVALID_PHONE_NUMBER` if it returns null, so
a bad number is caught by the person typing it rather than by a failed send
three days later. And a number that fails normalisation is never sent to the
API. The dispatcher checks before calling `send`, and a null result means the
WhatsApp channel is skipped for that recipient with the `Notification` row
written as `SUPPRESSED` and `failReason = 'INVALID_PHONE'`. The in-app
notification is unaffected.

`Customer.phone` is collected by the game layer and normalised the same way at
the point of capture, because a coin balance attached to an unreachable number
is a support ticket waiting to happen.

`maskPhone` in logs prints `+9198765***10`. Full phone numbers do not go in
application logs.

## Delivery status webhooks

Meta posts delivery receipts to a public endpoint. It is the only unauthenticated
route in the API, so it verifies Meta's signature instead of a JWT.

The verification handshake happens once, when you register the callback URL in
the app dashboard. Meta issues a GET:

```text
GET /api/v1/whatsapp/webhook
    ?hub.mode=subscribe
    &hub.verify_token=<the string you configured>
    &hub.challenge=1158201444
```

The handler compares `hub.verify_token` against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
with a timing-safe compare and, on a match, returns `hub.challenge` as a plain
text 200. Anything else is a 403. The verify token is a random string you
choose, not a Meta credential.

Every subsequent POST carries `X-Hub-Signature-256: sha256=<hex>`, which is
HMAC-SHA256 of the raw request body keyed by the app secret. The raw body is
required, so this route is registered with the JSON body parser disabled and
reads the buffer itself. Parsing then re-serialising changes whitespace and
breaks the signature.

```ts
@Post('webhook')
@Public()
async receive(@Req() req: RawBodyRequest<Request>) {
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  const expected =
    'sha256=' +
    createHmac('sha256', this.cfg.get('WHATSAPP_APP_SECRET')!)
      .update(req.rawBody!)
      .digest('hex');

  if (!sig || !timingSafeEqualStr(sig, expected)) {
    throw new UnauthorizedException();      // 401, no body
  }

  await this.svc.applyStatuses(JSON.parse(req.rawBody!.toString()));
  return { received: true };                // 200 fast, always
}
```

The body contains a `statuses` array. Each entry has the message id, a status
string and a timestamp. Mapping onto `NotificationStatus`:

| Meta status | NotificationStatus | Notes |
|---|---|---|
| `sent` | `SENT` | accepted by Meta, handed to WhatsApp |
| `delivered` | `DELIVERED` | reached the handset |
| `read` | `DELIVERED` | the enum has no READ state, the raw value is kept in `payload.metaStatus` |
| `failed` | `FAILED` | `failReason` gets the Meta error code and title |

The update is a single query keyed on `providerRef`:

```sql
UPDATE "Notification"
SET    status = $1,
       payload = jsonb_set(coalesce(payload,'{}'), '{metaStatus}', to_jsonb($2::text))
WHERE  "providerRef" = $3
  AND  $4 > CASE status
              WHEN 'QUEUED' THEN 0 WHEN 'SENT' THEN 1
              WHEN 'DELIVERED' THEN 2 ELSE 3 END;
```

That rank comparison is the idempotency. Meta retries webhook deliveries for up
to 24 hours if your endpoint does not return 2xx quickly, and it does not
guarantee ordering, so `delivered` can arrive before `sent`. Status only ever
moves forward. A repeated `delivered` matches zero rows and is a no-op. An
out-of-order `sent` after `delivered` is discarded. An unknown `providerRef`,
which happens for messages sent by a previous deployment or a stub, matches
nothing and is ignored.

Return 200 before doing anything slow. If the handler takes longer than a few
seconds Meta treats it as a failure and retries, and the retries pile up. The
status update here is one indexed UPDATE, so it stays inline. Anything heavier
would go through the outbox.

## Rate limits, errors and cost

The Cloud API applies two separate limits. A throughput limit of 80 messages
per second on the default tier, which this system will never approach. And a
messaging limit on unique recipients per rolling 24 hours, which starts at 250
for an unverified business and rises to 1,000, then 10,000, then 100,000 as
quality and volume build. Bob's Momo has 30 staff. The 250 tier is enough
forever unless the customer reward channel grows, and the tier upgrade happens
automatically with sustained volume and a good quality rating.

Error handling splits into two classes, and getting this split wrong either
loses messages or hammers Meta.

Retry, through the normal outbox backoff:

| Condition | Meta signal |
|---|---|
| Rate limited | HTTP 429, or error code 131048 |
| Server error | HTTP 500, 502, 503 |
| Transient network failure | fetch throws, no response |
| Temporary send failure | error code 131026 with a retryable subtitle |

Do not retry, mark the `Notification` row `FAILED` and finish the outbox row as
DONE:

| Condition | Meta signal |
|---|---|
| Template does not exist or is not approved | 132001 |
| Template paused or disabled for quality | 132015, 132016 |
| Parameter count mismatch | 132000 |
| Invalid recipient number | 131026 with "not a WhatsApp user", or 1006 |
| Re-engagement required, window closed on a non-template send | 131047 |
| Token invalid or expired | 190 |

Error 190 is the awkward one. It is not retryable in the sense that retrying
will not fix it, but it is also not permanent: rotating the token fixes every
message that failed. Those go to the dead letter and get replayed after the
token is rotated, which is why the replay endpoint in the notification engine
exists.

```ts
function isRetryable(e: WhatsAppError): boolean {
  if (e.httpStatus === 429 || e.httpStatus >= 500) return true;
  return [131048, 131026].includes(e.code) && e.isTransient;
}
```

Cost. Meta prices UTILITY messages per message in India, and service messages
inside an open 24 hour window are free. At the time of writing an Indian
UTILITY message is in the region of Rs 0.12 to Rs 0.15. Verify the current rate
card before quoting it to the client, because Meta has changed this model twice
in two years.

The volume arithmetic for two outlets:

| Event | Messages per day |
|---|---|
| `LOW_STOCK` | 4 to 10, capped by the 12 hour cooldown per item |
| `TASK_ASSIGNED` | 20 to 40 |
| `TASK_OVERDUE` | 2 to 8 |
| `LEAVE_REQUESTED` and `LEAVE_DECIDED` | 2 to 4 |
| `PURCHASE_REQUESTED` | 2 to 6 |
| `AUDIT_ITEM_FAILED` | 0 to 4 |
| `SALES_ENTRY_MISSING` | 0 to 2 |
| `BROADCAST` | 0 to 30 on a day with one all-staff broadcast |
| `REWARD_ISSUED` | 0 to 20, depends entirely on game traffic |
| Total | 30 to 120, call it 75 average |

75 a day is about 2,300 a month. At Rs 0.15 that is roughly Rs 350 per month,
and doubling it for a bad month still lands under Rs 700. Against the SRS
target of under Rs 5,000 per month for infrastructure, WhatsApp is a rounding
error at this volume. Say this number to the client early. "Usage dependent,
quoted separately" reads like an open-ended bill, and the actual figure is
smaller than one month of Supabase.

The number that would change this is customer-facing volume. If the game layer
sends a reward message to 500 customers a month the total moves to Rs 1,100,
still fine. If somebody proposes a MARKETING campaign to a customer list, that
is a different category, a different price and a different opt-in requirement,
and it is not in Phase 1.

## Local and staging

Local development runs `WHATSAPP_ENABLED=false`. The stub logs the template
name, the masked recipient and the variables at info level, so a developer can
watch the full notification pipeline run end to end in the terminal without a
Meta account, without a token and without spending anything. Every integration
test in the repo runs against the stub.

To test the pipeline properly, assert on the stub. The test module provides a
recording variant that pushes each call into an array:

```ts
class RecordingWhatsAppService implements WhatsAppProvider {
  readonly sent: Array<{ to: string; template: string; vars: string[] }> = [];
  async send(to: string, template: string, vars: string[]) {
    this.sent.push({ to, template, vars });
    return { providerRef: `stub:${this.sent.length}`, accepted: true };
  }
}
```

A test can then assert that a low stock transaction produced exactly one
`low_stock_alert` to the Inventory Manager's number with four variables in the
right order. That covers everything except Meta's own behaviour.

Staging points at a real Meta test number if one is available. Meta gives every
new app a test phone number with a small free message allowance and up to five
verified recipient numbers, which is enough to confirm that templates render,
that variables land in the right slots, and that the webhook signature check
passes against real traffic. Add the developer's own number and the client's
number as recipients.

The one manual check worth doing by hand, once, before trusting the adapter:

```bash
curl -sS -X POST \
  "https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "919876543210",
    "type": "template",
    "template": {
      "name": "low_stock_alert",
      "language": { "code": "en" },
      "components": [{
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Chicken Mince" },
          { "type": "text", "text": "BM-SAHEED" },
          { "type": "text", "text": "1.800 KG" },
          { "type": "text", "text": "2.000 KG" }
        ]
      }]
    }
  }' | jq
```

A success returns `{"messages":[{"id":"wamid...."}]}`. Copy that `wamid` and
watch the webhook receive its `sent` then `delivered` statuses. That one round
trip proves the token, the phone number id, the template name, the language
code, the variable count and the webhook signature all at once, and it takes
two minutes. Do it on the day the first template is approved, not on UAT day.

## Failure modes

| Failure | How you notice | Effect | Response |
|---|---|---|---|
| Templates not approved by go-live | WhatsApp Manager shows PENDING or REJECTED | No WhatsApp at all | Ship with `WHATSAPP_ENABLED=false`, in-app notifications carry the product |
| Access token expired | Every send fails with error 190 | WhatsApp silent, in-app fine | Rotate the system user token, replay the dead letter |
| Template edited after approval and re-review pending | Sends fail with 132001 | One event key stops | Keep the old template name live until the new one is approved, never edit in place near a release |
| Recipient number not on WhatsApp | 131026 on that one send | One person misses one message | Row marked FAILED with reason, in-app unaffected, HR fixes the number |
| Messaging tier limit hit | 131048 on later sends of the day | Some messages delayed | Retry backoff spreads them, tier rises with volume |
| Webhook signature mismatch | 401s in the access log, statuses never advance | Delivery status stuck at SENT | Check `WHATSAPP_APP_SECRET`, check the raw body parser is disabled on that route |
| Webhook endpoint slow or down | Meta retries, statuses arrive in bursts | Stale status only, no message loss | Endpoint returns 200 before any slow work |
| Number typed wrong by HR | Message goes to a stranger | Business information leaks to an outsider | Normalisation plus prefix validation at entry, and no sensitive figures in template copy |
| Meta reclassifies a template as MARKETING | Higher bill, possible blocks | Cost and delivery | Keep every template transactional in wording, review the category after any copy change |

## Test plan

Unit:

1. `toE164India` over a table of inputs: `9876543210`, `09876543210`,
   `+91 98765 43210`, `91-9876543210`, `0091 9876543210` all produce
   `+919876543210`. `1234567890`, `98765`, `+1 415 555 0123` and `abc` all
   produce null.
2. `isRetryable` returns true for 429, 500, 503 and false for 132001, 132000,
   190 and 1006.
3. `NullWhatsAppService.send` returns a `providerRef` starting with `stub:` and
   never throws.
4. Every template name in the registry appears in the approved template list
   fixture. A code change adding a WhatsApp template without a submission entry
   fails CI, which is the reminder to submit it.
5. Variable count per template matches the placeholder count in the fixture
   body. A mismatch is Meta error 132000 in production and a failed assertion
   here.

Integration:

6. With `WHATSAPP_ENABLED=false`, a `LOW_STOCK` event produces one `IN_APP`
   notification and one `WHATSAPP` notification row with a stub `providerRef`,
   and no network call is attempted.
7. A recipient whose phone fails normalisation gets the `IN_APP` row and a
   `WHATSAPP` row with `status = 'SUPPRESSED'` and
   `failReason = 'INVALID_PHONE'`.
8. A provider that throws a retryable error leaves the outbox row PENDING with
   `attempts = 1`.
9. A provider that throws 132001 marks the notification FAILED and the outbox
   row DONE, with no retry.

Webhook, supertest against the real route:

10. GET with the correct verify token returns the challenge as plain text 200.
    GET with a wrong token returns 403 and no body.
11. POST with a valid `X-Hub-Signature-256` computed over the exact raw body
    returns 200 and advances the notification status.
12. POST with a tampered body returns 401 and changes nothing.
13. The same `delivered` payload posted three times leaves the row at
    `DELIVERED` with one write, proving idempotency.
14. A `sent` payload arriving after `delivered` does not move the status
    backwards.
