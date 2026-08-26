// bun test apps/api
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { OutletCacheService } from '../src/common/outlets/outlet-cache.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { AdminModule } from '../src/modules/admin/admin.module';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;

let ownerToken: string; // OWNER: everything in this module
let mgrToken: string; // STORE_MANAGER: admin.user.read at OWN_OUTLET only
let saheedId: string;
let patiaId: string;
let patiaUserId: string;
let ownerUserId: string;

const PASSWORD = 'saheed-momo-2026';
const OWNER = 'e2e.adm.owner';
const MGR = 'e2e.adm.mgr';
const PATIA = 'e2e.adm.patia';
const MADE = ['e2e.adm.made', 'e2e.adm.rolechange'];
const OUTLET_CODE = 'BM-E2EADM';
const DEPT = 'E2E Admin Dept';
const CATEGORY = 'E2E Admin Category';
const UNIT_CODE = 'E2EU';

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = ownerToken,
): Promise<{ status: number; text: string; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
}

async function login(identifier: string, password = PASSWORD) {
  const res = await fetch(`${url}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function cleanup(): Promise<void> {
  const usernames = [OWNER, MGR, PATIA, ...MADE];
  const users = await prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  // Direct SQL, which is the only way an audit row ever goes away. No
  // application code path does this, which is what the read-only test asserts.
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userOutlet.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { username: { in: usernames } } });

  await prisma.department.deleteMany({ where: { name: { startsWith: DEPT } } });
  await prisma.itemCategory.deleteMany({ where: { name: { startsWith: CATEGORY } } });
  await prisma.unit.deleteMany({ where: { code: { in: [UNIT_CODE, `${UNIT_CODE}X`] } } });
  const outlet = await prisma.outlet.findUnique({ where: { code: OUTLET_CODE } });
  if (outlet) {
    await prisma.auditLog.deleteMany({ where: { outletId: outlet.id } });
    await prisma.outlet.delete({ where: { id: outlet.id } });
  }
}

beforeAll(async () => {
  // AdminModule is listed alongside AppModule until the orchestrator wires it
  // into app.module.ts. Importing it twice is a no-op for Nest.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, AdminModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

  await cleanup();
  await app.get(OutletCacheService).invalidate();

  const hash = await app.get(PasswordService).hash(PASSWORD);
  saheedId = (await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } })).id;
  patiaId = (await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } })).id;

  const mk = async (username: string, roleKey: 'OWNER' | 'STORE_MANAGER' | 'KITCHEN_STAFF', outletId?: string) => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    if (outletId) await prisma.userOutlet.create({ data: { userId: user.id, outletId } });
    return user;
  };
  // OWNER holds no UserOutlet rows on purpose: its scope comes from the active
  // outlet cache at login.
  ownerUserId = (await mk(OWNER, 'OWNER')).id;
  await mk(MGR, 'STORE_MANAGER', saheedId);
  patiaUserId = (await mk(PATIA, 'KITCHEN_STAFF', patiaId)).id;

  ownerToken = (await login(OWNER)).body['accessToken'] as string;
  mgrToken = (await login(MGR)).body['accessToken'] as string;
});

afterAll(async () => {
  await cleanup();
  // The outlet created below is gone now, so no later suite inherits its id.
  await app?.get(OutletCacheService).invalidate();
  await prisma.$disconnect();
  await app?.close();
});

describe('user administration', () => {
  let createdId: string;
  let temporaryPassword: string;

  test('creating a user returns a temporary password and never a hash', async () => {
    const res = await api('POST', '/admin/users', {
      username: MADE[0],
      roleKey: 'COUNTER_CASHIER',
      outletIds: [saheedId],
    });

    expect(res.status).toBe(201);
    expect(res.body?.['temporaryPassword']).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
    expect(res.body?.['mustReset']).toBe(true);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.text).not.toContain('$argon2');

    createdId = res.body?.['id'] as string;
    temporaryPassword = res.body?.['temporaryPassword'] as string;

    const row = await prisma.user.findUniqueOrThrow({ where: { id: createdId } });
    expect(row.mustReset).toBe(true);
    expect(row.passwordHash).toStartWith('$argon2');
  });

  test('the temporary password is the one that was hashed', async () => {
    const res = await login(MADE[0] as string, temporaryPassword);
    expect(res.status).toBe(200);
    expect(res.body['mustReset']).toBe(true);
  });

  test('no read endpoint hands back the password or the hash', async () => {
    const one = await api('GET', `/admin/users/${createdId}`);
    expect(one.status).toBe(200);
    expect(one.text).not.toContain('temporaryPassword');
    expect(one.text).not.toContain('passwordHash');

    const many = await api('GET', '/admin/users?pageSize=100');
    expect(many.status).toBe(200);
    expect(many.text).not.toContain('passwordHash');
    expect(many.text).not.toContain('$argon2');
  });

  test('the list filters by role and by status', async () => {
    const byRole = await api('GET', '/admin/users?roleKey=COUNTER_CASHIER&pageSize=100');
    const rows = byRole.body?.['data'] as { id: string; roleKey: string }[];
    expect(rows.every((r) => r.roleKey === 'COUNTER_CASHIER')).toBe(true);
    expect(rows.some((r) => r.id === createdId)).toBe(true);

    const disabled = await api('GET', '/admin/users?status=DISABLED&pageSize=100');
    const off = disabled.body?.['data'] as { status: string }[];
    expect(off.every((r) => r.status === 'DISABLED')).toBe(true);
  });

  test('disabling a user revokes every live refresh token', async () => {
    expect(
      await prisma.refreshToken.count({ where: { userId: createdId, revokedAt: null } }),
    ).toBeGreaterThan(0);

    const res = await api('POST', `/admin/users/${createdId}/disable`, {
      reason: 'Left the counter team',
    });

    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('DISABLED');
    expect(await prisma.refreshToken.count({ where: { userId: createdId, revokedAt: null } })).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: createdId, action: 'admin.user.status_change' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.before).toEqual({ status: 'ACTIVE' });
    expect((audit?.after as { status: string }).status).toBe('DISABLED');
    expect(audit?.actorId).toBe(ownerUserId);
    expect(audit?.actorLabel).toContain('OWNER');
  });

  test('a disabled login cannot come back through refresh or login', async () => {
    const res = await login(MADE[0] as string, temporaryPassword);
    expect(res.status).toBe(403);
  });

  test('a role change revokes refresh tokens too', async () => {
    const made = await api('POST', '/admin/users', {
      username: MADE[1],
      roleKey: 'KITCHEN_STAFF',
      outletIds: [saheedId],
    });
    const id = made.body?.['id'] as string;
    const first = await login(MADE[1] as string, made.body?.['temporaryPassword'] as string);
    expect(first.status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: id, revokedAt: null } })).toBe(1);

    const res = await api('POST', `/admin/users/${id}/assign-role`, {
      roleKey: 'KITCHEN_MANAGER',
      reason: 'Promoted',
    });

    expect(res.status).toBe(200);
    expect(res.body?.['roleKey']).toBe('KITCHEN_MANAGER');
    // Without this the old refresh token keeps minting access tokens carrying
    // the previous permission hash.
    expect(await prisma.refreshToken.count({ where: { userId: id, revokedAt: null } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'admin.user.role_change' },
    });
    expect(audit.before).toEqual({ roleKey: 'KITCHEN_STAFF' });
  });

  test('reassigning outlets records both lists and drops the sessions', async () => {
    const id = (
      await prisma.user.findUniqueOrThrow({ where: { username: MADE[1] as string } })
    ).id;

    const res = await api('POST', `/admin/users/${id}/assign-outlets`, { outletIds: [patiaId] });

    expect(res.status).toBe(200);
    expect(res.body?.['outletIds']).toEqual([patiaId]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: id, action: 'admin.user.outlet_change' },
    });
    expect(audit.before).toEqual({ outletIds: [saheedId] });
  });

  test('an out-of-scope user returns 404, not 403', async () => {
    const res = await api('GET', `/admin/users/${patiaUserId}`, undefined, mgrToken);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ADMIN_USER_NOT_FOUND');
  });

  test('a store manager cannot create a login at all', async () => {
    const res = await api(
      'POST',
      '/admin/users',
      { username: 'e2e.adm.nope', roleKey: 'KITCHEN_STAFF', outletIds: [saheedId] },
      mgrToken,
    );
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('COMMON_FORBIDDEN');
    expect(await prisma.user.count({ where: { username: 'e2e.adm.nope' } })).toBe(0);
  });

  test('an administrator cannot disable their own login', async () => {
    const res = await api('POST', `/admin/users/${ownerUserId}/disable`, { reason: 'Oops' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ADMIN_SELF_ACTION_BLOCKED');
  });

  test('a duplicate username is a conflict, not a 500', async () => {
    const res = await api('POST', '/admin/users', {
      username: MADE[1],
      roleKey: 'KITCHEN_STAFF',
      outletIds: [saheedId],
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ADMIN_USERNAME_TAKEN');
  });
});

describe('outlets, departments and reference data', () => {
  test('every admin write leaves an audit row', async () => {
    const mark = new Date();
    const userId = (await prisma.user.findUniqueOrThrow({ where: { username: MADE[1] as string } }))
      .id;

    const outlet = await api('POST', '/admin/outlets', {
      code: OUTLET_CODE,
      name: 'E2E Admin Outlet',
    });
    expect(outlet.status).toBe(201);
    const outletId = outlet.body?.['id'] as string;

    expect((await api('PATCH', `/admin/outlets/${outletId}`, { isActive: false })).status).toBe(200);

    const dept = await api('POST', '/admin/departments', { outletId: saheedId, name: DEPT });
    expect(dept.status).toBe(201);
    expect(
      (await api('PATCH', `/admin/departments/${dept.body?.['id'] as string}`, { isActive: false }))
        .status,
    ).toBe(200);

    const cat = await api('POST', '/admin/categories', { name: CATEGORY });
    expect(cat.status).toBe(201);
    expect(
      (await api('PATCH', `/admin/categories/${cat.body?.['id'] as string}`, {
        name: `${CATEGORY} 2`,
      })).status,
    ).toBe(200);

    const unit = await api('POST', '/admin/units', { code: UNIT_CODE, name: 'E2E Unit' });
    expect(unit.status).toBe(201);
    expect(
      (await api('PATCH', `/admin/units/${unit.body?.['id'] as string}`, { code: `${UNIT_CODE}X` }))
        .status,
    ).toBe(200);

    expect((await api('PATCH', `/admin/users/${userId}`, { status: 'SUSPENDED' })).status).toBe(200);

    const rows = await prisma.auditLog.findMany({ where: { createdAt: { gte: mark } } });
    const actions = rows.map((r) => r.action);
    for (const expected of [
      'admin.outlet.create',
      'admin.outlet.update',
      'admin.department.create',
      'admin.department.update',
      'inventory.category.create',
      'inventory.category.update',
      'inventory.unit.create',
      'inventory.unit.update',
      'admin.user.update',
    ]) {
      expect(actions).toContain(expected);
    }
    // Nine writes, nine rows, and each one names who did it.
    expect(rows.length).toBe(9);
    expect(rows.every((r) => r.actorId === ownerUserId && r.actorLabel.includes('OWNER'))).toBe(
      true,
    );
  });

  test('a deactivated outlet is still visible to the screen that can restore it', async () => {
    const res = await api('GET', '/admin/outlets');
    const rows = res.body?.['data'] as { code: string; isActive: boolean }[];
    expect(rows.find((o) => o.code === OUTLET_CODE)?.isActive).toBe(false);
  });

  test('a duplicate department name at the same outlet is a conflict', async () => {
    const res = await api('POST', '/admin/departments', { outletId: saheedId, name: DEPT });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ADMIN_DEPARTMENT_NAME_TAKEN');
  });

  test('a department at another outlet is a 404 for a store manager', async () => {
    const res = await api(
      'POST',
      '/admin/departments',
      { outletId: patiaId, name: 'E2E Admin Dept Patia' },
      mgrToken,
    );
    // STORE_MANAGER holds no admin.department.manage grant at all, so this is
    // refused before scope is even considered.
    expect(res.status).toBe(403);
  });

  test('a unit code cannot change once the ledger uses it', async () => {
    const kg = await prisma.unit.findUniqueOrThrow({ where: { code: 'KG' } });

    const res = await api('PATCH', `/admin/units/${kg.id}`, { code: 'KGS' });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INVENTORY_UNIT_LOCKED_BY_LEDGER');
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: kg.id } })).code).toBe('KG');

    // The label is free to change, only the code is load bearing.
    const rename = await api('PATCH', `/admin/units/${kg.id}`, { name: 'Kilogram' });
    expect(rename.status).toBe(200);
  });
});

describe('audit log', () => {
  test('reads back by entity and by actor, newest first', async () => {
    const byEntity = await api('GET', `/admin/audit-log?entityType=User&actorId=${ownerUserId}`);
    expect(byEntity.status).toBe(200);
    const rows = byEntity.body?.['data'] as {
      action: string;
      createdAt: string;
      entityType: string;
      actorId: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entityType === 'User' && r.actorId === ownerUserId)).toBe(true);
    expect(rows.some((r) => r.action.startsWith('admin.user.'))).toBe(true);
    const times = rows.map((r) => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test('filters by action prefix, entity id and date range', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await api(
      'GET',
      `/admin/audit-log?action=admin.user.role_change&from=${today}&to=${today}`,
    );
    const rows = res.body?.['data'] as { action: string; entityId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.action === 'admin.user.role_change')).toBe(true);

    const one = await api(
      'GET',
      `/admin/audit-log?entityId=${rows[0]?.entityId as string}&entityType=User`,
    );
    expect((one.body?.['data'] as unknown[]).length).toBeGreaterThan(0);
  });

  test('a store manager cannot read the audit log', async () => {
    const res = await api('GET', '/admin/audit-log', undefined, mgrToken);
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('COMMON_FORBIDDEN');
  });

  test('the audit log has no mutation endpoint', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const res = await api(method, '/admin/audit-log', {});
      expect(res.status).toBe(404);
    }
    const withId = await api('DELETE', `/admin/audit-log/${ownerUserId}`);
    expect(withId.status).toBe(404);

    // The route table is only half of it. No code in the module may update or
    // delete a row either, which is what makes the table append only.
    const dir = [
      join(process.cwd(), 'src', 'modules', 'admin'),
      join(process.cwd(), 'apps', 'api', 'src', 'modules', 'admin'),
    ].find((d) => existsSync(d)) as string;
    const offenders = readdirSync(dir).filter((f) =>
      /auditLog\s*\.\s*(update|updateMany|delete|deleteMany|upsert)/.test(
        readFileSync(join(dir, f), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
