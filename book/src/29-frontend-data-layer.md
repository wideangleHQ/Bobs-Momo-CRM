# Frontend data layer

Server state is TanStack Query. Client state is `useState` and the URL. There
is no Redux and no global store, because after the query cache and the search
params only three things are left to keep: the access token, the selected
outlet and the theme. Those live in React context.

## The typed API client

Chapter 26 covers the fetch wrapper, the bearer token and the single-flight
refresh. This layer sits on top of it and does one extra thing: it validates
every response against the same zod schema the API validated the response with,
imported from `packages/shared`.

That matters because the two apps deploy independently. If the API renames
`qtyOnHand` to `quantityOnHand`, an untyped client renders `undefined` and the
kitchen sees a blank stock figure. A validating client throws on the first
request, in development, at the boundary, with the field name in the message.

```ts
// apps/web/src/lib/api/typed.ts
import { z } from "zod";
import { apiFetch, type ApiRequest } from "./client";

export class SchemaError extends Error {
  constructor(readonly path: string, readonly issues: z.ZodIssue[]) {
    super(`Response from ${path} did not match its schema`);
  }
}

function parse<S extends z.ZodTypeAny>(
  schema: S, raw: unknown, path: string,
): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  if (process.env.NODE_ENV !== "production") {
    console.error(`[schema] ${path}`, r.error.issues, raw);
  }
  throw new SchemaError(path, r.error.issues);
}

export function apiGet<S extends z.ZodTypeAny>(
  path: string, schema: S, query?: ApiRequest["query"],
) {
  return apiFetch(path, { query }).then((raw) => parse(schema, raw, path));
}

export function apiSend<S extends z.ZodTypeAny>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string, schema: S, body: unknown, idempotencyKey?: string,
) {
  return apiFetch(path, { method, body, idempotencyKey })
    .then((raw) => parse(schema, raw, path));
}

/** Collections come back as { data, meta }. */
export function pageSchema<I extends z.ZodTypeAny>(item: I) {
  return z.object({
    data: z.array(item),
    meta: z.object({ page: z.number(), pageSize: z.number(),
                     total: z.number() }),
  });
}
```

Zod objects strip unknown keys by default, so the API adding a field never
breaks the web app. Only a removal or a type change fails, which is exactly the
set of changes that should fail.

Feature api files are thin and typed:

```ts
// apps/web/src/features/inventory/api/inventory.api.ts
import { ItemStockSchema, StockTransactionSchema,
         RecordTransactionInput } from "@bobsmomo/shared";
import { apiGet, apiSend, pageSchema } from "@/lib/api/typed";

export const listStock = (f: StockFilters) =>
  apiGet("/inventory/stock", pageSchema(ItemStockSchema), f);

export const recordTransaction = (
  input: RecordTransactionInput, idempotencyKey: string,
) => apiSend("POST", "/inventory/transactions", StockTransactionSchema,
             input, idempotencyKey);
```

## Query keys

Every module exports a key factory. Keys are hierarchical so a broad
invalidation is one call, and every key ends with the filter object so two
different filters are two different cache entries.

```ts
// apps/web/src/lib/query/keys.ts
const inv  = ["inventory"] as const;
const pur  = ["purchase"] as const;
const ven  = ["vendors"] as const;
const tsk  = ["tasks"] as const;
const att  = ["attendance"] as const;
const shf  = ["shifts"] as const;
const lve  = ["leave"] as const;
const emp  = ["employees"] as const;
const sal  = ["sales"] as const;
const ana  = ["analytics"] as const;
const ntf  = ["notifications"] as const;
const msg  = ["messages"] as const;
const adm  = ["admin"] as const;
const crm  = ["crm"] as const;

export const qk = {
  session: () => ["session"] as const,

  inventory: {
    all:    () => inv,
    items:  (f: ItemFilters)   => [...inv, "items", f] as const,
    item:   (id: string)       => [...inv, "item", id] as const,
    stock:  (f: StockFilters)  => [...inv, "stock", f] as const,
    ledger: (f: LedgerFilters) => [...inv, "ledger", f] as const,
    units:  ()                 => [...inv, "units"] as const,
  },

  purchase: {
    all:      () => pur,
    requests: (f: ReqFilters)   => [...pur, "requests", f] as const,
    request:  (id: string)      => [...pur, "request", id] as const,
    records:  (f: PurFilters)   => [...pur, "records", f] as const,
    record:   (id: string)      => [...pur, "record", id] as const,
    prices:   (f: PriceFilters) => [...pur, "prices", f] as const,
  },

  vendors: {
    all:  () => ven,
    list: (f: VendorFilters) => [...ven, "list", f] as const,
    one:  (id: string)       => [...ven, "one", id] as const,
  },

  tasks: {
    all:       () => tsk,
    list:      (f: TaskFilters) => [...tsk, "list", f] as const,
    one:       (id: string)     => [...tsk, "one", id] as const,
    comments:  (id: string)     => [...tsk, "one", id, "cmts"] as const,
    results:   (id: string)     => [...tsk, "one", id, "results"] as const,
    templates: ()               => [...tsk, "templates"] as const,
  },

  attendance: {
    all:     () => att,
    today:   ()                 => [...att, "today"] as const,
    board:   (f: BoardFilters)  => [...att, "board", f] as const,
    history: (f: HistFilters)   => [...att, "history", f] as const,
  },

  shifts: {
    all:    () => shf,
    mine:   ()                  => [...shf, "mine"] as const,
    roster: (f: RosterFilters)  => [...shf, "roster", f] as const,
  },

  leave: {
    all:     () => lve,
    mine:    ()                 => [...lve, "mine"] as const,
    one:     (id: string)       => [...lve, "one", id] as const,
    pending: (f: LeaveFilters)  => [...lve, "pending", f] as const,
    balance: ()                 => [...lve, "balance"] as const,
  },

  employees: {
    all:    () => emp,
    list:   (f: EmpFilters) => [...emp, "list", f] as const,
    one:    (id: string)    => [...emp, "one", id] as const,
    salary: (id: string)    => [...emp, "one", id, "salary"] as const,
  },

  sales: {
    all:  () => sal,
    list: (f: SalesFilters) => [...sal, "list", f] as const,
    day:  (outletId: string, date: string) =>
            [...sal, "day", outletId, date] as const,
  },

  analytics: {
    all:       () => ana,
    dashboard: (f: DashFilters) => [...ana, "dash", f] as const,
    report:    (name: string, f: ReportFilters) =>
                 [...ana, "report", name, f] as const,
  },

  notifications: {
    all:   () => ntf,
    list:  (f: NotifFilters) => [...ntf, "list", f] as const,
    prefs: ()                => [...ntf, "prefs"] as const,
  },

  messages: {
    all:           () => msg,
    conversations: ()           => [...msg, "convs"] as const,
    thread:        (id: string) => [...msg, "thread", id] as const,
  },

  admin: {
    users:       (f: UserFilters)  => [...adm, "users", f] as const,
    outlets:     ()                => [...adm, "outlets"] as const,
    recurrences: ()                => [...adm, "recurrences"] as const,
    auditLog:    (f: AuditFilters) => [...adm, "audit", f] as const,
  },

  crm: {
    games: ()           => [...crm, "games"] as const,
    game:  (id: string) => [...crm, "game", id] as const,
  },
} as const;
```

`queryClient.invalidateQueries({ queryKey: qk.inventory.all() })` clears every
inventory cache entry in one line. That is the point of the prefix.

## Cache timings

Four data classes, four sets of defaults. The `QueryClient` carries the master
data numbers and individual hooks override.

| Data class | staleTime | gcTime | refetchOnWindowFocus | Examples |
|---|---|---|---|---|
| Master data | 5 min | 30 min | off | items, units, categories, vendors, outlets, employees, checklist templates |
| Live boards | 30 s | 5 min | on | attendance board, open tasks, low stock list |
| Reports and dashboard | 2 min | 10 min | off | every `/analytics/*` response |
| Notifications | 60 s | 5 min | on | notification inbox, unread count |
| Detail records | 30 s | 5 min | on | one task, one purchase, one leave request |

`refetchOnWindowFocus` is on for the attendance board because the manager's real
workflow is to check the board, walk to the kitchen, come back and check again.
Stale data on that screen produces a wrong decision about who to send home.

It is off on every form screen. A cashier typing the sales entry who switches
to the calculator app and back must not have the form refetch and overwrite
what they typed. Chapter 27 calls this out on the sales entry spec and it is a
default in the form hooks, not a per-screen decision.

## Mutations

Every mutation follows the same shape. The three callbacks do exactly one job
each: `onMutate` snapshots and optionally patches, `onError` restores,
`onSettled` invalidates so the server has the last word either way.

```ts
// apps/web/src/features/inventory/hooks/use-record-transaction.ts
export function useRecordTransaction() {
  const qc = useQueryClient();
  const idempotencyKey = useIdempotencyKey(); // stable per form mount

  return useMutation({
    mutationFn: (input: RecordTransactionInput) =>
      recordTransaction(input, idempotencyKey.current),

    onMutate: async () => {
      // No optimistic patch here. See the policy below.
      return {};
    },

    onError: (err) => {
      // The form maps field errors; anything else becomes a toast.
      if (!(err instanceof ApiError) || !err.details?.length) {
        toast.error(copyFor(err));
      }
    },

    onSuccess: () => {
      idempotencyKey.rotate();   // next submit is a genuinely new write
      toast.success("Stock recorded");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.inventory.all() });
      qc.invalidateQueries({ queryKey: qk.analytics.all() });
    },
  });
}
```

The invalidation map, so nobody has to guess:

| Mutation | Invalidates |
|---|---|
| `POST /inventory/transactions` | `qk.inventory.all()`, `qk.analytics.all()` |
| `POST /inventory/transfers` | `qk.inventory.all()`, `qk.analytics.all()` |
| `POST /purchases` | `qk.purchase.all()`, `qk.inventory.all()`, `qk.analytics.all()` |
| `POST /purchases/:id/void` | `qk.purchase.all()`, `qk.inventory.all()`, `qk.analytics.all()` |
| `POST /purchase/requests` | `qk.purchase.requests({})` prefix, `qk.notifications.all()` |
| `POST /purchase/requests/:id/decision` | `qk.purchase.all()`, `qk.notifications.all()` |
| `PATCH /tasks/:id/status` | `qk.tasks.one(id)`, `qk.tasks.all()`, `qk.analytics.all()` |
| `POST /tasks/:id/checklist-results` | `qk.tasks.results(id)` only |
| `POST /tasks` | `qk.tasks.all()`, `qk.notifications.all()` |
| `POST /attendance/punch` | `qk.attendance.all()`, `qk.analytics.all()` |
| `POST /attendance/breaks` and break end | `qk.attendance.all()` |
| `POST /leave` | `qk.leave.all()`, `qk.notifications.all()` |
| `POST /leave/:id/decision` | `qk.leave.all()`, `qk.attendance.all()`, `qk.notifications.all()` |
| `POST /sales` and `PATCH /sales/:id` | `qk.sales.all()`, `qk.analytics.all()` |
| `POST /notifications/:id/read` | `qk.notifications.all()` |
| `POST /messages` | `qk.messages.thread(id)`, `qk.messages.conversations()` |

A leave decision invalidates attendance because an approved leave sets the
employee's `AttendanceStatus` to `ON_LEAVE` for the covered days, which changes
the board.

## The optimistic update policy

Optimistic updates are used for cheap, reversible UI state and nowhere else.

In scope: marking a notification read, ticking a checklist item locally while
its save is in flight, pinning a message, collapsing a section, marking a
message thread read.

Out of scope, permanently: anything that moves stock or money. Stock
transactions, transfers, purchases, purchase voids and sales entries always wait
for the server.

The reason is not technical purity. A stock issue that shows "Recorded, 7.400
KG left" and reverts three seconds later to 12.400 KG is worse than a 400 ms
spinner, because someone has already walked away and acted on the first number.
A spinner delays a decision. A reverted optimistic write produces a wrong one.
The same applies to a purchase total read off the screen before the manager
phones the vendor.

Attendance punch sits on the money side of the line even though it moves no
rupees, because a punch that appears and vanishes leaves the employee unsure
whether they are on the clock.

## Forms

react-hook-form with `zodResolver`, and the schema is the one from
`packages/shared` that the API validates the request body with. Not a copy. Not
a similar one. The same import.

```ts
// packages/shared/src/inventory/record-transaction.ts
export const RecordTransactionInput = z.object({
  outletId: z.string().uuid(),
  itemId: z.string().uuid(),
  type: z.enum(["OPENING","RECEIVED","ISSUED","WASTAGE","ADJUSTMENT",
                "CLOSING"]),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/, "Use up to 3 decimals")
             .refine((v) => Number(v) > 0, "Enter a quantity"),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(5).max(200).optional(),
  note: z.string().max(500).optional(),
}).refine(
  (v) => !["WASTAGE","ADJUSTMENT"].includes(v.type) || !!v.reason,
  { path: ["reason"], message: "Give a reason" },
);
export type RecordTransactionInput = z.infer<typeof RecordTransactionInput>;
```

```tsx
// apps/web/src/features/inventory/components/StockEntryForm.tsx
const form = useForm<RecordTransactionInput>({
  resolver: zodResolver(RecordTransactionInput),
  defaultValues: { type: "ISSUED", quantity: "",
                   businessDate: currentBusinessDate() },
  mode: "onBlur",
});

const record = useRecordTransaction();

const onSubmit = form.handleSubmit(async (values) => {
  try {
    await record.mutateAsync(values);
    form.reset({ ...form.getValues(), quantity: "", reason: "", note: "" });
  } catch (err) {
    applyServerErrors(form, err);   // never form.reset() on failure
  }
});
```

The server's `details[]` array maps straight back onto fields:

```ts
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>, err: unknown,
) {
  if (!(err instanceof ApiError)) return;
  const details = err.details ?? [];
  if (details.length === 0) { toast.error(copyFor(err)); return; }
  for (const d of details) {
    form.setError(d.field as Path<T>, {
      type: "server",
      message: copyForIssue(err.code, d.issue) ?? err.message,
    });
  }
  form.setFocus(details[0].field as Path<T>);
}
```

`copyForIssue` reads the same table chapter 28 documents. `INSUFFICIENT_STOCK`
with `issue: "exceeds_on_hand"` becomes "Only 2.400 KG of Chicken mince is on
hand", attached to the quantity input, with the input scrolled into view and
focused. No toast, because a field error belongs next to the field.

## Decimals on the client

The API sends every `Decimal` as a string. `qtyOnHand` is `"12.400"`, not
`12.4`. The client keeps it a string end to end and does arithmetic with a
helper, never with `parseFloat`.

Here is the bug that policy prevents, verified rather than imagined. A purchase
line is 152.500 KG of refined flour at ₹18.83 per kg. The exact answer is
₹2,871.575, which rounds half-up to ₹2,871.58. That is what the vendor's bill
says and what Postgres `numeric(14,2)` stores. In JavaScript,
`(152.5 * 18.83).toFixed(2)` is `"2871.57"`.

One paisa. On one line, nobody notices. On an eight line vendor bill the running
total the purchase manager reads before tapping Save disagrees with the total
the server saves, the screen and the paper do not match, and the purchase
manager stops trusting the app. That is a lost user, not a rounding artefact.

```ts
// apps/web/src/lib/decimal/index.ts
/** Decimal string -> scaled integer. "152.500", 3 -> 152500n */
export function toMinor(s: string, scale: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s.trim());
  if (!m) throw new Error(`not a decimal: ${s}`);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > scale) throw new Error(`too many decimals: ${s}`);
  return BigInt(sign + whole + frac.padEnd(scale, "0"));
}

export function fromMinor(v: bigint, scale: number): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString().padStart(scale + 1, "0");
  const cut = digits.length - scale;
  const out = scale === 0
    ? digits
    : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return (neg ? "-" : "") + out;
}

function roundHalfUp(v: bigint, dropDigits: number): bigint {
  const p = 10n ** BigInt(dropDigits);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const q = a / p;
  const rounded = (a % p) * 2n >= p ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** quantity(3dp) x unit price(2dp) -> line total(2dp), half-up */
export function multiplyMoney(qty: string, rate: string): string {
  return fromMinor(roundHalfUp(toMinor(qty, 3) * toMinor(rate, 2), 3), 2);
}

export const addMoney = (...v: string[]) =>
  fromMinor(v.reduce((s, x) => s + toMinor(x, 2), 0n), 2);

export const addQty = (...v: string[]) =>
  fromMinor(v.reduce((s, x) => s + toMinor(x, 3), 0n), 3);

export const cmpDecimal = (a: string, b: string, scale: number) =>
  toMinor(a, scale) === toMinor(b, scale) ? 0
    : toMinor(a, scale) < toMinor(b, scale) ? -1 : 1;
```

`multiplyMoney("152.500", "18.83")` returns `"2871.58"`. `addQty("0.100",
"0.200")` returns `"0.300"`, not `0.30000000000000004`.

Sixty lines of bigint, no dependency. If Phase 2 needs division, percentages or
currency conversion, swap in `decimal.js` behind the same four function names.
Only the final display goes through `formatMoney` and `formatQty` from
chapter 28.

## Dates on the client

The contract: a `@db.Date` field arrives as `"2026-08-26"`. A `DateTime` field
arrives as a UTC ISO string, `"2026-08-26T03:34:12.000Z"`. Filters and form
bodies send `YYYY-MM-DD` and the server interprets them as Asia/Kolkata business
dates.

Display conversion is `formatDate`, `formatTime` and `formatDateTime` from
chapter 28. They all pin `timeZone: "Asia/Kolkata"`, so a device set to any
timezone shows Indian time.

The business date is the one piece of date logic the client computes itself. The
business day starts at 04:00 IST, so a closing checklist submitted at 00:30
belongs to the previous trading day.

```ts
// apps/web/src/lib/format/business-date.ts
export const BUSINESS_DAY_START_HOUR = 4;
const IST = "Asia/Kolkata";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hour12: false,
});

/** Current Asia/Kolkata business date as YYYY-MM-DD. */
export function currentBusinessDate(now: Date = new Date()): string {
  const p = Object.fromEntries(
    parts.formatToParts(now)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;

  // Some ICU builds emit "24" for midnight with hour12:false.
  const hour = Number(p.hour) % 24;
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  if (hour < BUSINESS_DAY_START_HOUR) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
```

This value is a default for a form field and a default for a filter. It is not
authoritative. The server recomputes the business date from its own clock on
every write, and it wins. A phone with a wrong clock produces a wrong prefill
that the user can see and change, never a wrong ledger row.

## File upload

Task proof photos never pass through the API service. The browser gets a signed
upload URL, PUTs the bytes straight to Supabase Storage, then tells the API the
object key.

```text
  Browser                    API                  Supabase Storage
  ───────                    ───                  ────────────────
  pick / capture
       │
  resize to 1600px,
  JPEG q=0.8
       │
       ├─ POST /tasks/:id/attachments/upload-url ─►
       │  { mimeType, sizeBytes }
       │  ◄── { uploadUrl, storageKey, expiresIn: 300 }
       │
       ├─ PUT uploadUrl (raw bytes) ───────────────────────────►
       │  ◄── 200
       │
       ├─ POST /tasks/:id/attachments ─►  writes TaskAttachment
       │  { storageKey, mimeType, sizeBytes }
       │  ◄── { id }
       ▼
  attachment id goes into the form
```

Resize happens before the upload, in a canvas, on the phone. A modern Android
camera produces a 4 MB JPEG. At 1600 px on the longest edge and quality 0.8 that
photo is 200 to 400 KB, the difference between a 3 second upload and a 40 second
one on 4G.

The mime allowlist is `image/jpeg`, `image/png` and `image/webp`, checked on the
client for the error message and on the API for the guarantee. The size limit is
5 MB before resize and 1 MB after; anything still over 1 MB after resize is
re-encoded at quality 0.6 once, then rejected with "This photo is too large.
Take another one."

The UX during upload is a determinate progress bar per tile driven by
`XMLHttpRequest.upload.onprogress`, because `fetch` has no upload progress. On
failure the tile turns danger-bordered with a "Retry" label, the other tiles
keep going, and the form stays submittable if the failed photo was optional.

## Polling

Polling is TanStack Query's `refetchInterval`. It pauses automatically when the
document is hidden, because `refetchIntervalInBackground` defaults to false. No
screen overrides that.

| Screen | Interval | Why |
|---|---|---|
| Attendance board | 30 s | who is on the floor changes minute to minute |
| Staff home task list | 60 s | a manager can assign a task mid-shift |
| Notification bell and inbox | 60 s | the WhatsApp message may not arrive |
| Chat thread (open) | 15 s | conversation pacing |
| Chat conversation list | 60 s | unread counts |
| Low stock panel on the dashboard | 5 min | it moves with stock entries, not with time |

Nothing else polls. Report screens, master data lists and every form fetch once
and refetch on invalidation. There is no WebSocket in Phase 1: 30 second polling
across 30 users is roughly 60 requests a minute at peak, which the Railway Hobby
instance absorbs.

## Testing the frontend

Four layers, each with a defined job.

Unit tests, Vitest, no DOM. The formatters (`formatMoney`, `formatQty`,
`formatDate`, `formatTime`, `formatDuration`), every decimal helper including
the `152.500 x 18.83` case as a named test, `currentBusinessDate` across the
03:59 and 04:01 IST boundary and across a month end, the permission hook, and
the query key factory's prefix relationships.

Component tests, Vitest plus Testing Library plus MSW. Each of the twelve
screens in chapter 27 gets a happy path and one error path. The error path is
the one that matters: stock entry with `INSUFFICIENT_STOCK` asserts the message
lands on the quantity input and not in a toast; leave approvals with
`LEAVE_ALREADY_DECIDED` asserts the row disappears; sales entry with a payment
split that does not sum asserts the inline message and that save stays disabled.
`axe-core` runs in the same test file and fails on any serious violation.

MSW holds one handler file per module under `src/test/msw/`, built from the
shared zod schemas so a mock that drifts from the contract fails to type check.
The same handlers run in the browser during local development when
`NEXT_PUBLIC_MSW=1`, which is how a frontend engineer works on the purchase
screen before the purchase endpoint exists.

```ts
// apps/web/src/test/msw/handlers/inventory.ts
export const inventoryHandlers = [
  http.get("*/api/v1/inventory/stock", () =>
    HttpResponse.json({ data: [stockFixture()],
                        meta: { page: 1, pageSize: 25, total: 1 } })),

  http.post("*/api/v1/inventory/transactions", async ({ request }) => {
    const body = RecordTransactionInput.parse(await request.json());
    if (body.type === "ISSUED" && Number(body.quantity) > 12.4) {
      return HttpResponse.json({ error: {
        code: "INSUFFICIENT_STOCK",
        message: "Cannot issue 5.000 KG of Chicken Mince. Only 2.400 KG " +
                 "on hand.",
        details: [{ field: "quantity", issue: "exceeds_on_hand" }],
        requestId: "01JTEST",
      } }, { status: 422 });
    }
    return HttpResponse.json(txnFixture(body), { status: 201 });
  }),
];
```

End-to-end tests, Playwright, against a seeded database and the real API. Six
journeys, no more, because each one costs minutes of CI time and these six are
the ones whose failure means the business cannot operate.

1. Staff completes a checklist. Sign in as `KITCHEN_STAFF`, open the kitchen
   opening checklist from home, mark all eleven items, attach the one required
   photo, submit, and assert the task shows `COMPLETED` on the manager's task
   list.
2. Kitchen manager records a stock issue. Sign in as `KITCHEN_MANAGER`, issue
   5.000 KG of chicken mince, assert the on-hand figure drops from 12.400 to
   7.400 on the current stock screen and a `LOW_STOCK` notification appears for
   the inventory manager.
3. Purchase manager records a purchase. Sign in as `PURCHASE_MANAGER`, enter a
   two line purchase, assert the total, assert the stock went up by both line
   quantities, and assert the price trend chart for one item gained a point.
4. Employee requests leave and a manager approves it. Two browser contexts.
   Assert the requester sees `APPROVED`, the approvals queue empties, and the
   attendance board shows `ON_LEAVE` for the covered date.
5. Store manager enters daily sales. Enter gross, discounts and a four way
   payment split that sums correctly, save, reopen the same date and assert the
   values persisted and the entry is editable inside the 48 hour window.
6. Owner opens the dashboard and drills into wastage. Sign in as `OWNER`,
   switch to "All outlets", assert the four tiles render numbers, click a top
   wastage row and assert `/reports/wastage` opens filtered to that item.

Each journey runs on a Pixel 5 viewport in Playwright's device emulation, not on
a desktop viewport, because that is where the app is used. Journey 6 is the one
exception and runs at 1440 by 900.
