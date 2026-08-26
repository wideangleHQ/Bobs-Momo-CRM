# Internal chat and broadcast

FR-NOTIF-002 is Should-Have. That is the SRS priority and it is not a
formality. Must-Have work is committed against the Rs 45,000 and the three week
timeline. Should-Have work ships if the timeline permits.

So decide the cut order now, before week 3 makes the decision under pressure.

| Feature | Cut order | Why |
|---|---|---|
| Broadcast to outlet, department and all | Keep, last to go | It is the direct replacement for the WhatsApp group the client is trying to leave. It reuses the notification engine, so it is about a day of work |
| Pinned messages | Keep, cheap | One boolean, one filter, one endpoint |
| Direct one to one messages | Cut first | Staff have WhatsApp on their phones and will keep using it for one to one. The system of record argument is weak for a private chat |
| Conversation list with unread counts | Cut with direct messages | It exists to serve direct messages |

If week 3 is tight, ship broadcast only. Broadcast is the part that has a
system-of-record argument: an owner needs to prove that a price change or a
hygiene instruction was sent to every member of an outlet on a given day, and a
WhatsApp group cannot prove that. Direct chat has no such argument.

The rest of this chapter documents the full module. Build it in the cut order
above so that stopping early leaves something coherent.

## The model

`Message` is one table for all four scopes, with nullable target columns and
exactly one of them set.

```prisma
model Message {
  id           String       @id @default(uuid()) @db.Uuid
  scope        MessageScope       // DIRECT OUTLET DEPARTMENT ALL
  senderId     String       @db.Uuid
  recipientId  String?      @db.Uuid   // DIRECT only
  outletId     String?      @db.Uuid   // OUTLET only
  departmentId String?      @db.Uuid   // DEPARTMENT only
  body         String
  isPinned     Boolean      @default(false)
  createdAt    DateTime     @default(now())

  reads MessageRead[]

  @@index([scope, outletId, createdAt])
  @@index([recipientId, createdAt])
}
```

The invariant is enforced in the service and again in the database:

```sql
ALTER TABLE "Message" ADD CONSTRAINT message_scope_target CHECK (
  (scope = 'DIRECT'     AND "recipientId" IS NOT NULL
                        AND "outletId" IS NULL AND "departmentId" IS NULL) OR
  (scope = 'OUTLET'     AND "outletId" IS NOT NULL
                        AND "recipientId" IS NULL AND "departmentId" IS NULL) OR
  (scope = 'DEPARTMENT' AND "departmentId" IS NOT NULL
                        AND "recipientId" IS NULL AND "outletId" IS NULL) OR
  (scope = 'ALL'        AND "recipientId" IS NULL
                        AND "outletId" IS NULL AND "departmentId" IS NULL)
);
```

A check constraint costs nothing and makes a whole class of bug impossible
rather than merely unlikely. A department broadcast that also carries an
`outletId` would appear in two different queries and be counted twice in the
unread badge.

`MessageRead` is a join table with a composite primary key on
`(messageId, userId)` and a `readAt` timestamp. There is no unread table. A
message is unread for a user when no `MessageRead` row exists, which means a
new broadcast is instantly unread for everyone in scope without writing 30
rows.

A pinned message is a shift-long notice. "Fryer 2 is out of service, use fryer
1 for spring rolls." The frontend renders pinned messages in a strip at the top
of the outlet feed, above the chronological list, and they stay there until
somebody unpins them. Pinning is scoped: only OUTLET, DEPARTMENT and ALL
messages can be pinned, because a pinned direct message is just a message.
At most three messages may be pinned per scope target at a time, because a
pin strip with nine notices in it is a wall nobody reads. The fourth pin
returns 422 with `PIN_LIMIT_REACHED`.

## Scopes and permissions

Three permission keys.

| Key | Grants |
|---|---|
| `messaging.direct.send` | Send a DIRECT message to any active user |
| `messaging.broadcast.send` | Send an OUTLET or DEPARTMENT message within the sender's outlet scope |
| `messaging.message.pin` | Pin or unpin a message in a scope the sender can post to |

Who holds what:

| Role | direct.send | broadcast.send | Can broadcast to ALL |
|---|---|---|---|
| OWNER | yes | yes, any outlet | yes |
| OPERATIONS_MANAGER | yes | yes, any outlet | yes |
| STORE_MANAGER | yes | yes, own outlet only | no |
| KITCHEN_MANAGER | yes | yes, own department only | no |
| INVENTORY_MANAGER | yes | no | no |
| PURCHASE_MANAGER | yes | no | no |
| HR_ACCOUNTS | yes | yes, own outlet only | no |
| KITCHEN_STAFF | yes | no | no |
| COUNTER_CASHIER | yes | no | no |

Scope `ALL` is OWNER and OPERATIONS_MANAGER only, and it is a separate check
rather than a permission key of its own. A message to `ALL` reaches every
active user in the business including staff at an outlet the sender has never
visited, which is a different act from telling your own kitchen that the fryer
is broken. Two people in the company should be able to do it.

`OutletGuard` handles the rest. A STORE_MANAGER posting an OUTLET message with
an `outletId` not in their `UserOutlet` rows gets 404, following the rule in chapter 15 that out-of-scope
resources are not confirmed to exist.

> **Spec note:** permission keys `messaging.direct.send`,
> `messaging.broadcast.send`, `messaging.message.read` and
> `messaging.message.pin` are added to the chapter 14 matrix. Error codes
> `MESSAGE_NOT_FOUND`, `PIN_LIMIT_REACHED`, `PIN_NOT_ALLOWED_FOR_SCOPE` and
> `BROADCAST_SCOPE_FORBIDDEN` are added to the chapter 15 registry.

## Delivery

A broadcast emits a `BROADCAST` outbox event inside the same transaction as the
message insert. It then flows through the notification engine like every other
event: recipient resolution expands the scope, preferences apply, the
`broadcast_message` template renders, and the message can reach WhatsApp.

```text
  POST /messages/broadcast
        │
        ▼
  ┌──────────────────────────────────────────────────────┐
  │ MessagingService.broadcast()   ONE $transaction      │
  │   1. INSERT Message (scope, target, body)            │
  │   2. INSERT OutboxEvent (BROADCAST, PENDING)         │
  └────────────────────────┬─────────────────────────────┘
                           │ COMMIT
                           ▼
              OutboxDispatcher, next 15s tick
                           │
              resolve scope -> user ids, minus sender
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
     Notification IN_APP           Notification WHATSAPP
     (bell badge)                  (if the user has not
                                    muted BROADCAST)
```

A direct message emits nothing. It writes the `Message` row and one
`Notification` row of channel `IN_APP` for the recipient, directly, in the same
transaction. No outbox, no WhatsApp.

The reasoning is about noise and about cost. A broadcast is a deliberate act by
a manager who has decided that everyone in a scope needs to know something now.
Pushing that to WhatsApp is the point: it is what replaces the WhatsApp group.
A direct message is conversational, and pushing every line of a back and forth
to WhatsApp would send the same information twice to the same phone, which is
how people learn to mute an app. It would also multiply the WhatsApp bill by
the chattiness of the staff, which is not a variable anyone wants in the budget.

Users who want WhatsApp for direct messages already have WhatsApp.

A user can mute `BROADCAST` on WhatsApp through the notification preferences in
[Notification engine](21-notification-engine.md). They cannot mute it in-app,
because a broadcast the manager can prove was delivered is the whole point of
the feature.

## Read tracking and unread counts

Marking read is an upsert on the composite key, which makes it idempotent:

```sql
INSERT INTO "MessageRead" ("messageId", "userId", "readAt")
VALUES ($1, $2, now())
ON CONFLICT ("messageId", "userId") DO NOTHING;
```

The unread count for one user across all conversations:

```sql
SELECT count(*)
FROM   "Message" m
WHERE  m."createdAt" > now() - interval '30 days'
  AND  (
        m."recipientId" = $userId
     OR (m.scope = 'OUTLET'     AND m."outletId" = ANY($outletIds))
     OR (m.scope = 'DEPARTMENT' AND m."departmentId" = $departmentId)
     OR  m.scope = 'ALL'
  )
  AND  m."senderId" <> $userId
  AND  NOT EXISTS (
        SELECT 1 FROM "MessageRead" r
        WHERE  r."messageId" = m.id AND r."userId" = $userId
  );
```

Three things make this cheap. The `NOT EXISTS` correlates on both columns of
the `MessageRead` primary key, so it is an index-only lookup per candidate row,
not a scan. The 30 day window bounds the candidate set: nobody has an unread
count that reaches back to launch, and a message unread for a month is not
going to be read. And `@@index([scope, outletId, createdAt])` serves the outlet
branch while `@@index([recipientId, createdAt])` serves the direct branch.

The per-conversation count for the conversation list is the same predicate
grouped by the conversation key, computed in one pass rather than one query per
conversation.

The count is cached in Redis for 15 seconds per user, keyed
`bm:prod:msg:unread:{userId}`, and deleted on any insert into `Message` in a
scope that user belongs to, or on any `MessageRead` write by that user.

## Transport

Polling. 15 seconds while a conversation view is open, 60 seconds otherwise for
the badge, both through TanStack Query `refetchInterval`, plus a refetch on
window focus. No websockets in Phase 1.

The honest reasoning, in order of weight:

Railway Hobby restarts the container on every deploy and on plan-level
maintenance. A websocket dies on each of those, so the client needs
reconnection with backoff, and the server needs to handle a reconnect storm
when thirty clients come back at once. That is real code with real bugs, and it
is code that only fails in production.

There is one small instance. A websocket server holds a connection per client,
and NestJS gateways with Socket.IO add a dependency, an adapter, and a second
authentication path because the JWT has to be validated at handshake rather
than per request. Sticky sessions become a requirement the moment there is a
second replica, which the caching chapter already wants to avoid needing.

There are thirty users. Thirty clients polling a cached endpoint every 15
seconds is two requests per second at the absolute peak, served from Redis.
That is not a load problem, it is a rounding error.

And this is a Should-Have. Spending two days on transport for a feature that
might get cut is the wrong allocation in a three week build.

The upgrade path, if the client asks for instant chat later, is server-sent
events rather than websockets. One `GET /messages/stream` endpoint returning
`text/event-stream`, authenticated with the same bearer token as every other
request, no new protocol, no new library, and the browser's `EventSource`
reconnects on its own. The read model does not change: SSE would push an
invalidation signal and the client would refetch the same endpoints it polls
today. That keeps the change to one endpoint and one hook.

## Endpoint reference

All endpoints are under `/api/v1` and require a bearer token.

### GET /messages/conversations

Permission: `messaging.message.read`

Returns the caller's conversation list: every DIRECT thread they are part of,
plus one pseudo-conversation per broadcast scope they belong to.

```json
{
  "data": [
    {
      "key": "direct:8c1f...",
      "scope": "DIRECT",
      "title": "Ramesh Sahoo",
      "lastMessage": "Fryer oil changed, photo on the task",
      "lastMessageAt": "2026-08-26T11:02:41.000Z",
      "unreadCount": 2
    },
    {
      "key": "outlet:3a9d...",
      "scope": "OUTLET",
      "title": "BM-SAHEED",
      "lastMessage": "Closing early today, 22:00",
      "lastMessageAt": "2026-08-26T09:40:00.000Z",
      "unreadCount": 0,
      "pinnedCount": 1
    }
  ]
}
```

Not paginated. The list is bounded by the number of outlets and departments a
user belongs to plus the people they have messaged.

### GET /messages

Permission: `messaging.message.read`

Query: `?scope=OUTLET&outletId=...&page=1&pageSize=50`, or
`?scope=DIRECT&withUserId=...`, or `?pinned=true` to fetch only the pin strip.

Returns messages newest first, with sender name denormalised into the response
so the client does not need a second call.

Returns 404 with `MESSAGE_NOT_FOUND` if the caller is not a member of the
requested scope.

### POST /messages

Permission: `messaging.direct.send`

```json
{ "recipientId": "8c1f2e3d-...", "body": "Can you cover the 6pm shift?" }
```

Returns 201 with the created message. Body is 1 to 2,000 characters. Sending to
a suspended or disabled user returns 422 with `RECIPIENT_NOT_ACTIVE`.

### POST /messages/broadcast

Permission: `messaging.broadcast.send`

```json
{
  "scope": "OUTLET",
  "outletId": "3a9d1b2c-...",
  "body": "Fryer 2 is out of service until Thursday. Use fryer 1 for rolls.",
  "pin": true
}
```

Returns 201. Emits one `BROADCAST` outbox event. `scope: "ALL"` with any role
other than OWNER or OPERATIONS_MANAGER returns 403 with
`BROADCAST_SCOPE_FORBIDDEN`. An `outletId` outside the sender's scope returns
404.

The response includes `recipientEstimate`, the count the resolver will expand
to, so the UI can show "this will notify 14 people" on the confirm step. It is
an estimate because preferences are applied later.

### POST /messages/:id/read

Permission: `messaging.message.read`

No body. Idempotent upsert. Returns 204. Returns 404 if the message is not in a
scope the caller belongs to.

### POST /messages/:id/pin

Permission: `messaging.message.pin`

```json
{ "pinned": true }
```

Returns 200 with the updated message. Returns 422 with
`PIN_NOT_ALLOWED_FOR_SCOPE` for a DIRECT message and `PIN_LIMIT_REACHED` when
three messages are already pinned in that scope target.

### GET /messages/unread-count

Permission: `messaging.message.read`

```json
{ "count": 3 }
```

Cached 15 seconds per user. This is the endpoint the 60 second badge poll hits.

| Error | Status | When |
|---|---|---|
| `MESSAGE_NOT_FOUND` | 404 | id unknown, or scope the caller is not in |
| `BROADCAST_SCOPE_FORBIDDEN` | 403 | scope ALL without OWNER or OPERATIONS_MANAGER |
| `RECIPIENT_NOT_ACTIVE` | 422 | direct message to a suspended or disabled user |
| `PIN_LIMIT_REACHED` | 422 | fourth pin in one scope target |
| `PIN_NOT_ALLOWED_FOR_SCOPE` | 422 | pin attempted on a DIRECT message |
| `VALIDATION_FAILED` | 400 | body empty or over 2,000 characters |

## Retention

Messages are kept indefinitely in Phase 1. Nothing deletes them, no job
archives them, and there is no UI to remove one.

The arithmetic makes this a non-issue for years. Thirty users generating an
optimistic 200 messages a day is 73,000 rows a year at roughly 300 bytes each,
so about 22 MB annually against an 8 GB Supabase Pro database. `MessageRead`
grows faster because a broadcast to 30 people can produce 30 rows, but those
rows are 40 bytes.

A retention policy, when it is eventually wanted, would be a delete of DIRECT
messages older than 12 months with their `MessageRead` cascade, keeping
broadcasts permanently because those are the ones with a compliance argument.
It is deferred because deletion is the one operation with no undo, the client
has not asked for it, storage is not a constraint, and a retention job that
misfires destroys the system of record this module exists to be. Adding it
later costs one job. Adding it now costs the same and risks data.

## What this module is not

No file or photo sharing. Task proof photos have a home in `TaskAttachment`
with Supabase Storage behind it, and that is where operational evidence
belongs, attached to the task it proves. A photo in a chat thread is
unfindable a week later.

No user-created groups. The scopes are outlet, department and everyone, and
those come from the org structure, which means membership is always correct and
nobody has to remember to add the new hire to six groups.

No threads, no replies, no reactions. A flat chronological feed per scope.

No editing or deleting a sent message. This is the system of record. A manager
who broadcast the wrong closing time sends a correction, and both messages stay
in the log. Editable history is not a record.

No read receipts shown to the sender. `MessageRead` exists to compute the
reader's own unread badge, not to tell a manager who has and has not opened a
notice. Turning it into a surveillance feature changes the social contract of
the app and was not asked for.

The point of this module is that operational chatter has a system of record.
The client is not moving off WhatsApp because WhatsApp is a bad chat product.
They are moving because a WhatsApp group cannot answer "what was the closing
instruction on the 14th" three weeks later. This module answers that. It is not
trying to be a better chat app than WhatsApp, and any feature request that
starts with "WhatsApp has..." should be measured against that sentence.

## Failure modes

| Failure | How you notice | Effect | Response |
|---|---|---|---|
| Broadcast resolver returns everyone including the sender | Sender gets their own notification | Confusing, looks broken | Resolver excludes `senderId`, covered by test |
| Unread count query slows as `Message` grows | Endpoint p95 climbs past 250ms | Badge poll gets expensive at 30 users a minute | 30 day window bounds the scan, Redis absorbs the rest |
| A user changes outlet | Old outlet broadcasts vanish from their feed | Correct, but surprising to the user | Documented behaviour, feed is membership-based not history-based |
| Broadcast to ALL sent by mistake | 30 WhatsApp messages | Cost and noise, unrecallable | Confirm step shows `recipientEstimate`, scope ALL limited to two roles |
| Outbox dispatcher down | Broadcast stored, nobody notified | Message exists in the feed but no push | Same detection as the notification engine, the `Message` row is never lost |
| Pin strip filled with stale notices | Users stop reading it | Feature decays | Three pin limit per scope target |
| Direct message to a departed employee | Message sits unread forever | Sender thinks it was seen | `RECIPIENT_NOT_ACTIVE` blocks it at send time |

## Test plan

Unit:

1. The scope invariant. Building a DIRECT message with an `outletId` throws
   before reaching Prisma, and the check constraint rejects it if it somehow
   does.
2. Broadcast resolution excludes the sender. Seed a Store Manager with an
   outlet of five staff, assert the resolver returns four ids.
3. `ALL` scope from a STORE_MANAGER throws `BROADCAST_SCOPE_FORBIDDEN`, from an
   OWNER it does not.
4. Pin limit: the fourth pin in one scope target throws `PIN_LIMIT_REACHED`.

Integration:

5. `POST /messages/broadcast` writes exactly one `Message` and one
   `OutboxEvent` with `eventKey = 'BROADCAST'`, in one transaction. Force the
   outbox insert to fail and assert no `Message` row survives.
6. `POST /messages` writes one `Message` and one `IN_APP` `Notification` and
   zero `OutboxEvent` rows. This is the test that pins the direct-message-does-
   not-go-to-WhatsApp decision.
7. Running the dispatcher after a broadcast produces one notification per scope
   member, none for the sender.
8. `POST /messages/:id/read` called twice produces one `MessageRead` row and
   returns 204 both times.
9. The unread count drops by one after a read and is served from cache on the
   second call within 15 seconds, then reflects a new message after the TTL.

End to end:

10. A STORE_MANAGER at BM-SAHEED requesting `GET /messages?scope=OUTLET` for
    BM-PATIA receives 404, not 403, and the response body contains no evidence
    that BM-PATIA exists.
11. A KITCHEN_STAFF user calling `POST /messages/broadcast` receives 403.
12. A message body of 2,001 characters returns 400 with `VALIDATION_FAILED`.
