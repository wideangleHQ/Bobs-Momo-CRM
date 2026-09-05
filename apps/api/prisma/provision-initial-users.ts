#!/usr/bin/env bun
/**
 * Provision the initial production users for Bob's Momo CRM.
 *
 * This script MUST be run explicitly. It never executes during:
 *   - application startup   - npm run build   - prisma migrate
 *   - prisma generate       - prisma db seed  - deployment pipelines
 *
 * Usage:
 *   bun run prisma/provision-initial-users.ts --dry-run
 *   bun run prisma/provision-initial-users.ts
 *   CONFIRM_PRODUCTION_PROVISIONING=true bun run prisma/provision-initial-users.ts
 */

import { PrismaClient, type RoleKey } from '@prisma/client';
import * as argon2 from 'argon2';

// ── password config ───────────────────────────────────────────────────────
// Must match apps/api/src/modules/auth/password.service.ts exactly.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP floor
  timeCost: 2,
  parallelism: 1,
};

const TEMP_PASSWORD = 'Password123!';

// ── outlet codes (as stored in Outlet.code in the production database) ───
const CODE_SAHEED = 'SAHEED_NAGAR';
const CODE_PATHRA = 'PATHARAGADIA';

// ── user specs ────────────────────────────────────────────────────────────

type OutletScope =
  | 'ALL_COMPUTED'  // OWNER / OPERATIONS_MANAGER — no UserOutlet rows; resolved at login
  | 'BOTH_OUTLETS'  // UserOutlet rows for every outlet
  | 'SAHEED_NAGAR'
  | 'PATHARAGADIA';

interface UserSpec {
  seq: number;            // 1-based index used for Name N and phone placeholder
  username: string;
  roleKey: RoleKey;
  outletScope: OutletScope;
  primaryOutletCode: string; // outlet the Employee row is filed under
  department: string;        // department name within primaryOutlet ('' = null)
}

const USERS: readonly UserSpec[] = [
  { seq: 1,  username: 'owner',                        roleKey: 'OWNER',              outletScope: 'ALL_COMPUTED', primaryOutletCode: CODE_SAHEED, department: 'Management' },
  { seq: 2,  username: 'operations.manager',           roleKey: 'OPERATIONS_MANAGER', outletScope: 'ALL_COMPUTED', primaryOutletCode: CODE_SAHEED, department: 'Management' },
  { seq: 3,  username: 'store.manager.saheed',         roleKey: 'STORE_MANAGER',      outletScope: 'SAHEED_NAGAR', primaryOutletCode: CODE_SAHEED, department: 'Store Operations' },
  { seq: 4,  username: 'store.manager.patharagadia',   roleKey: 'STORE_MANAGER',      outletScope: 'PATHARAGADIA', primaryOutletCode: CODE_PATHRA, department: 'Store Operations' },
  { seq: 5,  username: 'kitchen.manager.saheed',       roleKey: 'KITCHEN_MANAGER',    outletScope: 'SAHEED_NAGAR', primaryOutletCode: CODE_SAHEED, department: 'Kitchen' },
  { seq: 6,  username: 'kitchen.manager.patharagadia', roleKey: 'KITCHEN_MANAGER',    outletScope: 'PATHARAGADIA', primaryOutletCode: CODE_PATHRA, department: 'Kitchen' },
  { seq: 7,  username: 'inventory.manager',            roleKey: 'INVENTORY_MANAGER',  outletScope: 'BOTH_OUTLETS', primaryOutletCode: CODE_SAHEED, department: 'Inventory & Purchase' },
  { seq: 8,  username: 'purchase.manager',             roleKey: 'PURCHASE_MANAGER',   outletScope: 'BOTH_OUTLETS', primaryOutletCode: CODE_SAHEED, department: 'Inventory & Purchase' },
  { seq: 9,  username: 'hr.accounts',                  roleKey: 'HR_ACCOUNTS',        outletScope: 'BOTH_OUTLETS', primaryOutletCode: CODE_SAHEED, department: 'HR & Accounts' },
  { seq: 10, username: 'kitchen.staff.saheed',         roleKey: 'KITCHEN_STAFF',      outletScope: 'SAHEED_NAGAR', primaryOutletCode: CODE_SAHEED, department: 'Kitchen' },
  { seq: 11, username: 'kitchen.staff.patharagadia',   roleKey: 'KITCHEN_STAFF',      outletScope: 'PATHARAGADIA', primaryOutletCode: CODE_PATHRA, department: 'Kitchen' },
  { seq: 12, username: 'counter.cashier.saheed',       roleKey: 'COUNTER_CASHIER',    outletScope: 'SAHEED_NAGAR', primaryOutletCode: CODE_SAHEED, department: 'Store Operations' },
  { seq: 13, username: 'counter.cashier.patharagadia', roleKey: 'COUNTER_CASHIER',    outletScope: 'PATHARAGADIA', primaryOutletCode: CODE_PATHRA, department: 'Store Operations' },
];

// ── types ─────────────────────────────────────────────────────────────────

type RowStatus = 'created' | 'skipped' | 'dry-run';

interface ProvisionResult {
  username: string;
  roleKey: string;
  outletLabel: string;
  userId: string;
  employeeId: string;
  status: RowStatus;
}

// ── helpers ───────────────────────────────────────────────────────────────

function outletLabel(scope: OutletScope, primaryCode: string): string {
  if (scope === 'ALL_COMPUTED') return 'ALL (computed at login)';
  if (scope === 'BOTH_OUTLETS') return 'BOTH (Saheed + Patharagadia)';
  return primaryCode;
}

function hr(char = '─', width = 90): string {
  return char.repeat(width);
}

// ── main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && process.env.CONFIRM_PRODUCTION_PROVISIONING !== 'true') {
    console.error('\n⛔  Production safety gate.');
    console.error('    NODE_ENV=production was detected.');
    console.error('    This script will write to the production database.');
    console.error('    If you intend to proceed, re-run with the explicit confirmation:\n');
    console.error('      CONFIRM_PRODUCTION_PROVISIONING=true bun run prisma/provision-initial-users.ts\n');
    console.error('    Run with --dry-run first to preview what would be created.\n');
    process.exit(1);
  }

  console.log('\n' + hr('═'));
  console.log('  Bob\'s Momo CRM — Initial User Provisioning');
  console.log(`  Mode        : ${isDryRun ? 'DRY RUN (no writes will be made)' : 'LIVE — writes to database'}`);
  console.log(`  Environment : ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`  Database    : ${(process.env.DATABASE_URL ?? '').replace(/:([^@]+)@/, ':****@')}`);
  console.log(hr('═') + '\n');

  const prisma = new PrismaClient();

  try {
    // ── look up outlets ──────────────────────────────────────────────────
    const outlets = await prisma.outlet.findMany({
      where: { code: { in: [CODE_SAHEED, CODE_PATHRA] } },
    });
    const outletByCode = new Map(outlets.map((o) => [o.code, o]));

    const saheed = outletByCode.get(CODE_SAHEED);
    const pathra = outletByCode.get(CODE_PATHRA);
    if (!saheed) throw new Error(`Outlet not found: code="${CODE_SAHEED}". Is the database correct?`);
    if (!pathra) throw new Error(`Outlet not found: code="${CODE_PATHRA}". Is the database correct?`);

    // ── look up departments ──────────────────────────────────────────────
    const departments = await prisma.department.findMany({
      where: { outletId: { in: [saheed.id, pathra.id] } },
    });
    const deptMap = new Map(departments.map((d) => [`${d.outletId}:${d.name}`, d]));

    // ── next employee code ───────────────────────────────────────────────
    const allEmps = await prisma.employee.findMany({ select: { employeeCode: true } });
    let maxEmpNum = 0;
    for (const e of allEmps) {
      const m = e.employeeCode.match(/(\d+)$/);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > maxEmpNum) maxEmpNum = n;
      }
    }
    let empSeq = maxEmpNum + 1;

    // ── check existing usernames ─────────────────────────────────────────
    const existingByUsername = new Map(
      (
        await prisma.user.findMany({
          where: { username: { in: USERS.map((u) => u.username) } },
          select: { id: true, username: true, roleKey: true },
        })
      ).map((u) => [u.username, u]),
    );

    // ── hash password (once, outside loop) ──────────────────────────────
    let passwordHash: string | null = null;
    if (!isDryRun) {
      process.stdout.write('Hashing temporary password … ');
      passwordHash = await argon2.hash(TEMP_PASSWORD, ARGON2_OPTIONS);
      console.log('done.\n');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results: ProvisionResult[] = [];

    // ── process each user spec ───────────────────────────────────────────
    for (const spec of USERS) {
      const label = outletLabel(spec.outletScope, spec.primaryOutletCode);
      const existing = existingByUsername.get(spec.username);

      if (existing) {
        console.log(`  SKIP   ${spec.username.padEnd(36)} already exists (id: ${existing.id})`);
        results.push({ username: spec.username, roleKey: spec.roleKey, outletLabel: label, userId: existing.id, employeeId: '—', status: 'skipped' });
        continue;
      }

      const primaryOutlet = outletByCode.get(spec.primaryOutletCode)!;
      const dept = spec.department
        ? deptMap.get(`${primaryOutlet.id}:${spec.department}`)
        : undefined;

      if (spec.department && !dept) {
        console.warn(`  ⚠ Department "${spec.department}" not found in outlet "${spec.primaryOutletCode}" — departmentId will be null`);
      }

      const outletRowIds: string[] =
        spec.outletScope === 'SAHEED_NAGAR' ? [saheed.id]
        : spec.outletScope === 'PATHARAGADIA' ? [pathra.id]
        : spec.outletScope === 'BOTH_OUTLETS' ? [saheed.id, pathra.id]
        : []; // ALL_COMPUTED

      const employeeCode = `BM-EMP-${String(empSeq++).padStart(4, '0')}`;
      const fullName = `Name ${spec.seq}`;
      const phone = String(spec.seq).padStart(10, '0');

      console.log(`  ${isDryRun ? 'PLAN  ' : 'CREATE'} ${spec.username.padEnd(36)} ${spec.roleKey.padEnd(22)} ${label}`);

      if (isDryRun) {
        results.push({ username: spec.username, roleKey: spec.roleKey, outletLabel: label, userId: '(dry-run)', employeeId: '(dry-run)', status: 'dry-run' });
        continue;
      }

      const { userId, employeeId } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: spec.username,
            passwordHash: passwordHash!,
            roleKey: spec.roleKey,
            status: 'ACTIVE',
            mustReset: true,
          },
        });

        const employee = await tx.employee.create({
          data: {
            employeeCode,
            userId: user.id,
            fullName,
            phone,
            outletId: primaryOutlet.id,
            departmentId: dept?.id ?? null,
            joinedOn: today,
            status: 'ACTIVE',
          },
        });

        if (outletRowIds.length > 0) {
          await tx.userOutlet.createMany({
            data: outletRowIds.map((outletId) => ({ userId: user.id, outletId })),
          });
        }

        return { userId: user.id, employeeId: employee.id };
      });

      results.push({ username: spec.username, roleKey: spec.roleKey, outletLabel: label, userId, employeeId, status: 'created' });
    }

    // ── summary ──────────────────────────────────────────────────────────

    const created = results.filter((r) => r.status === 'created');
    const skipped = results.filter((r) => r.status === 'skipped');
    const planned = results.filter((r) => r.status === 'dry-run');

    console.log('\n' + hr('═'));
    if (isDryRun) {
      console.log(`Dry run complete. Would create: ${planned.length}  Would skip (exists): ${skipped.length}`);
    } else {
      console.log(`Provisioning complete. Created: ${created.length}  Skipped (already existed): ${skipped.length}`);
    }

    const actionRows = isDryRun ? planned : created;
    if (actionRows.length > 0) {
      console.log('\n┌─ TEMPORARY CREDENTIALS — show once, record securely, then discard ─────────┐');
      console.log('│  All accounts: mustReset=true. User must change password on first login.     │');
      console.log('│                                                                               │');
      console.log('│  Temporary password: Password123!                                             │');
      console.log('└───────────────────────────────────────────────────────────────────────────────┘\n');

      console.log('Username'.padEnd(36) + 'Role'.padEnd(24) + 'Outlet(s)');
      console.log(hr('─'));
      for (const r of actionRows) {
        console.log(r.username.padEnd(36) + r.roleKey.padEnd(24) + r.outletLabel);
      }

      if (!isDryRun) {
        console.log('\n' + 'Username'.padEnd(36) + 'User ID'.padEnd(40) + 'Employee ID');
        console.log(hr('─'));
        for (const r of actionRows) {
          console.log(r.username.padEnd(36) + r.userId.padEnd(40) + r.employeeId);
        }
      }
    }

    console.log('\n' + hr('─'));
    console.log('Verify provisioning (read-only, safe on production):');
    console.log('  bun run prisma/verify-initial-users.ts');
    console.log(hr('─') + '\n');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error('\n⛔  Provisioning failed:', e);
  process.exitCode = 1;
});
