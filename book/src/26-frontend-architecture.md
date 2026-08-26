# Frontend architecture

Most people who use this system are holding an Android phone in one hand, with
wet or floury fingers, on patchy 4G, standing next to a fryer. The owner uses a
laptop. Design for the phone first and let the laptop inherit. Everything below
follows from that sentence.

Concretely, that constraint decides eight things:

1. The primary shell is a bottom navigation bar, not a sidebar.
2. Forms are one column, always, at every breakpoint.
3. Every quantity and money field opens the numeric keypad.
4. Every mutation carries an idempotency key, because a double tap on a slow
   connection is normal behaviour, not user error.
5. A failed submit never clears the form.
6. Lists render skeletons, not spinners, so the layout does not jump when a
   3 second response finally lands.
7. Touch targets are 44 by 44 CSS pixels minimum.
8. Nothing important is hover-only.

The stack is Next.js 15 App Router, React 19, TypeScript, Tailwind 4,
shadcn/ui on Radix primitives, TanStack Query v5 for server state, and
react-hook-form with a zod resolver for forms. The web app is a Railway
service that serves the browser. It is not the API. It holds no database
credential and no service role key.

## Directory layout

```text
apps/web/
  src/
    app/
      layout.tsx                root html, fonts, Tailwind, providers
      globals.css               Tailwind 4 theme block, design tokens
      not-found.tsx
      error.tsx                 root error boundary (client)
      (auth)/                   no shell, centred card, no nav
        layout.tsx
        login/page.tsx
        change-password/page.tsx
      (app)/                    authenticated shell, nav, outlet picker
        layout.tsx              guard + AppShell + QueryProvider
        page.tsx                home, branches on role
        tasks/…
        checklists/[templateCode]/run/page.tsx
        attendance/…
        shifts/…
        leave/…
        inventory/…
        purchase/…
        vendors/…
        employees/…
        sales/…
        reports/…
        chat/…
        broadcast/page.tsx
        notifications/page.tsx
        settings/notifications/page.tsx
        admin/…
      (public)/                 customer facing, no auth, SSR
        layout.tsx
        game/[slug]/page.tsx
        rewards/page.tsx
    components/
      ui/                       shadcn generated primitives, unmodified
      app-shell/                BottomNav, Sidebar, TopBar, OutletSwitcher
      common/                   EmptyState, ErrorState, PageHeader,
                                ConfirmDialog, DataTable, StatusBadge
    features/
      inventory/
        components/             StockEntryForm, StockLevelRow, ItemPicker
        hooks/                  useItemStock, useRecordTransaction
        api/                    inventory.api.ts, queryKeys.ts
        schemas/                re-exports from packages/shared, plus
                                form-only refinements
      tasks/  attendance/  leave/  purchase/  sales/  analytics/  chat/
    lib/
      api/                      fetch wrapper, refresh, error mapping
      auth/                     AuthProvider, useSession, usePermission
      format/                   money, quantity, date, businessDate
      decimal/                  string decimal helpers
      query/                    QueryClient defaults, key factories
    test/
      msw/                      handlers.ts, server.ts, browser.ts
  next.config.ts
  tailwind.config.ts
```

The feature folder convention is the only structural rule that matters day to
day. A feature owns four folders: `components`, `hooks`, `api` and `schemas`.
Route files under `app/` stay thin. A page composes a header and one or two
feature components and does nothing else. When a ticket says "the stock entry
screen rejects a negative quantity", the engineer opens
`features/inventory/schemas`, not `app/(app)/inventory/entry/page.tsx`.

Shared code lives in `components/common` only after a second feature needs it.
One caller is not a shared component.

## Server components and client components

The rule for this app:

| Kind | Rendering | Examples |
|---|---|---|
| Shell, layouts, static copy | Server component | `(app)/layout.tsx`, page headers, the public rewards copy |
| Anything reading live data | Client component + TanStack Query | every list, every board, every dashboard tile |
| Anything taking input | Client component + react-hook-form | every form, every filter bar |
| Public game page | Server component, streamed | `(public)/game/[slug]/page.tsx` |

The app does not do server-side data fetching with cookies for authenticated
screens. The API is a separate Railway service behind bearer auth with a short
access token life. If the Next.js server also fetched on behalf of the user, it
would need the access token, which means either putting the access token in a
cookie readable by the Next server or running a token exchange on every render.
Both add a second place where auth can be wrong. Keeping every authenticated
read in the browser means there is exactly one code path that attaches a token,
exactly one that refreshes it, and exactly one that handles a 401.

The exception is the public game page. It has no user, no token and no private
data. It renders on the server so the first paint is fast on a phone that just
scanned a table QR code, and so the page is indexable. It reads published
`GameConfig` through an unauthenticated endpoint and caches it.

```text
  Authenticated screen                  Public game page
  ────────────────────                  ────────────────
  Server: shell + skeleton              Server: fetch GameConfig
       │                                     │  (cached 60s)
       ▼                                     ▼
  Client: useQuery ──► Bearer ──► API   HTML with rules inlined
       │                                     │
       ▼                                     ▼
  Render data                           Client island: the game canvas
                                             │
                                             ▼
                                        POST /crm/plays (session key)
```

## Auth on the client

The access token lives in memory inside a React context. It is never written to
`localStorage` and never written to a non-httpOnly cookie, so an XSS payload
cannot read it out of storage. The refresh token lives in an httpOnly, Secure,
SameSite=Lax cookie set by the API on `/auth/login`. The browser sends it to
the refresh endpoint and nowhere else, because the cookie path is scoped.

On a hard reload the access token is gone. The app calls refresh once during
boot, gets a new access token plus the current user, and renders. Until that
call settles the shell shows a full-screen skeleton, not a login redirect.

The fetch wrapper attaches the bearer token, catches a 401, refreshes once,
retries the original request once, and on a second failure clears state and
routes to login. The part that gets written wrong on most projects is the
concurrency. A dashboard fires nine queries at once. The token expires. Nine
requests come back 401 at nearly the same instant. A naive wrapper fires nine
refresh calls, and because refresh tokens rotate, eight of them present a token
that has already been consumed. The API sees token reuse, treats it as theft,
revokes the whole family, and the user is thrown to the login screen while
holding a hot pan.

Single-flight refresh fixes it. All concurrent 401s await the same promise.

```ts
// apps/web/src/lib/api/client.ts
import { ApiError, type ErrorEnvelope } from "./errors";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL!; // https://api…/api/v1

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onAuthLost: () => void = () => {};

export function setAccessToken(t: string | null) { accessToken = t; }
export function setAuthLostHandler(fn: () => void) { onAuthLost = fn; }

/** One refresh at a time, no matter how many callers are waiting. */
function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include", // sends the httpOnly refresh cookie
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { accessToken: string };
    accessToken = body.accessToken;
    return true;
  })().finally(() => {
    refreshInFlight = null; // clears only after every waiter resolved
  });
  return refreshInFlight;
}

export type ApiRequest = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

async function send(path: string, req: ApiRequest): Promise<Response> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (req.body !== undefined) headers["Content-Type"] = "application/json";
  if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

  return fetch(url, {
    method: req.method ?? "GET",
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    credentials: "include",
    signal: req.signal,
  });
}

export async function apiFetch(
  path: string,
  req: ApiRequest = {},
): Promise<unknown> {
  let res = await send(path, req);

  if (res.status === 401) {
    const ok = await refreshOnce();
    if (!ok) { accessToken = null; onAuthLost(); throw await toError(res); }
    res = await send(path, req); // exactly one retry
    if (res.status === 401) {
      accessToken = null; onAuthLost(); throw await toError(res);
    }
  }

  if (res.status === 204) return null;
  if (!res.ok) throw await toError(res);
  return res.json();
}

async function toError(res: Response): Promise<ApiError> {
  let env: ErrorEnvelope | null = null;
  try { env = (await res.json()) as ErrorEnvelope; } catch { /* empty */ }
  return new ApiError(res.status, env?.error);
}
```

Two details that are easy to miss. `refreshInFlight = null` runs in `.finally`,
which fires after the promise settles, so every waiter that latched on before
settlement shares the same result. And the retry re-runs `send`, which reads the
module-level `accessToken` again, so the retry uses the new token rather than a
captured stale header.

`onAuthLost` is wired by `AuthProvider` to clear the session, reset the
TanStack Query cache and `router.replace("/login?reason=expired")`.

## Route protection

Two layers, and only one of them is real security.

The `(app)/layout.tsx` guard runs on the client. It reads the session from
`AuthProvider`. While the boot refresh is pending it renders the shell skeleton.
If the refresh failed, it redirects to `/login`. If the user has `mustReset`
set, it redirects to `/change-password` and blocks everything else.

```ts
// apps/web/src/lib/auth/use-permission.ts
import { useSession } from "./session";

export function usePermission(key: string): boolean {
  const { permissions } = useSession();
  return permissions.has(key);
}

export function useAnyPermission(...keys: string[]): boolean {
  const { permissions } = useSession();
  return keys.some((k) => permissions.has(k));
}
```

`permissions` is a `Set<string>` of `module.resource.action` keys returned by
`GET /auth/me` at login and refresh. Components use it to hide controls:

```tsx
{usePermission("inventory.transaction.create") && (
  <Button asChild><Link href="/inventory/entry">Record stock</Link></Button>
)}
```

Hiding is convenience. It stops a kitchen staff member from tapping a button
that would have failed anyway. It is not enforcement. The API is the
enforcement point, and every endpoint checks its permission key in
`PermissionsGuard` regardless of what the browser sent. Anyone can open devtools
and unhide a button. When they submit, they get a 403, and the audit log records
the attempt. See the [RBAC matrix](14-rbac-and-permissions.md).

There is no Next.js middleware auth check, because the middleware has no access
to the in-memory token and the refresh cookie alone does not tell it the role.
Adding a middleware round trip to the API on every navigation would cost more
than it protects.

## Error handling

Every API failure arrives as the same envelope:

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

`ApiError` carries `status`, `code`, `message`, `details` and `requestId`. Three
things happen to it, and which one depends on whether the error points at a
field.

```text
        ApiError thrown by apiFetch
                  │
      ┌───────────┴────────────┐
      │ details[] has a field  │  yes ─► setError() on that form field,
      │ AND a form is mounted  │        focus the first failing input,
      └───────────┬────────────┘        no toast
                  │ no
      ┌───────────┴────────────┐
      │ status >= 500          │  yes ─► toast "Something went wrong on our
      └───────────┬────────────┘        side. Reference ABC123."
                  │ no                  Log requestId to console.
                  ▼
        toast with copy from the code registry,
        falling back to error.message
```

The code registry ([error codes](15-api-conventions.md)) maps a stable
`code` to user-facing copy in `lib/api/error-copy.ts`. A code that is not in the
map falls back to `error.message`, which the API guarantees is safe to display.
Chapter 28 has the copy table for the twelve most common codes.

A 500 never shows the raw message. It shows a generic line plus the
`requestId`, displayed in a monospace span the user can read aloud on the phone.
Support greps the API logs for that id and gets the exact request.

The root `app/error.tsx` is a client error boundary that catches render-time
crashes. It shows a short line, a "Try again" button wired to `reset()`, and a
"Go to home" link. It reports the digest so a production stack can be found in
the Railway logs.

## Loading, empty and error states

List screens render skeletons that match the final layout: same row height,
same number of placeholder rows as the page size, same spacing. A spinner tells
the user something is happening. A skeleton tells them what is about to appear
and stops the layout from jumping when data lands.

Detail screens render a skeleton for the header and a spinner inside any panel
that loads separately.

Buttons that trigger a mutation swap their label for a small inline spinner and
go disabled. They never disappear.

Every list has an `EmptyState`. No illustration, no cartoon. A heading, one
explanatory line in plain words, and one primary action.

```text
  ┌──────────────────────────────┐
  │                              │
  │   No stock entries today     │
  │                              │
  │   Nothing has been received  │
  │   or issued at Saheed Nagar  │
  │   since 4:00 am.             │
  │                              │
  │   ┌────────────────────────┐ │
  │   │     Record stock       │ │
  │   └────────────────────────┘ │
  └──────────────────────────────┘
```

`ErrorState` is the same shape with a "Try again" button bound to
`query.refetch()`.

## Offline and flaky network

There is no service worker in Phase 1. Four measures cover the realistic
failure, which is not "no network" but "network that takes 8 seconds and
sometimes drops the response".

Every mutation sends an `Idempotency-Key` header, a UUID generated once when
the form mounts and reused for every retry of that submission. If the first
POST reached the API and the response was lost, the retry replays the stored
response instead of writing a second stock transaction. The key is regenerated
only after a confirmed success.

Submit buttons disable while `mutation.isPending` is true. This kills the
double tap at the source, but it is a UI courtesy. The idempotency key is the
actual guarantee.

A failed mutation keeps the form state. react-hook-form is not reset on error,
the toast appears above the form, and every value the user typed is still
there. Nothing is retyped. A closing stock form with 20 line items typed on a
phone must never be lost because a 502 came back from the pooler.

Query retries use TanStack Query defaults with an exception: mutations do not
retry automatically. A GET can be retried safely. A POST that moves stock is
retried only when the user taps the button again, with the same idempotency
key.

Full offline mode, meaning a service worker, a local write queue and conflict
resolution on reconnect, is future scope. The reason is cost, not taste. An
offline stock ledger needs client-side balance projection, a replay ordering
rule, and a merge strategy for two devices that both went offline at the same
outlet. That is a multi-week problem on its own and it sits outside a three week
Phase 1. The outlets have Wi-Fi. The failure mode we are actually designing
for is slow, not absent.

## Build and bundle

What ships is a Next.js standalone build running on Node 22 in a Railway
service, serving static assets from the same process. There is no CDN in Phase
1 beyond what Railway provides at the edge.

| Target | Number | Measured on |
|---|---|---|
| First Load JS, shared chunk | under 130 KB gzipped | `next build` output |
| First Load JS, any authenticated route | under 220 KB gzipped | `next build` output |
| Lighthouse performance, `/game/[slug]` | 90 or above | Moto G Power, 4G throttle |
| Lighthouse performance, staff home | 80 or above | Moto G Power, 4G throttle |
| Lighthouse accessibility, all 10 key screens | 95 or above | desktop and mobile |
| Time to interactive, staff home, 4G | under 3.5 s | Lighthouse trace |

Three rules keep those numbers. Chart code is dynamically imported, so a
kitchen staff member never downloads the reports bundle. Icons come from
`lucide-react` with named imports only, never a barrel re-export. Date work uses
`Intl` and small helpers rather than a date library, which is why chapter 29
ships a 40 line business-date helper instead of adding a dependency.

Task proof photos are resized in the browser before upload: longest edge 1600
px, JPEG quality 0.8, which puts a typical kitchen photo at 200 to 400 KB
instead of 4 MB. Display uses `next/image` with explicit `sizes`, and thumbnails
in a task list request a 200 px wide variant. Chapter 29 has the upload flow.

This is an internal tool for 20 to 30 users, so the budget is generous. It is
not unlimited. The person who suffers a 400 KB bundle is a staff member paying
for their own mobile data on a prepaid pack, opening the app 15 times a shift.
