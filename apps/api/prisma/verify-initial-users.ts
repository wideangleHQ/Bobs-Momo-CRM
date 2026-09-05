#!/usr/bin/env bun
/**
 * Read-only verification of the 13 initial provisioned users.
 * Safe to run against production at any time — makes no changes.
 *
 * Usage:
 *   bun run prisma/verify-initial-users.ts
 */

import { PrismaClient } from '@prisma/client';

const EXPECTED_USERNAMES = [
  'owner',
  'operations.manager',
  'store.manager.saheed',
  'store.manager.patharagadia',
  'kitchen.manager.saheed',
  'kitchen.manager.patharagadia',
  'inventory.manager',
  'purchase.manager',
  'hr.accounts',
  'kitchen.staff.saheed',
  'kitchen.staff.patharagadia',
  'counter.cashier.saheed',
  'counter.cashier.patharagadia',
];

const EXPECTED_ROLES: Record<string, string> = {
  'owner':                        'OWNER',
  'operations.manager':           'OPERATIONS_MANAGER',
  'store.manager.saheed':         'STORE_MANAGER',
  'store.manager.patharagadia':   'STORE_MANAGER',
  'kitchen.manager.saheed':       'KITCHEN_MANAGER',
  'kitchen.manager.patharagadia': 'KITCHEN_MANAGER',
  'inventory.manager':            'INVENTORY_MANAGER',
  'purchase.manager':             'PURCHASE_MANAGER',
  'hr.accounts':                  'HR_ACCOUNTS',
  'kitchen.staff.saheed':         'KITCHEN_STAFF',
  'kitchen.staff.patharagadia':   'KITCHEN_STAFF',
  'counter.cashier.saheed':       'COUNTER_CASHIER',
  'counter.cashier.patharagadia': 'COUNTER_CASHIER',
};

// Roles that use no UserOutlet rows (scope resolved from all active outlets at login)
const ALL_COMPUTED_ROLES = new Set(['OWNER', 'OPERATIONS_MANAGER']);

// Roles that should have UserOutlet rows for every outlet
const BOTH_OUTLET_ROLES = new Set(['INVENTORY_MANAGER', 'PURCHASE_MANAGER', 'HR_ACCOUNTS']);

function hr(char = '─', width = 100): string {
  return char.repeat(width);
}

type CheckResult = 'OK' | 'FAIL' | 'WARN' | 'MISSING';

interface Row {
  username: string;
  userId: string;
  employeeId: string;
  role: CheckResult;
  mustReset: CheckResult;
  status: CheckResult;
  employee: CheckResult;
  outlets: CheckResult;
  outletsDetail: string;
  overall: CheckResult;
}

async function main(): Promise<void> {
  console.log('\n' + hr('═'));
  console.log('  Bob\'s Momo CRM — Verify Initial Users (read-only)');
  console.log(hr('═') + '\n');

  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      where: { username: { in: EXPECTED_USERNAMES } },
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true, outletId: true } },
        outlets: { select: { outletId: true, outlet: { select: { code: true } } } },
      },
    });

    const byUsername = new Map(users.map((u) => [u.username, u]));

    let allOk = true;
    const rows: Row[] = [];

    for (const username of EXPECTED_USERNAMES) {
      const user = byUsername.get(username);

      if (!user) {
        allOk = false;
        rows.push({
          username,
          userId: '—',
          employeeId: '—',
          role: 'MISSING',
          mustReset: 'MISSING',
          status: 'MISSING',
          employee: 'MISSING',
          outlets: 'MISSING',
          outletsDetail: '—',
          overall: 'MISSING',
        });
        continue;
      }

      const expectedRole = EXPECTED_ROLES[username]!;
      const roleOk: CheckResult = user.roleKey === expectedRole ? 'OK' : 'FAIL';
      const resetOk: CheckResult = user.mustReset ? 'OK' : 'WARN';
      const statusOk: CheckResult = user.status === 'ACTIVE' ? 'OK' : 'FAIL';
      const empOk: CheckResult = user.employee ? 'OK' : 'FAIL';

      const outletCodes = user.outlets.map((o) => o.outlet.code).sort().join(', ');
      let outletsOk: CheckResult;

      if (ALL_COMPUTED_ROLES.has(expectedRole)) {
        outletsOk = user.outlets.length === 0 ? 'OK' : 'WARN';
      } else if (BOTH_OUTLET_ROLES.has(expectedRole)) {
        outletsOk = user.outlets.length >= 2 ? 'OK' : 'FAIL';
      } else {
        outletsOk = user.outlets.length === 1 ? 'OK' : 'FAIL';
      }

      const hasFail = [roleOk, statusOk, empOk, outletsOk].includes('FAIL');
      const hasWarn = [resetOk, outletsOk].includes('WARN');
      const overall: CheckResult = hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'OK';
      if (overall !== 'OK') allOk = false;

      rows.push({
        username,
        userId: user.id,
        employeeId: user.employee?.id ?? '—',
        role: roleOk,
        mustReset: resetOk,
        status: statusOk,
        employee: empOk,
        outlets: outletsOk,
        outletsDetail: ALL_COMPUTED_ROLES.has(expectedRole) ? '(all, computed)' : outletCodes || '(none)',
        overall,
      });
    }

    // ── results table ──────────────────────────────────────────────────
    const icon = (r: CheckResult): string =>
      r === 'OK' ? '✓' : r === 'WARN' ? '⚠' : r === 'MISSING' ? '?' : '✗';

    console.log(
      'Username'.padEnd(36) +
      'Role'.padEnd(6) +
      'Reset'.padEnd(7) +
      'Status'.padEnd(8) +
      'Emp'.padEnd(5) +
      'Outlets'.padEnd(8) +
      'Outlet(s)'.padEnd(36) +
      'Overall',
    );
    console.log(hr('─'));

    for (const r of rows) {
      console.log(
        r.username.padEnd(36) +
        icon(r.role).padEnd(6) +
        icon(r.mustReset).padEnd(7) +
        icon(r.status).padEnd(8) +
        icon(r.employee).padEnd(5) +
        icon(r.outlets).padEnd(8) +
        r.outletsDetail.padEnd(36) +
        icon(r.overall),
      );
    }

    console.log('\n' + hr('─'));
    console.log(`Legend: ✓ OK   ⚠ warning (non-critical)   ✗ FAIL   ? MISSING`);
    console.log(hr('─'));

    // ── detail for failures ────────────────────────────────────────────
    const failures = rows.filter((r) => r.overall === 'FAIL' || r.overall === 'MISSING');
    if (failures.length > 0) {
      console.log('\n⛔  Failing checks:');
      for (const r of failures) {
        if (r.overall === 'MISSING') {
          console.log(`  • ${r.username}: user not found in database`);
        } else {
          if (r.role === 'FAIL')    console.log(`  • ${r.username}: wrong roleKey (expected ${EXPECTED_ROLES[r.username]})`);
          if (r.status === 'FAIL')  console.log(`  • ${r.username}: status is not ACTIVE`);
          if (r.employee === 'FAIL') console.log(`  • ${r.username}: no linked Employee record`);
          if (r.outlets === 'FAIL') console.log(`  • ${r.username}: wrong outlet assignment`);
        }
      }
    }

    // ── user ID + employee ID table ────────────────────────────────────
    const found = rows.filter((r) => r.userId !== '—');
    if (found.length > 0) {
      console.log('\n' + 'Username'.padEnd(36) + 'User ID'.padEnd(40) + 'Employee ID');
      console.log(hr('─'));
      for (const r of found) {
        console.log(r.username.padEnd(36) + r.userId.padEnd(40) + r.employeeId);
      }
    }

    console.log('\n' + hr('─'));
    if (allOk) {
      console.log('✓ All 13 initial users verified successfully.\n');
    } else {
      console.log(`⛔ Verification found issues. Review the table above.\n`);
      process.exitCode = 1;
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error('\n⛔  Verification failed:', e);
  process.exitCode = 1;
});
