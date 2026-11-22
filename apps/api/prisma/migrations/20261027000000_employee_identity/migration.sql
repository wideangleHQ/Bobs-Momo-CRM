-- Additive only. No existing row is changed except that every existing employee
-- keeps eligibleForWorkflows = true (the column default), so attendance, tasks
-- and reports behave exactly as before until the Owner changes a record.

-- Generated employee usernames: BMEMP0001, BMEMP0002, ...
-- A sequence never hands out a number twice, including under concurrent requests
-- and including numbers burned by a rolled-back attempt (a gap is fine, a reuse
-- is not). The application formats the number; nothing here depends on a name,
-- role or outlet.
CREATE SEQUENCE "employee_username_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Employee codes (BM-EMP-0007) were allocated as "highest existing code plus
-- one", which two simultaneous requests can both read. A sequence fixes that.
-- It starts after the highest number already issued, so existing codes are not
-- reissued.
CREATE SEQUENCE "employee_code_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
SELECT setval(
  '"employee_code_seq"',
  COALESCE(
    (SELECT MAX(NULLIF(regexp_replace("employeeCode", '[^0-9]', '', 'g'), '')::bigint) FROM "Employee"),
    0
  ) + 1,
  false
);

ALTER TABLE "Employee" ADD COLUMN "eligibleForWorkflows" BOOLEAN NOT NULL DEFAULT true;
