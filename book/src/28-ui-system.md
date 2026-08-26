# UI system and mobile design

The visual language has one job: be readable at arm's length, in a hot kitchen,
on a 5.5 inch screen with a fingerprint smudge across it. Warm enough to belong
to a food business, high contrast enough to pass WCAG AA everywhere, and boring
enough that nobody has to learn it.

## Colour tokens

Every text colour listed here meets WCAG 2.1 AA on its stated background: 4.5:1
for body text, 3:1 for large text and for the boundary of any control the user
has to find. Ratios below are computed, not estimated.

| Token | Hex | Role | On | Ratio |
|---|---|---|---|---|
| `--color-bg` | `#FAFAF9` | page background | n/a | n/a |
| `--color-surface` | `#FFFFFF` | cards, sheets, inputs | n/a | n/a |
| `--color-text` | `#1C1917` | body and headings | surface | 17.5:1 |
| `--color-text-muted` | `#57534E` | labels, hints, meta | surface | 7.6:1 |
| `--color-border` | `#E7E5E4` | dividers, card edges | surface | decorative |
| `--color-border-strong` | `#78716C` | input and control outlines | surface | 4.8:1 |
| `--color-primary` | `#C2410C` | primary buttons, links, active nav | surface | 5.2:1 |
| `--color-primary-fg` | `#FFFFFF` | text on primary | primary | 5.2:1 |
| `--color-success` | `#15803D` | completed, approved, present | surface | 5.0:1 |
| `--color-success-bg` | `#DCFCE7` | success badge fill | with success text | 4.6:1 |
| `--color-warning` | `#B45309` | pending, low stock, late | surface | 5.0:1 |
| `--color-warning-bg` | `#FEF3C7` | warning badge fill | with warning text | 4.9:1 |
| `--color-danger` | `#B91C1C` | destructive, failed, rejected | surface | 6.5:1 |
| `--color-danger-bg` | `#FEE2E2` | danger badge fill | with danger text | 5.9:1 |
| `--color-info` | `#0369A1` | informational, neutral status | surface | 5.9:1 |
| `--color-info-bg` | `#E0F2FE` | info badge fill | with info text | 5.4:1 |

`--color-border` is light and is used only for dividers and card edges, which
WCAG treats as decorative. Anything the user has to locate and touch gets
`--color-border-strong`: input outlines, unselected radio and checkbox borders,
the focus ring base. On a phone in a bright kitchen a 1.3:1 hairline border
disappears, so inputs here look heavier than the shadcn default.

Tailwind 4 reads the tokens from a `@theme` block, which generates the utility
classes:

```css
/* apps/web/src/app/globals.css */
@import "tailwindcss";

@theme {
  --color-bg:            #FAFAF9;
  --color-surface:       #FFFFFF;
  --color-text:          #1C1917;
  --color-text-muted:    #57534E;
  --color-border:        #E7E5E4;
  --color-border-strong: #78716C;
  --color-primary:       #C2410C;
  --color-primary-fg:    #FFFFFF;
  --color-success:       #15803D;
  --color-success-bg:    #DCFCE7;
  --color-warning:       #B45309;
  --color-warning-bg:    #FEF3C7;
  --color-danger:        #B91C1C;
  --color-danger-bg:     #FEE2E2;
  --color-info:          #0369A1;
  --color-info-bg:       #E0F2FE;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
}
```

`bg-primary`, `text-text-muted`, `border-border-strong` and the rest come out of
that block automatically. No colour is written as a raw hex anywhere in a
component.

## Typography

One family: Inter, loaded through `next/font/google` with `display: "swap"` and
a system fallback stack. Tabular numerals are switched on for every column of
quantities and money, so digits line up down a table.

| Token | Size / line height | Tailwind | Used for |
|---|---|---|---|
| Display | 30px / 36px, 600 | `text-3xl font-semibold` | dashboard tile values |
| H1 | 24px / 32px, 600 | `text-2xl font-semibold` | page titles |
| H2 | 20px / 28px, 600 | `text-xl font-semibold` | section headings |
| H3 | 16px / 24px, 600 | `text-base font-semibold` | card titles, list row titles |
| Body | 16px / 24px, 400 | `text-base` | everything readable |
| Body small | 14px / 20px, 400 | `text-sm` | meta lines, table cells |
| Caption | 12px / 16px, 500 | `text-xs font-medium` | badges, timestamps, hints |
| Numeric | inherit, `font-variant-numeric` | `tabular-nums` | any quantity or money |

Body text is never smaller than 14px, and the only 12px text in the app is
inside badges and timestamps where the surrounding context carries the meaning.
Nothing important is 12px.

## Spacing, radius and shadow

The spacing scale is Tailwind's default 4px step, restricted to eight values so
layouts stay predictable.

| Step | Value | Tailwind | Used for |
|---|---|---|---|
| 1 | 4px | `gap-1`, `p-1` | icon to label |
| 2 | 8px | `gap-2`, `p-2` | inside a badge, between chips |
| 3 | 12px | `gap-3`, `p-3` | list row padding |
| 4 | 16px | `gap-4`, `p-4` | card padding, screen gutter on mobile |
| 6 | 24px | `gap-6`, `p-6` | between sections, card padding on desktop |
| 8 | 32px | `gap-8`, `py-8` | page top and bottom padding |
| 12 | 48px | `py-12` | empty state vertical padding |
| 16 | 64px | `pb-16` | bottom padding above the nav bar |

| Token | Value | Tailwind | Used for |
|---|---|---|---|
| `--radius-sm` | 4px | `rounded-sm` | badges, chips |
| `--radius-md` | 8px | `rounded-md` | inputs, buttons, list rows |
| `--radius-lg` | 12px | `rounded-lg` | cards, sheets, dialogs |
| `--radius-full` | 9999px | `rounded-full` | avatars, status pills |

Three shadows, and one of them is used once.

| Token | Value | Tailwind | Used for |
|---|---|---|---|
| Card | `0 1px 2px rgb(0 0 0 / 0.05)` | `shadow-sm` | cards, list containers |
| Sticky bar | `0 -1px 3px rgb(0 0 0 / 0.08)` | custom `shadow-bar` | bottom nav, sticky submit bar |
| Overlay | `0 10px 25px rgb(0 0 0 / 0.15)` | `shadow-xl` | dialogs, sheets, popovers |

## Component inventory

Used as generated by the shadcn CLI, with no edits beyond the token swap:
Button, Input, Label, Textarea, Checkbox, RadioGroup, Switch, Select, Dialog,
Sheet, Popover, Command, Tabs, Card, Badge, Separator, Skeleton, Tooltip,
Avatar, Progress, ScrollArea, Alert, Calendar, and Sonner for toasts.

Wrapped because the default is not enough:

| shadcn base | Wrapper | Why |
|---|---|---|
| Form | `<Form>` | binds react-hook-form context, renders `details[]` server errors under the right field |
| Table | `DataTable` | server-side pagination, sort state in the URL, mobile card fallback |
| Button | `Button` | adds a `pending` prop that swaps the label for a spinner and disables |
| Toast | `toast.*` helpers | force the copy through the error code map |
| Calendar | `DateRangePicker` | enforces a maximum span |

Custom components shadcn does not provide:

```ts
type OutletSelectorProps = {
  value: string | null;
  onChange: (outletId: string) => void;
  /** adds an "All outlets" option, OWNER and OPERATIONS_MANAGER only */
  allowAll?: boolean;
  /** renders as static text when the user has exactly one outlet */
  disabled?: boolean;
};

type QuantityInputProps = {
  value: string;            // decimal string, never a number
  onChange: (v: string) => void;
  unitCode: string;         // "KG", "PCS" rendered as a suffix chip
  max?: string;
  precision?: 0 | 3;        // 3 for quantity, 2 for money via MoneyInput
  hint?: string;            // "On hand: 12.400 KG"
  error?: string;
};

type ItemPickerProps = {
  value: string | null;
  onChange: (itemId: string) => void;
  outletId: string;         // scopes the on-hand hint
  /** shows the 8 most recently used items before the user types */
  recentFirst?: boolean;
  categoryId?: string;
  disabledItemIds?: string[]; // already on the purchase form
};

type DateRangePickerProps = {
  from: string | null;      // YYYY-MM-DD
  to: string | null;
  onChange: (r: { from: string; to: string }) => void;
  maxSpanDays: number;      // 92 on reports, 31 on the ledger
  maxDate?: string;         // defaults to today's business date
};

type StatusBadgeProps = {
  kind: "task" | "leave" | "purchase" | "purchaseRequest"
      | "attendance" | "reward" | "shift";
  value: string;            // the enum member, e.g. "IN_PROGRESS"
};

type TaskCardProps = {
  task: TaskListItem;
  showAssignee?: boolean;   // false on my-tasks, true on the manager list
  onOpen: (id: string) => void;
};

type ChecklistItemRowProps = {
  item: ChecklistTemplateItem;
  result: ChecklistItemResult | null;
  note: string;
  attachmentId: string | null;
  saving: boolean;
  onResult: (r: ChecklistItemResult) => void;
  onNote: (n: string) => void;
  onPhoto: (attachmentId: string) => void;
};

type AttendanceStatusPillProps = {
  status: AttendanceStatus;
  onBreakSince?: string;    // ISO timestamp, renders a live break counter
};

type DataTableProps<T> = {
  columns: ColumnDef<T>[];
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (s: { key: string; dir: "asc" | "desc" }) => void;
  /** rendered instead of the table below the md breakpoint */
  mobileRow: (row: T) => React.ReactNode;
  emptyState: React.ReactNode;
  loading: boolean;
};

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;     // the verb, never "OK"
  destructive?: boolean;
  /** when set, the user must type a reason before confirm enables */
  requireReason?: { label: string; minLength: number };
  onConfirm: (reason?: string) => Promise<void>;
};

type PhotoUploadProps = {
  taskId: string;
  value: string[];          // attachment ids
  onChange: (ids: string[]) => void;
  max?: number;             // default 3
  required?: boolean;
};

type EmptyStateProps = {
  title: string;
  description: string;
  action?: { label: string; href: string } | { label: string;
             onClick: () => void };
};

type ErrorStateProps = {
  title?: string;           // defaults to "Could not load this"
  message: string;
  requestId?: string;
  onRetry: () => void;
};

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  actions?: React.ReactNode;
  /** sticky on scroll for list screens, static on forms */
  sticky?: boolean;
};
```

`StatusBadge` takes the enum member and looks up label plus colour in one map,
so a new `TaskStatus` value fails to compile until somebody adds its copy. No
component ever switches on a status string inline.

## Mobile rules

These are requirements, not preferences. A pull request that breaks one of them
is rejected.

Minimum touch target is 44 by 44 CSS pixels, including the tappable padding
around a small icon. Buttons are `h-11` (44px) by default and `h-12` (48px) for
a screen's primary action.

Navigation lives at the bottom. There are no top tabs anywhere in the app,
because the top of a 6 inch screen needs a second hand.

The primary action of every screen is reachable in the bottom third. On forms
this means a sticky submit bar. On lists it means a floating or bottom-docked
button.

Forms are a single column at every breakpoint. Two fields sit side by side only
when both are short and paired by meaning (from date and to date, outlet and
date), and even then they stack below 400px.

Every quantity and money field sets `inputMode="decimal"`, every count field
sets `inputMode="numeric"`, and every phone field sets `inputMode="tel"`. A
staff member should never have to switch keyboard modes to type 12.400.

Nothing is hover-only. Every action available on hover on a desktop row is also
present as a visible control or inside a row overflow menu on mobile.

The page body never scrolls horizontally. Wide content lives inside its own
`overflow-x-auto` container: tables, the filter chip strip, chart axes. The
container gets a visible edge fade so it is obvious there is more to the right.

Any form taller than one screen gets a sticky submit bar carrying the primary
button and, where it exists, the running total or projected balance. The stock
entry and purchase record screens both do.

## Accessibility baseline

Every input has a `<label>` bound by `htmlFor`, not a placeholder pretending to
be a label. Placeholders disappear the moment the user types, which is exactly
when a distracted person needs the label.

Focus is always visible: a 2px `--color-primary` ring with a 2px offset,
applied through `focus-visible`, never removed with `outline: none`.

Dialogs and sheets are Radix primitives, so focus trapping, Escape to close and
`aria-modal` come for free. The rule is that no team member hand-rolls a modal.

Toasts render into an `aria-live="polite"` region. Destructive confirmations use
`aria-live="assertive"`.

Colour is never the only signal. Low stock has an icon and the word "Low". A
failed checklist item has the word FAIL in the button state, not just a red
tint. Task priority carries a text label next to any colour.

The target is a clean axe-core run, zero serious or critical violations, on the
ten most used screens: staff home, tasks, task detail, checklist run,
attendance, attendance board, current stock, stock entry, leave approvals and
the owner dashboard. Chapter 29 wires axe into the component test setup so a
violation fails CI rather than waiting for a manual audit.

## Language and copy

English only in Phase 1. Staff speak Odia and Hindi day to day, and a
translation layer is real work: string extraction, a locale switch, and someone
to translate 400 strings. It is future scope. The copy rules below are what make
that translation cheap when it happens.

Plain words beat correct-sounding words. "Record stock" not "Submit inventory
transaction". "Ask for stock" not "Raise a procurement requisition".

The glossary exists so the same concept is not called three things across three
screens:

| Use this | Never use | Meaning |
|---|---|---|
| Issue | Consume, deduct, use up | Stock leaving the store for the kitchen |
| Receive | Restock, inward, GRN | Stock arriving from a vendor |
| Wastage | Waste, spoilage, loss | Stock thrown away, with a reason |
| Adjustment | Correction, reconcile | A manual fix to a wrong balance |
| On hand | Current stock, available, balance | `ItemStock.qtyOnHand` right now |
| Punch in / Punch out | Check in, clock in, sign in | Recording arrival and departure |
| Break | Rest, pause, off-floor | A logged interval inside a shift |
| Leave | Off, holiday, absence | A `LeaveRequest` |
| Outlet | Store, branch, location | One of the two shops |
| Item | Product, SKU, material | An `InventoryItem` |
| Vendor | Supplier, party | A `Vendor` |
| Task | Job, to-do, activity | A `Task` |
| Checklist | SOP, form, audit sheet | A `ChecklistTemplate` run |

Error copy is written for a kitchen worker. It says what went wrong, in what
units, and what to do next. It never names a table, a field type, an HTTP verb
or a stack frame.

> **Spec note:** the codes below are the ones the frontend maps
> today. Chapter 15 owns the full registry. A code missing from this map falls
> back to `error.message` from the envelope, which the API guarantees is safe
> to display.

| Code | Status | Copy shown | Where |
|---|---|---|---|
| `INSUFFICIENT_STOCK` | 422 | Only 2.400 KG of Chicken mince is on hand. Reduce the quantity or record a receipt first. | quantity field |
| `VALIDATION_FAILED` | 400 | Check the highlighted fields and try again. | per field from `details[]` |
| `INVALID_CREDENTIALS` | 401 | That username or password is not right. | login form |
| `ACCOUNT_LOCKED` | 423 | This account is locked after too many tries. Ask your manager to unlock it. | login form |
| `SESSION_EXPIRED` | 401 | You were signed out. Sign in again to continue. | full-page redirect |
| `FORBIDDEN` | 403 | You do not have access to this. | toast |
| `NOT_FOUND` | 404 | This is not available at your outlet. | full-page state |
| `LEAVE_OVERLAP` | 409 | You already have leave on these dates. | from-date field |
| `LEAVE_ALREADY_DECIDED` | 409 | This request was already decided. Refreshing the list. | toast, list refetch |
| `PUNCH_SEQUENCE_INVALID` | 409 | You are already punched in. Pull down to refresh. | toast |
| `SALES_ENTRY_LOCKED` | 409 | This day is locked. Ask the owner to reopen it. | inline above submit |
| `RATE_LIMITED` | 429 | Too many tries. Wait a minute and try again. | toast |

Anything 500 or above shows one line, always the same one: "Something went
wrong on our side. Nothing you typed was lost. Reference `01JK8Y3M`." The
reference is the `requestId` in a selectable monospace span.

## Numbers, money and dates

Everything renders in Asia/Kolkata regardless of the device timezone. A phone
whose clock is set to Dubai still shows the Indian business date. The formatters
below are the only place a timezone appears.

Money uses Indian digit grouping and the rupee sign immediately before the
digits with no space: `₹1,23,456.78`. The ASCII wireframes in chapter 27 write
`Rs ` because a box-drawing diagram cannot carry the glyph reliably. The
components use the sign.

Quantities show up to three decimals with trailing zeros trimmed, so 12.400
reads as 12.4 and 5.000 reads as 5. The one exception is a column of
quantities: the stock ledger, the stock entry hint and the closing count screen
pad to exactly three decimals so decimal points line up. Both variants exist.

Dates are `26 Aug 2026`. Times are `9:04 am`, lowercase, no leading zero on the
hour. Never `09:04 AM`, never `2026-08-26` outside a URL query.

```ts
// apps/web/src/lib/format/index.ts
const IST = "Asia/Kolkata";

// Display-only parsing. Number() is safe here because no arithmetic
// follows. Arithmetic on a decimal string goes through lib/decimal.
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(v: string | number): string {
  return inr.format(typeof v === "string" ? Number(v) : v);
}

/** 12.400 -> "12.4", 5.000 -> "5", 0.125 -> "0.125" */
export function formatQty(v: string | number): string {
  const s = typeof v === "number" ? v.toFixed(3) : v;
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Column-aligned variant. 12.4 -> "12.400" */
export function formatQtyExact(v: string | number): string {
  return (typeof v === "number" ? v : Number(v)).toFixed(3);
}

export function formatQtyWithUnit(v: string, unitCode: string): string {
  return `${formatQty(v)} ${unitCode}`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "2026-08-26" or a UTC ISO timestamp -> "26 Aug 2026" */
export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: IST,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** UTC ISO timestamp -> "9:04 am". Built from parts because some ICU
 *  builds insert U+202F before the day period. */
export function formatTime(iso: string): string {
  const parts = timeFmt.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

/** "3h 26m", "26m", "0m" */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

Chapter 29 owns the business-date helper, because it is data-layer behaviour
rather than presentation.

## Dark mode

Not in Phase 1. Nobody asked for it and a second palette doubles the contrast
checking. The token structure makes it additive rather than a rewrite: every
colour is a CSS custom property on `:root` and no component contains a hex
value, so dark mode is a second `@theme` block under
`@media (prefers-color-scheme: dark)` plus one contrast pass. Nothing in
`components/` changes. That is the reason for the token indirection.

## Print and export

Report screens export CSV through the API, not through the browser. The screen
holds one page of 25 rows; the export needs all 1,400. The button calls the same
endpoint with `?format=csv` and the filters already in the URL, and the API
streams `text/csv` with a `Content-Disposition` filename like
`wastage-BM-SAHEED-2026-08-01-to-2026-08-26.csv`. The client fetches the blob
with its bearer token and triggers a download from an object URL.

```ts
export async function downloadCsv(path: string, query: Record<string, string>,
                                  filename: string) {
  const q = { ...query, format: "csv" };
  const blob = await apiFetchBlob(path, { query: q });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

CSV is written with a UTF-8 BOM so Excel on Windows opens Odia and Hindi vendor
names without mangling them, decimals as plain strings with a dot separator and
no thousands grouping, and dates as `YYYY-MM-DD` so a spreadsheet sorts them.
The pretty formatting from this chapter is for screens, not for files another
program is going to parse.

The daily summary needs to leave the system as a PDF, because the owner shares
it on WhatsApp. There is no PDF library. `/reports/sales?date=` has a print
stylesheet: `@media print` hides the nav, the filters and every button, forces
`--color-bg` to white, expands the tables past their scroll containers, and sets
`@page { size: A4 portrait; margin: 12mm }`. The user taps "Print" and picks
"Save as PDF", which is a built-in print target on both Android Chrome and
desktop. The resulting file is shareable from the same sheet.

That is one CSS block instead of a headless Chrome process on Railway and a
font bundle. If Phase 2 needs a PDF mailed on a schedule rather than saved by a
human, the job moves server side and this stylesheet becomes its template.
