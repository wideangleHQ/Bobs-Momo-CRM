-- The scope invariant is already enforced in zod and in MessagingService. This
-- puts it where a bad row cannot exist at all: a DIRECT message with an
-- outletId would silently become an outlet broadcast on the read path.
ALTER TABLE "Message" ADD CONSTRAINT "message_scope_target" CHECK (
  (scope = 'DIRECT'     AND "recipientId" IS NOT NULL AND "outletId" IS NULL     AND "departmentId" IS NULL) OR
  (scope = 'OUTLET'     AND "outletId"    IS NOT NULL AND "recipientId" IS NULL  AND "departmentId" IS NULL) OR
  (scope = 'DEPARTMENT' AND "departmentId" IS NOT NULL AND "recipientId" IS NULL AND "outletId" IS NULL) OR
  (scope = 'ALL'        AND "recipientId" IS NULL     AND "outletId" IS NULL     AND "departmentId" IS NULL)
);
