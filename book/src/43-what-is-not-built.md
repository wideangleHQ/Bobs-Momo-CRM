# What is not built

Everything the SRS commits to as a Must-Have is implemented. This chapter is the
list of what is deliberately not, and why. It exists so the gaps are written
down before UAT rather than discovered during it, and it is the starting point
for the Phase 2 conversation.

Each item says what would be needed to close it, so nobody has to re-derive that
in a meeting.

## Blocked on something outside the codebase

**Task and checklist photo upload.** `POST /tasks/:id/attachments` records the
metadata: storage key, MIME type, size, who uploaded it. It does not upload
anything, because Supabase Storage was never provisioned. The checklist items
that ask for a photo record the pass or fail correctly and carry no image.

To close it: create the storage bucket, set `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY`, and add a signed-upload-URL endpoint. The client already
posts to the attachment route and will PUT to an `uploadUrl` if the response
carries one. Roughly half a day once the bucket exists.

**WhatsApp delivery.** The adapter, the template catalogue, the webhook and the
signature check are all built and tested. Nothing has been sent, because message
templates need Meta approval and the Business account does not exist yet. With
`WHATSAPP_ENABLED=false` the system uses a null adapter and every notification
still lands in-app.

To close it: the client creates the Meta Business account, grants access, and
templates get submitted. Approval takes days that nobody on the team controls,
which is why chapter 42 asks for this in week 1 rather than week 3.

## Deliberately out of Phase 1

**Payroll computation.** Salary is stored, effective-dated, and restricted to HR
and the owner. There are no payslips, no attendance-linked pay, no statutory
deductions. That is decision 4 in chapter 04 and it needs its own specification
for the deduction rules before it can be estimated.

**Message pinning.** Chapter 23 describes pinning a message in a channel. There
is no permission key for it in the chapter 14 matrix, so it is not built. Adding
it is a matrix row and about two hours, but the matrix is the contract and it
does not get edited quietly.

**A second approval level on purchase requests.** FR-PUR-001 says one manager
decision and the out-of-scope section says it again. The place this will try to
come back is a "high value requests need owner sign-off" threshold, which sounds
free and is not: it needs a threshold config, a second decider role, a second
notification, a partially-approved state and a screen for all of it.

**Biometric and photo attendance.** Hardware is excluded by the SRS. A selfie on
punch was considered and rejected in chapter 42: it slows the most frequently
used action in the system by several seconds on a phone in a kitchen, and
manager punch edits are already attributed and audited.

## Known ceilings

These work correctly now and will need attention if the business grows past two
outlets.

**Reports run in application memory.** Consumption, wastage and performance
query with Prisma `groupBy` and roll up in Node rather than in SQL. At two
outlets and a few thousand ledger rows that is the right trade. At ten outlets
and two years of history it is not, and the fix is a materialised view or raw
aggregate SQL per report.

**Rate limiting is a fixed window, not a sliding one.** A caller can send twice
the limit across a window boundary. For a public game endpoint at this scale
that is acceptable, and the upgrade is a Redis `INCR` with `EXPIRE` per bucket.

**The outbox dispatcher polls every 30 seconds.** A notification can therefore
be up to 30 seconds late. Nobody in a momo shop is waiting on a sub-second
alert, and the alternative is listen/notify plumbing that has to be kept alive.

**Replaying a dead outbox row is a manual database operation.**
`GET /admin/outbox/dead` shows what failed and why. There is no replay button,
because a dead row usually means the payload or the resolver was wrong, and
replaying it unchanged would just fail again. A replay endpoint is worth
building only after the first real dead row shows what actually goes wrong.

## Where the SRS itself is silent

The customer CRM and game layer is committed in the executive summary, the week
3 plan, the traceability matrix and acceptance criterion 3, and it is specified
nowhere. Section 6.3 is missing from the document, and both Section 15.7 and
FR-CRM-001 are cited by the SRS open questions without existing anywhere in it.

[Chapter 32](32-customer-crm-and-game.md) reconstructs a minimum specification
and that is what is built: guest play that earns nothing, coins on a verified
phone, reward definitions, coupon issue and single-use redemption. It has not
been approved by anybody, because there was nothing to approve it against.

Read chapter 32 before the first CRM conversation with the client, and treat
what is built as a proposal rather than a delivery.
