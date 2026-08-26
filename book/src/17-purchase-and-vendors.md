# Purchase and vendor management

This chapter implements FR-PUR-001 (create purchase request), FR-PUR-002 (record
purchase and price) and FR-PUR-003 (view price history). It depends on the stock
ledger described in [chapter 16](16-inventory.md) and never writes to it
directly.

## The purchasing rhythm

Buying at a momo QSR runs on three clocks. Vegetables and chicken are bought
almost every morning, from whoever at the mandi has good stock that day, at a
price that moves with the weather and the season. Dry goods (maida, oil, sauces,
spice) come weekly from one or two regular suppliers at prices that hold for
months. Packaging (paper boxes, carry bags, cutlery) comes monthly in bulk.

Three rhythms, three cost profiles, and one thing the owner cannot currently do:
tell you what a kilo of chicken cost last Tuesday. The purchase bills are
handwritten, they go into a drawer, and by the time anyone adds them up the
month is over. When the momo price on the menu was set, the chicken was Rs 190 a
kilo. Nobody knows what it is now without walking to the drawer.

That is the actual pain. It is not procurement workflow. Bob's Momo does not
need requisition routing, budget envelopes, three-way matching or multi-level
approval. It needs the price of every line item, dated, queryable, charted. So
the design puts almost all of its weight on `ItemPriceHistory` and the recording
flow that feeds it, and keeps the request and approval workflow deliberately
thin.

## Vendor master

`Vendor` is a flat record with no hierarchy and no contract terms.

| Field | Type | Notes |
|---|---|---|
| `name` | String, unique | the constraint that matters, see below |
| `phone` | String, optional | 10 digit Indian mobile, validated but not verified |
| `email` | String, optional | rarely present, mandi vendors do not use email |
| `address` | String, optional | free text |
| `gstin` | String, optional | 15 characters, validated by pattern when present |
| `isActive` | Boolean | soft delete |

The unique constraint on `name` is deliberate and it is enforced
case-insensitively at the service layer on top of the database's exact-match
unique index. Without it a purchase manager in a hurry creates "Sharma
Vegetables", "sharma vegetables" and "Sharma Veg" over three weeks, and the
spend-by-vendor report splits one supplier into three rows. On a 409, the error
response includes the id and name of the existing vendor so the UI can offer
"did you mean this one" instead of a dead end.

`VendorItem` links a vendor to the items they supply. It is a two-column join
table with a composite primary key and no payload: no vendor SKU, no agreed
price, no lead time. In Phase 1 it does exactly one job. When a purchase manager
selects a vendor on the purchase entry screen, the item picker filters to that
vendor's items, with a "show all items" toggle for the day the vegetable vendor
happens to also have eggs. That is the whole feature. It is not a catalogue, it
does not constrain what can be purchased, and the API will happily record a
purchase line for an item that is not linked to the vendor. Making the link
binding would mean a purchase manager standing at a market stall cannot record
what he just bought, which is worse than an unfiltered picker.

Vendors are deactivated, never deleted, for the same reason items are:
`Purchase.vendorId` and `ItemPriceHistory.vendorId` reference them. An inactive
vendor drops out of the vendor picker and out of the default list, cannot be
named on a new purchase (422 `VENDOR_INACTIVE`), and still appears in every
historical report and price chart.

## Purchase request state machine

FR-PUR-001 asks for a request that a manager approves or rejects, with the SRS
rule stated explicitly: no multi-level approval chain, a single manager
decision.

```text
                        POST /purchase-requests
                        purchase.request.create
                                  │
                                  ▼
                          ┌──────────────┐
                          │   PENDING    │
                          └──────┬───────┘
                                 │
       ┌─────────────────────────┼──────────────────────────┐
       │                         │                          │
  approve                   reject                    cancel
  ...request.approve        ...request.reject         ...request.cancel
  PURCHASE_DECIDED          PURCHASE_DECIDED          (no event)
       │                         │                          │
       ▼                         ▼                          ▼
 ┌────────────┐            ┌────────────┐            ┌─────────────┐
 │  APPROVED  │            │  REJECTED  │            │  CANCELLED  │
 └─────┬──────┘            └────────────┘            └─────────────┘
       │                      terminal                   terminal
       │
       │  POST /purchases with requestId
       │  purchase.record.create
       │  PURCHASE_RECORDED
       ▼
 ┌────────────┐
 │  FULFILLED │   terminal
 └────────────┘
```

Every allowed transition, and nothing else is allowed:

| From | To | Endpoint | Permission | Event |
|---|---|---|---|---|
| (none) | `PENDING` | `POST /purchase-requests` | `purchase.request.create` | `PURCHASE_REQUESTED` |
| `PENDING` | `APPROVED` | `POST /purchase-requests/:id/approve` | `purchase.request.approve` | `PURCHASE_DECIDED` |
| `PENDING` | `REJECTED` | `POST /purchase-requests/:id/reject` | `purchase.request.approve` | `PURCHASE_DECIDED` |
| `PENDING` | `CANCELLED` | `POST /purchase-requests/:id/cancel` | `purchase.request.cancel` | none |
| `APPROVED` | `FULFILLED` | `POST /purchases` with `requestId` | `purchase.record.create` | `PURCHASE_RECORDED` |

Any other transition returns 409 `PR_INVALID_TRANSITION` with the current status
in `details`. An approved request cannot be un-approved. A rejected request
cannot be revived: the requester raises a new one, which takes eight seconds and
leaves a truthful history instead of a mutated one.

Cancel is available to the requester while the request is `PENDING` and to any
holder of `purchase.request.cancel`. It emits no notification, because a request
nobody has acted on yet is not news.

The single decision step is a scope boundary, not an oversight. The SRS says so
in FR-PUR-001 and again in the out-of-scope section. If a second approval level
appears in a ticket, it is new scope with a new estimate. The place it will try
to sneak back in is a "high value requests need owner sign-off" threshold, which
sounds free and is not: it needs a threshold config, a second decider role, a
second notification, a partially-approved state and a UI for all of it.

## Recording a purchase

This is the flow that matters. Everything else in the module exists to support
it.

```text
  POST /purchases                        one Prisma $transaction
  ───────────────                        ───────────────────────
        │
        ▼
  validate: vendor active, every itemId active,
  purchaseDate within the backdate window,
  requestId (if present) is APPROVED and same outlet
        │
        ▼
  compute server-side, ignoring anything the client sent:
     lineTotal[i] = quantity[i] * unitPrice[i]   (Decimal, 2dp)
     subtotal     = sum(lineTotal)
     totalAmount  = subtotal + taxAmount
        │
  ┌─────┴─────────────── BEGIN ───────────────────────────────┐
  │                                                            │
  │  1. INSERT Purchase          status RECORDED               │
  │                              purchaseNo PO-2026-0117       │
  │                                                            │
  │  2. INSERT PurchaseItem[]    one row per line              │
  │                                                            │
  │  3. INSERT ItemPriceHistory  one row per line              │
  │        (itemId, vendorId, unitPrice, observedOn,           │
  │         purchaseId)                                        │
  │                                                            │
  │  4. for each line:                                         │
  │        inventoryService.applyTransaction(tx, {             │
  │          type: "RECEIVED", sourceType: "PURCHASE",         │
  │          sourceId: purchase.id, ... })                     │
  │      ── locks ItemStock, appends the ledger row,           │
  │         moves qtyOnHand, runs the reorder check ──         │
  │                                                            │
  │  5. if requestId: UPDATE PurchaseRequest                   │
  │        SET status = 'FULFILLED'                            │
  │                                                            │
  │  6. INSERT OutboxEvent  eventKey PURCHASE_RECORDED         │
  │                                                            │
  └─────────────────── COMMIT or ROLLBACK ────────────────────┘
        │
        ▼
  201 with the full purchase, its lines, and the resulting
  stock balances, plus priceWarnings[] if any line was more
  than 25% away from the last observed price
```

Two rules in that diagram carry weight.

The first is that the server computes every money field. `lineTotal`, `subtotal`
and `totalAmount` are never read from the request body. The create schema is
`.strict()`, so a client that sends `totalAmount` gets a 400 rather than a
silently ignored field, which means a frontend bug surfaces in development
instead of producing a purchase whose total does not match its lines. The client
displays a running total for the user to check against the paper bill, but that
number is advisory and the server recomputes it from `quantity` and `unitPrice`.
A purchase total that does not equal the sum of its lines is not a bug the
reports can survive.

The second is that step 4 calls the inventory service. It does not insert
`StockTransaction` rows itself and it does not update `ItemStock` itself. All of
the balance logic lives in one place: the `SELECT ... FOR UPDATE` on the stock
row, the `balanceAfter` computation, the reorder threshold check and the
`LOW_STOCK` outbox insert. Duplicating any of that here would mean a delivery
that pushes stock back above the reorder level does not clear the way for the
next alert, or that two code paths compute `balanceAfter` differently and the
ledger stops replaying to the balance. The inventory service method takes the
transaction client as its first argument precisely so a caller can enlist it in
an outer transaction.

Purchase numbers are `PO-YYYY-NNNN`, allocated from a Postgres sequence per
calendar year inside the same transaction. A rolled back purchase burns a
number, which is fine. A gap in the sequence is not a problem; a duplicate
number would be.

`Purchase.status` starts at `RECORDED`, not `DRAFT`. The `DRAFT` value exists in
the enum and is unused in Phase 1. There is no save-and-continue-later flow,
because a purchase is entered from a paper bill in one sitting and a half-saved
purchase that never received stock is a reconciliation problem waiting to
happen.

## Voiding a purchase

A recorded purchase cannot be edited. There is no `PATCH /purchases/:id`. The
only correction is a void with a reason.

```text
  POST /purchases/:id/void   { reason }
  ────────────────────────────────────
        │
        ▼
  status is RECORDED?  ──no──▶ 409 PURCHASE_ALREADY_VOIDED
        │ yes
  ┌─────┴────────────── BEGIN ─────────────────────────┐
  │                                                     │
  │  for each PurchaseItem line:                        │
  │     inventoryService.applyTransaction(tx, {         │
  │       type: "ADJUSTMENT",                           │
  │       signedQty: -line.quantity,                    │
  │       reason: "Void of PO-2026-0117: " + reason,    │
  │       sourceType: "PURCHASE_VOID",                  │
  │       sourceId: purchase.id })                      │
  │                                                     │
  │  UPDATE Purchase SET status = 'VOIDED',             │
  │      voidedAt = now(), voidReason = reason          │
  │                                                     │
  │  ItemPriceHistory rows are left untouched           │
  │                                                     │
  └────────────────── COMMIT or ROLLBACK ──────────────┘
```

The compensating rows are `ADJUSTMENT`, not a deletion of the original
`RECEIVED` rows, because the ledger is append only. They carry
`sourceType: "PURCHASE_VOID"` and `sourceId` pointing at the purchase, so the
item history screen can show "received 15 kg against PO-2026-0117" followed by
"reversed 15 kg, void of PO-2026-0117: wrong vendor selected" as two
self-explanatory lines.

The void uses `ADJUSTMENT` rather than a negative `RECEIVED` for a specific
reason: `ADJUSTMENT` is the one type permitted to drive the balance below zero.
If a purchase is voided after the kitchen has already issued the stock, the
balance goes negative and that is the correct outcome. It says, accurately, that
the ledger now believes the outlet used stock it never received, which is
exactly the discrepancy a manager needs to see. Blocking the void would leave a
known-false purchase record in the system to protect a balance that is already
wrong.

Price history rows are not retracted on void. A void usually means the paperwork
was wrong (wrong vendor, wrong outlet, duplicate entry), not that the price
observation was false. Somebody did quote Rs 310 for paneer that morning, and
that is what the price trend chart is recording. Deleting price observations
whenever a bill is re-keyed would put holes in exactly the series the owner
bought this system for. When the price itself was the typo, the correction is to
void and re-record: the void leaves the wrong observation and the new purchase
adds the right one on the same date, and the trend query takes the latest
observation per item per vendor per date. The wrong number is visible in the raw
price history list and invisible in the chart.

## Price history and the price trend

`ItemPriceHistory` is one row per item per vendor per purchase line, carrying
`unitPrice` and `observedOn` (the `purchaseDate`, not the entry timestamp).

It is a separate table rather than a view over `PurchaseItem` for two reasons.
Voided purchases keep their price observations, as argued above, and a query
over `PurchaseItem` joined to `Purchase` would have to either include voided
purchases (wrong for spend) or exclude them (wrong for prices). One table cannot
be filtered two ways at once without a flag on every query, and somebody will
forget the flag.

The second reason is that a price observation does not have to come from a
purchase. `purchaseId` is nullable. A vendor quote taken over the phone, or a
market rate the owner notes down, is a valid observation with no purchase behind
it. Phase 1 has no endpoint that writes one, but the table shape does not have
to change when it arrives.

The trend query for one item, all vendors, last 90 days:

```sql
SELECT
  h."observedOn",
  v.name                                    AS vendor,
  h."unitPrice",
  AVG(h."unitPrice") OVER (
    ORDER BY h."observedOn"
    RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW
  )                                         AS ma7,
  AVG(h."unitPrice") OVER (
    ORDER BY h."observedOn"
    RANGE BETWEEN INTERVAL '29 days' PRECEDING AND CURRENT ROW
  )                                         AS ma30
FROM "ItemPriceHistory" h
JOIN "Vendor" v ON v.id = h."vendorId"
WHERE h."itemId" = $1
  AND h."observedOn" >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY h."observedOn";
```

A `RANGE` window over the date column, rather than `ROWS BETWEEN 6 PRECEDING`,
gives a true 7 calendar day average. Rows-based windows silently become 7
purchase averages, which for an item bought twice a week spans three and a half
weeks. The `(itemId, observedOn)` index on `ItemPriceHistory` serves this query
directly.

The percentage change against the prior period is computed in the service, not
in SQL, because it needs to handle the zero and null cases explicitly:

```ts
function periodChange(current: Decimal[], prior: Decimal[]) {
  if (current.length === 0 || prior.length === 0) return null;
  const avg = (xs: Decimal[]) =>
    xs.reduce((a, b) => a.plus(b), new Decimal(0)).div(xs.length);
  const [now, then] = [avg(current), avg(prior)];
  if (then.isZero()) return null;
  return now.minus(then).div(then).mul(100).toDecimalPlaces(1);
}
```

A `null` renders as "no comparison" in the UI, never as 0 percent. An item first
purchased last week has no prior period, and showing "0% change" for it is a
lie that a manager will act on.

> **Spec note:** this module uses twelve keys, all of them defined in the
> chapter 14 matrix: `vendor.vendor.create`, `vendor.vendor.read`,
> `vendor.vendor.update`, `vendor.vendor.deactivate`,
> `purchase.request.create`, `purchase.request.read`,
> `purchase.request.approve`, `purchase.request.cancel`,
> `purchase.record.create`, `purchase.record.read`, `purchase.record.void`
> and `purchase.price_history.read`.
>
> Approve and reject share `purchase.request.approve`: they are the same
> decision authority, and a separate reject key would let somebody refuse a
> request they cannot grant. Editing a vendor's item links is
> `vendor.vendor.update`, since it is an edit to the vendor record. Chapter 14
> owns the role mapping.

## Endpoint reference

Base path `/api/v1`. Every endpoint requires a bearer token and returns 401
`UNAUTHENTICATED` or 403 `FORBIDDEN` as described in
[chapter 16](16-inventory.md); those rows are omitted below. The shared
primitives (`uuid`, `qty`, `money`, `businessDate`, `pageQuery`) are the ones
defined in that chapter.

### GET /vendors

Permission `vendor.vendor.read`. Scope `NONE`.

```ts
export const listVendorsQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(64).optional(),
  isActive: z.coerce.boolean().default(true),
});
```

```json
{
  "data": [
    { "id": "v1a2...", "name": "Sharma Vegetables", "phone": "9438012233",
      "gstin": null, "isActive": true, "itemCount": 22,
      "lastPurchaseAt": "2026-08-26" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 9 }
}
```

### POST /vendors

Permission `vendor.vendor.create`. Scope `NONE`. Status 201.

```ts
export const createVendorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/).optional(),
  email: z.string().trim().email().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  gstin: z.string().trim().toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/).optional(),
}).strict();
```

```json
{ "name": "Sharma Vegetables", "phone": "9438012233" }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | schema failure, bad phone or GSTIN pattern |
| 409 | `VENDOR_NAME_TAKEN` | case-insensitive name match exists |

The 409 body carries `details: [{ field: "name", issue: "duplicate",
existingId: "v1a2..." }]` so the UI can link to the existing vendor.

### PATCH /vendors/:id

Permission `vendor.vendor.update`. Scope `NONE`. Same fields as create, all
optional, plus `isActive`. 404 `VENDOR_NOT_FOUND`, 409 `VENDOR_NAME_TAKEN`.

### POST /vendors/:id/deactivate

Permission `vendor.vendor.deactivate`. Scope `NONE`. Empty body, 200 with the
updated vendor. Idempotent. The response includes `openRequests`, the count of
`PENDING` or `APPROVED` purchase requests that named this vendor, so the UI can
warn before retiring an active supplier.

### GET /vendors/:id/items and PUT /vendors/:id/items

Permissions `vendor.vendor.read` to read and `vendor.vendor.update` to write.
Scope `NONE`.

`PUT` replaces the whole link set in one call rather than exposing add and
remove endpoints. The UI is a multi-select and a save button, so a whole-set
replace is what the screen actually does.

```ts
export const setVendorItemsSchema = z.object({
  itemIds: z.array(uuid).max(500),
}).strict();
```

```json
{ "vendorId": "v1a2...", "itemIds": ["3c9a...", "9d21..."], "linked": 2 }
```

| Status | Code | When |
|---|---|---|
| 404 | `VENDOR_NOT_FOUND` | unknown vendor |
| 404 | `ITEM_NOT_FOUND` | any id in `itemIds` does not exist |
| 422 | `VENDOR_INACTIVE` | vendor is deactivated |

An empty array clears every link, which is valid and means "this vendor sells
anything".

### GET /purchase-requests

Permission `purchase.request.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.

```ts
export const listRequestsQuery = pageQuery.extend({
  outletId: uuid.optional(),
  status: z.enum(["PENDING","APPROVED","REJECTED","CANCELLED","FULFILLED"])
    .optional(),
  requestedById: uuid.optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
});
```

```json
{
  "data": [
    { "id": "pr77...", "requestNo": "PR-2026-0042", "outletCode": "BM-PATIA",
      "status": "PENDING", "neededBy": "2026-08-28", "lineCount": 3,
      "requestedBy": { "id": "aa10...", "name": "Sunil Behera" },
      "createdAt": "2026-08-26T04:02:19.110Z" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 11 }
}
```

### POST /purchase-requests

Permission `purchase.request.create`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.
Status 201. Emits `PURCHASE_REQUESTED` to the Purchase Manager.

```ts
export const createRequestSchema = z.object({
  outletId: uuid,
  neededBy: businessDate.optional(),
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    itemId: uuid,
    quantity: qty,
    note: z.string().trim().max(200).optional(),
  })).min(1).max(60),
}).strict()
  .refine((o) => new Set(o.lines.map((l) => l.itemId)).size === o.lines.length,
    { path: ["lines"], message: "duplicate itemId in lines" });
```

```json
{ "outletId": "c740...", "neededBy": "2026-08-28",
  "lines": [ { "itemId": "3c9a...", "quantity": 20 },
             { "itemId": "9d21...", "quantity": 5, "note": "for weekend" } ] }
```

```json
{ "id": "pr77...", "requestNo": "PR-2026-0042", "outletId": "c740...",
  "status": "PENDING", "neededBy": "2026-08-28",
  "lines": [ { "id": "l1...", "itemId": "3c9a...", "name": "Chicken Mince",
               "unitCode": "KG", "quantity": "20.000", "note": null } ],
  "requestedById": "aa10...", "createdAt": "2026-08-26T04:02:19.110Z" }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | empty or duplicated lines, over 60 lines |
| 404 | `ITEM_NOT_FOUND` | any line references an unknown item |
| 404 | `OUTLET_NOT_IN_SCOPE` | outlet outside caller scope |
| 422 | `ITEM_INACTIVE` | any line references a retired item |
| 422 | `NEEDED_BY_IN_PAST` | `neededBy` earlier than today |

The request line does not carry a price. The requester is a kitchen or store
manager who knows what is running out, not what it costs.

### GET /purchase-requests/:id

Permission `purchase.request.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`. Returns
the request with its lines, the decision fields (`decidedById`, `decidedAt`,
`decisionNote`) and, when fulfilled, the `purchaseId` that fulfilled it. 404
`PR_NOT_FOUND` for an unknown id or one outside scope.

### POST /purchase-requests/:id/approve, /reject, /cancel

Permissions `purchase.request.approve` for both approve and reject, and
`purchase.request.cancel` for cancel. Approving and rejecting are the same
decision authority, so they share one key. Scope `OWN_OUTLET` or `ALL_OUTLETS`. Status 200.

```ts
export const decideRequestSchema = z.object({
  decisionNote: z.string().trim().max(500).optional(),
}).strict();

// reject requires the note, approve and cancel do not
export const rejectRequestSchema = z.object({
  decisionNote: z.string().trim().min(3).max(500),
}).strict();
```

```json
{ "id": "pr77...", "requestNo": "PR-2026-0042", "status": "APPROVED",
  "decidedById": "bb20...", "decidedAt": "2026-08-26T04:31:07.442Z",
  "decisionNote": null }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | reject without a `decisionNote` |
| 404 | `PR_NOT_FOUND` | unknown id or outside scope |
| 409 | `PR_INVALID_TRANSITION` | current status is not `PENDING` |

Approve and reject write the decision fields and insert a `PURCHASE_DECIDED`
outbox event addressed to the requester, in the same transaction. Cancel writes
the status and no event. Rejection requires a reason because a rejected request
with no explanation produces a WhatsApp message to the requester and then a
phone call, which is the manual step this system exists to remove.

### GET /purchases

Permission `purchase.record.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.

```ts
export const listPurchasesQuery = pageQuery.extend({
  outletId: uuid.optional(),
  vendorId: uuid.optional(),
  status: z.enum(["DRAFT","RECORDED","VOIDED"]).optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
  q: z.string().trim().max(40).optional(),     // purchaseNo or invoiceNo
});
```

```json
{
  "data": [
    { "id": "pu11...", "purchaseNo": "PO-2026-0117", "outletCode": "BM-SAHEED",
      "vendor": { "id": "v1a2...", "name": "Sharma Vegetables" },
      "purchaseDate": "2026-08-26", "invoiceNo": "SV/8842",
      "status": "RECORDED", "lineCount": 4, "subtotal": "4285.00",
      "taxAmount": "0.00", "totalAmount": "4285.00" }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 204 }
}
```

Default sort is `purchaseDate` descending then `createdAt` descending. Voided
purchases are included and flagged, not hidden, because a purchase manager
looking for yesterday's bill needs to find the one they voided.

### POST /purchases

Permission `purchase.record.create`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.
Accepts `Idempotency-Key`. Status 201.

```ts
export const createPurchaseSchema = z.object({
  outletId: uuid,
  vendorId: uuid,
  requestId: uuid.optional(),
  invoiceNo: z.string().trim().max(40).optional(),
  purchaseDate: businessDate,
  taxAmount: money.default(0),
  note: z.string().trim().max(500).optional(),
  lines: z.array(z.object({
    itemId: uuid,
    quantity: qty,
    unitPrice: money,
  })).min(1).max(60),
}).strict()
  .refine((o) => new Set(o.lines.map((l) => l.itemId)).size === o.lines.length,
    { path: ["lines"], message: "duplicate itemId in lines" });
```

There is no `lineTotal`, no `subtotal` and no `totalAmount` in the schema. The
object is `.strict()`, so sending them is a 400.

```json
{
  "outletId": "8b1f...", "vendorId": "v1a2...", "requestId": "pr77...",
  "invoiceNo": "SV/8842", "purchaseDate": "2026-08-26", "taxAmount": 0,
  "lines": [
    { "itemId": "3c9a...", "quantity": 15, "unitPrice": 212.5 },
    { "itemId": "9d21...", "quantity": 4, "unitPrice": 310 }
  ]
}
```

```json
{
  "id": "pu11...", "purchaseNo": "PO-2026-0117", "status": "RECORDED",
  "outletId": "8b1f...", "vendorId": "v1a2...", "requestId": "pr77...",
  "purchaseDate": "2026-08-26", "invoiceNo": "SV/8842",
  "subtotal": "4427.50", "taxAmount": "0.00", "totalAmount": "4427.50",
  "lines": [
    { "id": "pl1...", "itemId": "3c9a...", "name": "Chicken Mince",
      "unitCode": "KG", "quantity": "15.000", "unitPrice": "212.50",
      "lineTotal": "3187.50", "balanceAfter": "17.400" },
    { "id": "pl2...", "itemId": "9d21...", "name": "Paneer",
      "unitCode": "KG", "quantity": "4.000", "unitPrice": "310.00",
      "lineTotal": "1240.00", "balanceAfter": "4.000" }
  ],
  "priceWarnings": [
    { "itemId": "9d21...", "name": "Paneer", "unitPrice": "310.00",
      "lastUnitPrice": "240.00", "changePct": "29.2" }
  ],
  "requestFulfilled": true,
  "recordedById": "bb20...", "createdAt": "2026-08-26T06:11:52.019Z"
}
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | schema failure, including a client-supplied total |
| 404 | `VENDOR_NOT_FOUND` | unknown vendor |
| 404 | `ITEM_NOT_FOUND` | any line references an unknown item |
| 404 | `OUTLET_NOT_IN_SCOPE` | outlet outside caller scope |
| 404 | `PR_NOT_FOUND` | `requestId` unknown or in another outlet |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | key reused with a different body |
| 409 | `PR_INVALID_TRANSITION` | `requestId` is not `APPROVED` |
| 422 | `VENDOR_INACTIVE` | vendor is deactivated |
| 422 | `ITEM_INACTIVE` | any line references a retired item |
| 422 | `FUTURE_BUSINESS_DATE` | `purchaseDate` after today |
| 422 | `BACKDATE_LIMIT_EXCEEDED` | `purchaseDate` more than 7 days back |

`priceWarnings` is informational and never blocks the write. A 29 percent jump
in paneer is sometimes a typo and sometimes just August. The server records the
purchase and tells the user what looks odd; the frontend shows the same warning
before submit, so by the time this array comes back the user has already
confirmed it.

### GET /purchases/:id

Permission `purchase.record.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`. Returns
the purchase, its lines with `lineTotal`, the linked request summary, the void
fields when voided, and the `StockTransaction` ids created for each line so the
UI can deep link into the item history. 404 `PURCHASE_NOT_FOUND`.

### POST /purchases/:id/void

Permission `purchase.record.void`. Scope `OWN_OUTLET` or `ALL_OUTLETS`. Status
200.

```ts
export const voidPurchaseSchema = z.object({
  reason: z.string().trim().min(5).max(280),
}).strict();
```

```json
{ "reason": "Recorded against the wrong outlet" }
```

```json
{ "id": "pu11...", "purchaseNo": "PO-2026-0117", "status": "VOIDED",
  "voidedAt": "2026-08-26T07:02:41.775Z",
  "voidReason": "Recorded against the wrong outlet",
  "reversals": [
    { "itemId": "3c9a...", "signedQty": "-15.000", "balanceAfter": "2.400" },
    { "itemId": "9d21...", "signedQty": "-4.000", "balanceAfter": "-1.000",
      "isNegative": true }
  ] }
```

| Status | Code | When |
|---|---|---|
| 400 | `VOID_REASON_REQUIRED` | reason missing or under 5 characters |
| 404 | `PURCHASE_NOT_FOUND` | unknown id or outside scope |
| 409 | `PURCHASE_ALREADY_VOIDED` | status is already `VOIDED` |

A reversal that drives a balance negative succeeds and is flagged in the
response. The UI surfaces it as a warning with a link to record the adjustment
that explains it.

### GET /purchases/price-history

Permission `purchase.price_history.read`. Scope `NONE`. The raw observation list.

```ts
export const priceHistoryQuery = pageQuery.extend({
  itemId: uuid.optional(),
  vendorId: uuid.optional(),
  categoryId: uuid.optional(),
  from: businessDate.optional(),
  to: businessDate.optional(),
});
```

```json
{
  "data": [
    { "id": "ph9...", "observedOn": "2026-08-26", "itemId": "9d21...",
      "itemName": "Paneer", "unitCode": "KG",
      "vendor": { "id": "v1a2...", "name": "Sharma Vegetables" },
      "unitPrice": "310.00", "purchaseId": "pu11...",
      "purchaseNo": "PO-2026-0117", "purchaseVoided": false }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 1642 }
}
```

`purchaseVoided` is joined from `Purchase.status` so a reader can see which
observations came from a bill that was later voided, without those rows being
removed.

### GET /items/:id/price-trend

Permission `purchase.price_history.read`. Scope `NONE`. The chart endpoint.

```ts
export const priceTrendQuery = z.object({
  vendorId: uuid.optional(),          // omitted = every vendor, one series each
  days: z.coerce.number().int().min(7).max(365).default(90),
});
```

```json
{
  "item": { "id": "9d21...", "name": "Paneer", "unitCode": "KG" },
  "days": 90,
  "latest": { "unitPrice": "310.00", "observedOn": "2026-08-26",
              "vendorName": "Sharma Vegetables" },
  "stats": { "min": "228.00", "max": "310.00", "avg": "261.40",
             "ma7": "294.20", "ma30": "263.80",
             "changePct7v7": "12.4", "changePct30v30": "6.1" },
  "series": [
    { "observedOn": "2026-08-19", "unitPrice": "285.00",
      "vendorName": "Sharma Vegetables", "ma7": "271.00", "ma30": "259.10" },
    { "observedOn": "2026-08-26", "unitPrice": "310.00",
      "vendorName": "Sharma Vegetables", "ma7": "294.20", "ma30": "263.80" }
  ]
}
```

404 `ITEM_NOT_FOUND` for an unknown item. An item with no observations returns
200 with an empty `series`, `latest: null` and every `stats` field `null`. An
empty chart with "no purchases recorded for this item" is a correct answer.
The response is cached in Redis for 300 seconds under
`price:trend:{itemId}:{vendorId}:{days}` and invalidated by the purchase
recording flow.

### GET /purchases/summary

Permission `purchase.record.read`. Scope `OWN_OUTLET` or `ALL_OUTLETS`.

```ts
export const purchaseSummaryQuery = z.object({
  outletId: uuid.optional(),
  from: businessDate,
  to: businessDate,
  groupBy: z.enum(["vendor", "category", "item", "month"]).default("vendor"),
});
```

```json
{
  "range": { "from": "2026-08-01", "to": "2026-08-26" },
  "groupBy": "vendor",
  "totals": { "purchaseCount": 61, "totalAmount": "184320.00" },
  "data": [
    { "vendorId": "v1a2...", "vendorName": "Sharma Vegetables",
      "purchaseCount": 24, "totalAmount": "71240.00", "sharePct": "38.6" }
  ]
}
```

Voided purchases are excluded from every figure in this endpoint. Spend reports
count money that was actually spent.

## Reports this module owns

Purchase summary by vendor answers "who are we paying and how much", grouped by
vendor with a share percentage, over any date range. Grouped by month it gives
the owner the total purchase cost line that the gross margin view needs.

Spend by item category answers "where is the money going". Meat and vegetables
will dominate; the value of the report is watching packaging creep up when the
box supplier raises prices and nobody notices because the individual bills are
small.

The price fluctuation leaderboard ranks items by the absolute percentage change
between the average unit price in the last 30 days and the 30 days before that,
filtered to items with at least three observations in each window so a single
outlier purchase cannot top the chart. This is the report the owner will
actually open. It answers "what got more expensive this month" in one screen,
which is the question that drives every menu price conversation.

P&L in the SRS is explicitly limited by data availability, and this module
supplies only the cost side. That limit is the subject of the next section.

## The costing caveat

Phase 1 cannot compute cost of goods sold per dish, and the handbook should say
so before UAT does.

Computing the food cost of one plate of steam chicken momo needs a recipe: eight
pieces use this much mince, this much maida, this much cabbage, this much oil.
That is a bill of materials, and Phase 1 has no `Recipe` model, no
`RecipeIngredient` model, no yield percentages and no per-dish sales data,
because `DailySalesEntry` records one gross figure per outlet per day and not a
line per menu item.

What the owner does get is a real and useful number: total purchase cost for a
period against total net sales for the same period, per outlet. Sum
`Purchase.totalAmount` where `status = 'RECORDED'`, sum `DailySalesEntry`
`netSales`, and the difference over sales is a gross margin approximation.

Three reasons it is an approximation and not a P&L. Purchases are not
consumption: a month with a big packaging buy looks worse than it was, because
those boxes will be used over three months. Wages, rent, electricity, gas and
the delivery aggregator commission are not in this system at all, so the number
is a gross margin and never a profit. And the sales figure is manually entered
by a human at closing time, with whatever accuracy that implies.

The report labels itself accordingly. It is titled "purchase cost vs sales", it
carries the caveat in the response body, and it does not use the words profit or
P&L anywhere in the UI.

Doing it properly needs, in rough order of effort: per-item sales capture (a POS
integration or a menu-item sales entry screen), a recipe model with yields, a
costing method (weighted average is enough, FIFO needs batch tracking), and an
expense module for the non-food costs. That is a Phase 2 conversation and it is
recorded in the future scope chapter, not quietly attempted here.

## UI notes for the purchase entry screen

The purchase manager is at a desk with a handwritten bill in front of them and
maybe eleven lines to key in. Speed and a checkable total are the whole
requirement.

The vendor field comes first and it is a required single-select with type-ahead.
Selecting it filters the item picker to that vendor's `VendorItem` links, with a
"show all items" toggle beside it. Choosing the vendor first is not just a form
convention: it cuts the item list from 200 rows to 22 and turns each subsequent
line into two taps and two numbers.

Each line is a row with the item on the left and quantity and unit price side by
side, both numeric keypads, with the unit code as a suffix on the quantity and
the rupee symbol as a prefix on the price. The line total renders live to the
right of the price as the user types. Adding a line does not scroll the page;
the grand total is pinned to the bottom of the viewport.

The grand total is the point of the screen. It is rendered at 24 pixels or
larger in the pinned footer, updating on every keystroke, because the purchase
manager's verification step is comparing that number to the handwritten total on
the paper bill. If those match, every line is almost certainly right. If they do
not, one line is wrong and the user can find it. Hiding the total behind a
"review" step removes the only check this workflow has.

When a unit price is more than 25 percent away from the last recorded price for
that item, in either direction, the row shows an amber banner: "Paneer was
Rs 240.00 on 19 Aug. This is 29% higher. Correct?" with a dismiss control. It is
a warning, not a block, because prices genuinely do move that much at a mandi in
monsoon. It exists because the most common data entry error in this form is a
misplaced decimal or a digit dropped from a four digit price, and those errors
poison the price trend chart that the whole module exists to produce. The
threshold lives in `PURCHASE_PRICE_DEVIATION_PCT` so it can be tuned after a
month of real data without a deploy.

Submission is the same pattern as the stock entry screen: no optimistic success,
a real spinner, an `Idempotency-Key` generated when the form opens, and a
success state that shows the purchase number and the resulting stock balances.
The stock balances on the success screen matter more than they look, because
they are the purchase manager's confirmation that the delivery actually landed
in inventory and not just in an accounting record.

## Failure modes

| Code path | Realistic production failure | Test covers it | Error handling exists | User experience |
|---|---|---|---|---|
| `POST /purchases` transaction | One line's item is deactivated between page load and submit | yes, e2e | yes, pre-flight validation | 422 `ITEM_INACTIVE` naming the item |
| `POST /purchases` transaction | Stock lock contention with a concurrent kitchen issue | yes, integration | yes, `FOR UPDATE` serialises | Brief delay, then 201 |
| `POST /purchases` transaction | 60 line purchase exceeds the statement timeout | no | no | Request fails, nothing committed, user re-keys |
| `purchaseNo` sequence | Rolled back transaction burns a number | yes, integration | n/a, gaps are acceptable | Gap in the PO series, no user impact |
| Request fulfilment | Two purchases recorded against the same approved request | yes, e2e | yes, status check inside the tx | Second gets 409 `PR_INVALID_TRANSITION` |
| Idempotency | Purchase manager double taps submit on a slow connection | yes, e2e | yes, Redis key replay | One purchase, one set of stock rows |
| Idempotency | Redis unavailable at key check-in | no | no, throws | 500 on a submit that would have worked |
| Void | Void after the stock was already issued | yes, unit | yes, intentional negative allowed | 200 with `isNegative` flag on the line |
| Void | Void of a purchase whose item was later deactivated | no | partial, `ADJUSTMENT` path skips the active check | Succeeds, which is the intent, but untested |
| Price warning | Item has no prior price observation | yes, unit | yes, warning omitted | No banner, correct for a first purchase |
| Price trend | Item with zero observations | yes, unit | yes, empty series | Empty chart with an explanatory message |
| Price trend cache | Cache not invalidated after a purchase | no | no | Trend chart up to 300 seconds stale |
| Vendor duplicate | "Sharma Veg" created alongside "Sharma Vegetables" | no | no, they are different strings | Spend report splits one vendor into two rows |
| Decision events | `PURCHASE_DECIDED` outbox row written, WhatsApp template rejected by Meta | no | yes, outbox retries then marks `DEAD` | Requester sees the in-app notification only |

Two of these are worth naming as accepted risk rather than bugs. Near-duplicate
vendor names are only caught by exact case-insensitive match, so a genuinely
different spelling gets through; with nine vendors the fix is a monthly eyeball,
not a fuzzy matching feature. And the trend cache staleness is bounded at five
minutes on a chart whose data changes once or twice a day.

## Test plan

Unit tests in `purchase.service.spec.ts`, with a mocked transaction client and a
stubbed inventory service.

| Test | Assertion |
|---|---|
| `computes lineTotal from quantity and price` | 15 x 212.50 gives `"3187.50"` |
| `computes subtotal from lines` | two lines sum to `"4427.50"` |
| `adds tax to totalAmount` | subtotal 4427.50 plus tax 100 gives `"4527.50"` |
| `ignores client-supplied totals` | schema parse of a body with `totalAmount` throws |
| `rounds line totals to 2 decimals` | 0.333 x 3 gives `"1.00"`, not `"0.999"` |
| `calls inventory service once per line` | stub called twice with `type: "RECEIVED"` |
| `never writes StockTransaction directly` | zero direct `stockTransaction.create` calls |
| `passes purchase as the transaction source` | each call carries `sourceType: "PURCHASE"` and the purchase id |
| `upserts one price history row per line` | two `itemPriceHistory.create` calls with `observedOn` equal to `purchaseDate` |
| `marks a linked request FULFILLED` | request update called with `status: "FULFILLED"` |
| `rejects a request that is not APPROVED` | throws `PR_INVALID_TRANSITION` for `PENDING` |
| `emits PURCHASE_RECORDED once` | one outbox insert regardless of line count |
| `void writes one ADJUSTMENT per line` | two calls with negative `signedQty` |
| `void leaves price history intact` | zero deletes against `ItemPriceHistory` |
| `void requires a reason` | 4 character reason throws `VOID_REASON_REQUIRED` |
| `void of a voided purchase rejected` | throws `PURCHASE_ALREADY_VOIDED` |
| `price warning above 25 percent` | 240 to 310 produces a warning with `changePct: "29.2"` |
| `no price warning within 25 percent` | 240 to 280 produces no warning |
| `no price warning without history` | first purchase of an item produces no warning |
| `periodChange returns null with no prior` | empty prior array gives `null`, not 0 |
| `periodChange returns null on zero prior` | prior average of 0 gives `null` |
| `state machine rejects APPROVED to APPROVED` | throws `PR_INVALID_TRANSITION` |
| `state machine rejects REJECTED to APPROVED` | throws `PR_INVALID_TRANSITION` |
| `state machine allows PENDING to CANCELLED` | resolves |

Integration tests in `purchase.integration-spec.ts`, against a real database.

| Test | Assertion |
|---|---|
| `purchase is atomic` | forced failure on the third line leaves zero `Purchase`, zero `PurchaseItem`, zero `StockTransaction` and zero `ItemPriceHistory` rows |
| `stock balance moves by the purchased quantity` | `qtyOnHand` rises by exactly 15.000 after a 15 kg line |
| `RECEIVED rows carry balanceAfter` | ledger replays to the new `qtyOnHand` |
| `receiving clears the low stock path` | balance crossing back above `reorderLevel` allows the next downward crossing to alert |
| `purchaseNo is unique under concurrency` | 20 parallel purchases produce 20 distinct numbers |
| `concurrent purchase and issue serialise` | a purchase and an issue on the same item leave a balance equal to the sum of movements |
| `request fulfilment is exclusive` | two parallel purchases against one approved request produce one success and one 409 |
| `void reverses the balance exactly` | balance after void equals the balance before the purchase |
| `void keeps price history rows` | row count unchanged, `purchaseVoided` reads true through the join |
| `price trend window is date based` | an item bought twice a week has a `ma7` covering 7 days, not 7 rows |

End-to-end tests in `purchase.e2e-spec.ts`, supertest with seeded roles.

| Test | Assertion |
|---|---|
| `request to purchase happy path` | create, approve, record, request reads `FULFILLED` and stock is up |
| `store manager cannot approve own request` | 403 without `purchase.request.approve` |
| `purchase manager cannot create a request outside scope` | 404 `OUTLET_NOT_IN_SCOPE` |
| `kitchen manager cannot record a purchase` | 403 on `POST /purchases` |
| `reject without a note` | 400 `VALIDATION_ERROR` |
| `reject with a note notifies the requester` | dispatcher run produces a `PURCHASE_DECIDED` notification for the requester |
| `client total is rejected` | body with `totalAmount` returns 400 |
| `idempotent replay` | same key twice returns one purchase and one set of stock rows |
| `idempotency conflict` | same key with a changed line returns 409 |
| `void endpoint` | 200, status `VOIDED`, stock back to the pre-purchase balance |
| `void twice` | second call returns 409 `PURCHASE_ALREADY_VOIDED` |
| `inactive vendor rejected` | 422 `VENDOR_INACTIVE` |
| `duplicate vendor name` | 409 `VENDOR_NAME_TAKEN` with `existingId` in details |
| `vendor item links filter the picker` | `GET /vendors/:id/items` returns exactly the linked set after a `PUT` |
| `price trend for an unpurchased item` | 200 with empty `series` and null `latest` |
| `purchase summary excludes voided` | totals drop by the voided amount after a void |
| `cross outlet purchase read is a 404` | Saheed-scoped user reading a Patia purchase gets 404, not 403 |
