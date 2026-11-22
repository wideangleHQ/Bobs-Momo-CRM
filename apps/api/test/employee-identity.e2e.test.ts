// Integration tests for employee identity, Owner-controlled employee creation,
// the employee sign-in, and the separation of employee accounts from dashboard
// accounts. Needs an ISOLATED database (all migrations applied, reference and
// demo seed loaded) and Redis. Never run against the shared Supabase project.
//   TZ=Asia/Kolkata DATABASE_URL=... DIRECT_URL=... REDIS_URL=... \
//   JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... bun test test/employee-identity.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { toBusinessDate } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;

const PASSWORD = 'saheed-momo-2026';
const INITIAL = 'password1234';
const U = {
  owner: 'e2e.id.owner',
  hr: 'e2e.id.hr',
  mgr: 'e2e.id.mgr', // STORE_MANAGER and an employee (can create tasks)
  cashier: 'e2e.id.cashier', // shared COUNTER_CASHIER dashboard account: NO employee record
  legacy: 'e2e.id.legacy', // COUNTER_CASHIER login that DOES have an employee row (as provisioned today)
  other: 'e2e.id.other', // STORE_MANAGER of the other outlet
};
const USERNAMES = Object.values(U);

const SITE = { latitude: 20.3661741, longitude: 85.7944251 };
const north = (m: number) => ({
  location: { latitude: SITE.latitude + m / 111_194.93, longitude: SITE.longitude, accuracyM: 10 },
});

let outletId: string;
let otherOutletId: string;
let departmentId: string;
let originalGeofence: { latitude: number | null; longitude: number | null; geofenceRadiusM: number | null };
const tok = {} as Record<keyof typeof U, string>;
const uid: Record<string, string> = {};
const emp: { mgr: string; legacy: string } = { mgr: '', legacy: '' };

async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const code = (r: { body: Record<string, unknown> | null }) => (r.body?.['error'] as { code?: string } | undefined)?.code;
const msg = (r: { body: Record<string, unknown> | null }) => (r.body?.['error'] as { message?: string } | undefined)?.message;
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });
const loginAs = async (identifier: string, password: string, path = '/auth/login') => {
  const r = await call('POST', path, { identifier, password });
  return { ...r, token: (r.body?.['accessToken'] as string | undefined) ?? '' };
};

const newEmployee = (name: string, extra: Record<string, unknown> = {}) => ({
  fullName: `E2E ID ${name}`,
  phone: '9437011223',
  outletId,
  departmentId,
  joinedOn: toBusinessDate(),
  roleKey: 'KITCHEN_STAFF',
  ...extra,
});
interface EmployeeView {
  id: string;
  employeeCode: string;
  status: string;
  eligibleForWorkflows: boolean;
  user: { id: string; username: string } | null;
}
type Created = { employee: EmployeeView; account: { username: string; initialPassword: string; mustReset: boolean } };
// Typed views of JSON bodies, instead of casting to any.
const asEmployee = (r: { body: Record<string, unknown> | null }) => r.body as unknown as EmployeeView;
const asCreated = (r: { body: Record<string, unknown> | null }) => r.body as unknown as Created;
const asMe = (r: { body: Record<string, unknown> | null }) =>
  r.body as unknown as { id: string; employeeId: string | null; permissions: Record<string, unknown> };
const rowsOf = (r: { body: Record<string, unknown> | null }) => (r.body as unknown as { data: unknown[] }).data;
const createAs = async (who: keyof typeof U, name: string, extra: Record<string, unknown> = {}) => {
  const r = await call('POST', '/employees', newEmployee(name, extra), tok[who], idem());
  return { ...r, created: r.body as unknown as Created };
};

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { in: USERNAMES } }, select: { id: true } });
  const employees = await prisma.employee.findMany({
    where: { OR: [{ userId: { in: users.map((u) => u.id) } }, { fullName: { startsWith: 'E2E ID' } }] },
    select: { id: true, userId: true },
  });
  const empIds = employees.map((e) => e.id);
  const logins = employees.flatMap((e) => (e.userId ? [e.userId] : []));
  await prisma.task.deleteMany({ where: { OR: [{ title: { startsWith: 'E2E ID' } }, { assigneeId: { in: empIds } }, { createdById: { in: empIds } }] } });
  await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: empIds } } });
  await prisma.user.deleteMany({ where: { OR: [{ username: { in: USERNAMES } }, { id: { in: logins } }, { username: { startsWith: 'bmemp9' } }] } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

  await cleanup();
  const hash = await app.get(PasswordService).hash(PASSWORD);
  const outlet = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  const other = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
  outletId = outlet.id;
  otherOutletId = other.id;
  originalGeofence = { latitude: outlet.latitude, longitude: outlet.longitude, geofenceRadiusM: outlet.geofenceRadiusM };
  await prisma.outlet.update({ where: { id: outletId }, data: { ...SITE, geofenceRadiusM: 500 } });
  departmentId = (await prisma.department.findFirstOrThrow({ where: { outletId, name: 'Kitchen' } })).id;

  const mk = async (username: string, roleKey: 'OWNER' | 'HR_ACCOUNTS' | 'STORE_MANAGER' | 'COUNTER_CASHIER', outlets: string[]) => {
    const user = await prisma.user.create({ data: { username, passwordHash: hash, roleKey, mustReset: false } });
    for (const o of outlets) await prisma.userOutlet.create({ data: { userId: user.id, outletId: o } });
    uid[username] = user.id;
    return user;
  };
  const withEmployee = (userId: string, n: number, name: string) =>
    prisma.employee.create({
      data: {
        employeeCode: `BM-EMP-98${n}`,
        userId,
        fullName: `E2E ID ${name}`,
        phone: `94370119${n}`,
        outletId,
        departmentId,
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

  await mk(U.owner, 'OWNER', []);
  await mk(U.hr, 'HR_ACCOUNTS', [outletId]);
  const mgr = await mk(U.mgr, 'STORE_MANAGER', [outletId]);
  await mk(U.cashier, 'COUNTER_CASHIER', [outletId]);
  const legacy = await mk(U.legacy, 'COUNTER_CASHIER', [outletId]);
  await mk(U.other, 'STORE_MANAGER', [otherOutletId]);
  emp.mgr = (await withEmployee(mgr.id, 11, 'Manager')).id;
  emp.legacy = (await withEmployee(legacy.id, 12, 'Legacy Cashier')).id;

  for (const key of Object.keys(U) as (keyof typeof U)[]) tok[key] = (await loginAs(U[key], PASSWORD)).token;
});

afterAll(async () => {
  await cleanup();
  if (outletId && originalGeofence) await prisma.outlet.update({ where: { id: outletId }, data: originalGeofence });
  await prisma.$disconnect();
  await app?.close();
});

describe('Owner-controlled employee creation', () => {
  test('the Owner creates an employee, a generated username and an individual login in one step', async () => {
    const { status, created } = await createAs('owner', 'Created One');
    expect(status).toBe(201);
    expect(created.account.username).toMatch(/^bmemp\d{4,}$/);
    expect(created.account.initialPassword).toBe(INITIAL);
    expect(created.account.mustReset).toBe(true);
    expect(created.employee.employeeCode).toMatch(/^BM-EMP-\d{4}$/);
    expect(created.employee.user?.username).toBe(created.account.username);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: created.account.username }, include: { outlets: true } });
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: created.employee.id } });
    expect(employee.userId).toBe(user.id);
    expect(user.mustReset).toBe(true);
    expect(user.roleKey).toBe('KITCHEN_STAFF');
    expect(user.outlets.map((o) => o.outletId)).toEqual([outletId]);
    expect(employee.eligibleForWorkflows).toBe(true);
  });

  test('the password is stored only as an argon2 hash and never comes back from any read', async () => {
    const { created } = await createAs('owner', 'Hash Check');
    const user = await prisma.user.findUniqueOrThrow({ where: { username: created.account.username } });
    expect(user.passwordHash.startsWith('$argon2')).toBe(true);
    expect(user.passwordHash).not.toContain(INITIAL);

    const read = await call('GET', `/employees/${created.employee.id}`, undefined, tok.owner);
    const list = await call('GET', '/employees?pageSize=100', undefined, tok.owner);
    for (const r of [read, list]) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain(INITIAL);
      expect(text).not.toContain('$argon2');
      expect(text).not.toContain('passwordHash');
    }
  });

  test('only the Owner may create: HR, managers, staff and dashboard accounts are refused', async () => {
    const before = await prisma.employee.count();
    for (const who of ['hr', 'mgr', 'cashier', 'legacy', 'other'] as const) {
      const r = await call('POST', '/employees', newEmployee('Refused'), tok[who], idem());
      expect(r.status).toBe(403);
    }
    expect((await call('POST', '/employees', newEmployee('NoToken'), undefined, idem())).status).toBe(401);
    expect(await prisma.employee.count()).toBe(before);
  });

  test('a client-supplied username, user link, password or Owner role is refused and writes nothing', async () => {
    const before = { e: await prisma.employee.count(), u: await prisma.user.count() };
    for (const extra of [{ username: 'bmemp0001' }, { username: 'BMEMP0001' }, { userId: uid[U.mgr] }, { password: 'x' }, { roleKey: 'OWNER' }, { mustReset: false }]) {
      const r = await call('POST', '/employees', newEmployee('Forged', extra), tok.owner, idem());
      expect(r.status).toBe(400);
    }
    expect({ e: await prisma.employee.count(), u: await prisma.user.count() }).toEqual(before);
  });

  test('a request without an idempotency key is refused', async () => {
    const r = await call('POST', '/employees', newEmployee('NoKey'), tok.owner);
    expect(r.status).toBe(400);
    expect(code(r)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('a retry with the same key replays one employee; the same key with a different body is refused', async () => {
    const key = idem();
    const body = newEmployee('Replay');
    const a = await call('POST', '/employees', body, tok.owner, key);
    const b = await call('POST', '/employees', body, tok.owner, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(asCreated(b).employee.id).toBe(asCreated(a).employee.id);
    expect(await prisma.employee.count({ where: { fullName: 'E2E ID Replay' } })).toBe(1);

    const clash = await call('POST', '/employees', newEmployee('Replay', { phone: '9437011999' }), tok.owner, key);
    expect(clash.status).toBe(409);
  });

  test('twelve simultaneous creations yield twelve different usernames and employee codes', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createAs('owner', `Concurrent ${i}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const names = results.map((r) => r.created.account.username);
    const codes = results.map((r) => r.created.employee.employeeCode);
    expect(new Set(names).size).toBe(12);
    expect(new Set(codes).size).toBe(12);
    const stored = await prisma.user.count({ where: { username: { in: names } } });
    expect(stored).toBe(12);
  });

  test('usernames only ever go up, grow past four digits, and skip a number someone already took', async () => {
    const first = await createAs('owner', 'Seq A');
    const second = await createAs('owner', 'Seq B');
    const n = (r: { created: Created }) => Number(r.created.account.username.replace('bmemp', ''));
    expect(n(second)).toBeGreaterThan(n(first));

    const seqRows = await prisma.$queryRaw<{ last_value: bigint }[]>`SELECT last_value FROM employee_username_seq`;
    if ((seqRows[0]?.last_value ?? 0n) < 9999n) await prisma.$executeRaw`SELECT setval('employee_username_seq', 9999)`;
    const big = await createAs('owner', 'Seq Big');
    expect(Number(big.created.account.username.replace('bmemp', ''))).toBeGreaterThanOrEqual(10000);
    expect(big.created.account.username.length).toBeGreaterThan(9);

    // A number taken by a row created some other way is skipped, never reused.
    const nextRows = await prisma.$queryRaw<{ next: bigint }[]>`SELECT last_value + 1 AS next FROM employee_username_seq`;
    const taken = `bmemp${nextRows[0]?.next}`;
    const hash = await app.get(PasswordService).hash(PASSWORD);
    await prisma.user.create({ data: { username: taken, passwordHash: hash, roleKey: 'KITCHEN_STAFF', mustReset: true } });
    const after = await createAs('owner', 'Seq Skip');
    expect(after.status).toBe(201);
    expect(after.created.account.username).not.toBe(taken);
    expect(await prisma.user.count({ where: { username: taken } })).toBe(1);
  });

  test('a failure part-way through leaves no employee, no login, and does not leak the cause', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION e2e_fail_employee() RETURNS trigger AS $$
      BEGIN
        IF NEW."fullName" = 'E2E ID FORCED FAILURE' THEN RAISE EXCEPTION 'e2e forced failure after the login row'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER e2e_fail_employee BEFORE INSERT ON "Employee" FOR EACH ROW EXECUTE FUNCTION e2e_fail_employee()`);
    try {
      const users = await prisma.user.count();
      const employees = await prisma.employee.count();
      const r = await call('POST', '/employees', { ...newEmployee('x'), fullName: 'E2E ID FORCED FAILURE' }, tok.owner, idem());
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(r.body)).not.toContain('forced failure');
      expect(await prisma.user.count()).toBe(users);
      expect(await prisma.employee.count()).toBe(employees);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_fail_employee ON "Employee"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_employee()');
    }
    const ok = await createAs('owner', 'After Failure');
    expect(ok.status).toBe(201);
  });

  test('a department from another outlet is refused and nothing is created', async () => {
    const dept = await prisma.department.findFirstOrThrow({ where: { outletId: otherOutletId } });
    const before = await prisma.user.count();
    const r = await call('POST', '/employees', newEmployee('Bad Dept', { departmentId: dept.id }), tok.owner, idem());
    expect(r.status).toBe(400);
    expect(await prisma.user.count()).toBe(before);
  });

  test('creation is audited with the actor and the generated username, and no secret', async () => {
    const { created } = await createAs('owner', 'Audit Me');
    const rows = await prisma.auditLog.findMany({ where: { entityId: { in: [created.employee.id, created.employee.user?.id ?? ''] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(['admin.user.create', 'workforce.employee.create']);
    expect(rows.every((r) => r.actorId === (uid[U.owner] ?? null))).toBe(true);
    const text = JSON.stringify(rows);
    expect(text).toContain(created.account.username);
    expect(text).not.toContain(INITIAL);
    expect(text).not.toContain('$argon2');
  });
});

describe('employee profile management', () => {
  let target: Created;
  beforeAll(async () => {
    target = (await createAs('owner', 'Manage Me')).created;
  });

  test('edits are audited with before and after, and cannot touch the login link, role, join date or username', async () => {
    const id = target.employee.id;
    const ok = await call('PATCH', `/employees/${id}`, { designation: 'Head Cook', status: 'ON_NOTICE' }, tok.owner);
    expect(ok.status).toBe(200);
    expect(asEmployee(ok).status).toBe('ON_NOTICE');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'workforce.employee.update', entityId: id } });
    expect(audit.actorId).toBe(uid[U.owner] ?? null);
    expect(JSON.stringify(audit.after)).toContain('Head Cook');

    for (const extra of [{ username: 'x1y2z' }, { userId: uid[U.mgr] }, { roleKey: 'OWNER' }, { joinedOn: '2020-01-01' }, { status: 'EXITED' }]) {
      expect((await call('PATCH', `/employees/${id}`, extra, tok.owner)).status).toBe(400);
    }
  });

  test('a manager outside the outlet cannot read or edit the employee', async () => {
    const id = target.employee.id;
    expect((await call('GET', `/employees/${id}`, undefined, tok.other)).status).toBe(404);
    // A Store Manager holds no update permission at all, so the answer is 403 before any outlet check.
    expect((await call('PATCH', `/employees/${id}`, { designation: 'x' }, tok.other)).status).toBe(403);
  });

  test('a generated username cannot be renamed, and cannot be typed for another account', async () => {
    const userId = (target.employee.user?.id ?? '');
    const rename = await call('PATCH', `/admin/users/${userId}`, { username: 'renamed.person' }, tok.owner);
    expect(rename.status).toBe(409);
    const typed = await call('POST', '/admin/users', { username: 'bmemp9999', roleKey: 'COUNTER_CASHIER', outletIds: [outletId] }, tok.owner);
    expect(typed.status).toBe(400);
  });

  test('the Owner resets the password without ever seeing the old one; sessions end and the audit row holds no secret', async () => {
    const userId = (target.employee.user?.id ?? '');
    const session = await loginAs(target.account.username, INITIAL);
    expect(session.status).toBe(200);

    const reset = await call('POST', '/auth/admin/reset-password', { userId, reason: 'Forgot it at the counter' }, tok.owner);
    expect(reset.status).toBe(200);
    const temp = (reset.body as { temporaryPassword: string }).temporaryPassword;
    expect(typeof temp).toBe('string');
    expect(temp).not.toBe(INITIAL);
    expect(reset.body?.['mustReset']).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mustReset).toBe(true);
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
    expect((await loginAs(target.account.username, INITIAL)).status).toBe(401);
    expect((await loginAs(target.account.username, temp)).status).toBe(200);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'auth.password.reset_other', actorId: uid[U.owner] }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(audit)).not.toContain(temp);
    expect(JSON.stringify(audit)).toContain('Forgot it at the counter');
  });

  test('a kitchen employee cannot reset anyone', async () => {
    const staff = await loginAs(target.account.username, INITIAL);
    // The account is mid-reset after the previous test, so use a fresh one.
    const fresh = (await createAs('owner', 'Cannot Reset')).created;
    const s = await loginAs(fresh.account.username, INITIAL);
    expect(staff.status).toBeGreaterThanOrEqual(200);
    const r = await call('POST', '/auth/admin/reset-password', { userId: uid[U.mgr], reason: 'because' }, s.token);
    expect([401, 403]).toContain(r.status);
  });
});

describe('first login and the employee sign-in', () => {
  let person: Created;
  beforeAll(async () => {
    person = (await createAs('owner', 'First Login')).created;
  });

  test('the generated username signs in typed in capitals, with the initial password, flagged as must-change', async () => {
    const r = await loginAs(person.account.username.toUpperCase(), INITIAL);
    expect(r.status).toBe(200);
    expect(r.body?.['mustReset']).toBe(true);
  });

  test('until the password is changed every business route is refused by the server', async () => {
    const { token } = await loginAs(person.account.username, INITIAL);
    for (const [m, p] of [['GET', '/attendance/today'], ['GET', '/employees'], ['GET', '/tasks'], ['POST', '/attendance/break/start']] as const) {
      const r = await call(m, p, m === 'POST' ? {} : undefined, token);
      expect(r.status).toBe(403);
      expect(code(r)).toBe('AUTH_PASSWORD_RESET_REQUIRED');
    }
    expect((await call('GET', '/auth/me', undefined, token)).status).toBe(200);
  });

  test('the initial password itself, and weak choices, are refused as a new password', async () => {
    const { token } = await loginAs(person.account.username, INITIAL);
    const same = await call('POST', '/auth/change-password', { currentPassword: INITIAL, newPassword: INITIAL }, token);
    expect(same.status).toBe(422);
    // Somebody who already has a real password cannot pick the published default either.
    const cashier = await call('POST', '/auth/change-password', { currentPassword: PASSWORD, newPassword: INITIAL }, tok.cashier);
    expect(cashier.status).toBe(422);
    expect(code(cashier)).toBe('AUTH_WEAK_PASSWORD');
    const short = await call('POST', '/auth/change-password', { currentPassword: INITIAL, newPassword: 'short1' }, token);
    expect(short.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { username: person.account.username } })).mustReset).toBe(true);
  });

  test('a wrong current password cannot be used to change it', async () => {
    const { token } = await loginAs(person.account.username, INITIAL);
    const r = await call('POST', '/auth/change-password', { currentPassword: 'not-the-password', newPassword: 'A-brand-new-pass-91' }, token);
    expect(r.status).toBe(401);
  });

  test('after a valid change the account works, the initial password stops working, old sessions are revoked', async () => {
    const { token } = await loginAs(person.account.username, INITIAL);
    const changed = await call('POST', '/auth/change-password', { currentPassword: INITIAL, newPassword: 'A-brand-new-pass-91' }, token);
    expect(changed.status).toBe(200);
    expect(changed.body?.['mustReset']).toBe(false);

    const fresh = changed.body?.['accessToken'] as string;
    expect((await call('GET', '/attendance/today', undefined, fresh)).status).toBe(200);
    expect((await loginAs(person.account.username, INITIAL)).status).toBe(401);
    expect((await loginAs(person.account.username, 'A-brand-new-pass-91')).status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: person.account.username } });
    expect(user.mustReset).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'auth.password.change', actorId: user.id } })).toBeGreaterThan(0);
  });

  test('a wrong password and an unknown name get the same answer', async () => {
    const wrong = await loginAs(person.account.username, 'definitely-wrong');
    const unknown = await loginAs('bmemp00000', 'definitely-wrong');
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(code(r)).toBe('AUTH_INVALID_CREDENTIALS');
    }
    expect(msg(unknown)).toBe(msg(wrong));
  });

  test('the same shared account still signs in to its own dashboard', async () => {
    const r = await loginAs(U.cashier, PASSWORD, '/auth/login');
    expect(r.status).toBe(200);
  });

  test('an exited employee can no longer sign in, and their sessions are gone', async () => {
    const gone = (await createAs('owner', 'Leaver')).created;
    const s = await loginAs(gone.account.username, INITIAL);
    expect(s.status).toBe(200);
    const exit = await call('POST', `/employees/${gone.employee.id}/exit`, { exitedOn: toBusinessDate(), reason: 'Left the company' }, tok.owner);
    expect(exit.status).toBe(200);
    expect((await loginAs(gone.account.username, INITIAL)).status).toBe(403);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'workforce.employee.exit', entityId: gone.employee.id } });
    expect(audit.actorId).toBe(uid[U.owner] ?? null);
  });
});

describe('employee accounts and dashboard accounts stay separate', () => {
  test('using the shared Counter Cashier account creates no employee, no attendance and no task, and it is refused employee workflows', async () => {
    const count = async () => ({ e: await prisma.employee.count(), d: await prisma.attendanceDay.count(), t: await prisma.task.count() });
    const before = await count();

    const me = await call('GET', '/auth/me', undefined, tok.cashier);
    expect(me.status).toBe(200);
    expect(asMe(me).employeeId).toBeNull();
    for (const [m, p, b] of [
      ['GET', '/attendance/today', undefined],
      ['POST', '/attendance/punch', { direction: 'IN', ...north(10) }],
      ['POST', '/attendance/break/start', {}],
      ['GET', '/tasks', undefined],
    ] as const) {
      const r = await call(m, p, b, tok.cashier, m === 'POST' && p.endsWith('punch') ? idem() : {});
      expect(r.status).toBe(403);
    }
    expect(await count()).toEqual(before);
  });

  test('the shared account is not on the attendance board, in the directory, or assignable', async () => {
    const board = await call('GET', '/attendance/today', undefined, tok.mgr);
    const directory = await call('GET', '/employees?pageSize=100', undefined, tok.mgr);
    for (const r of [board, directory]) expect(JSON.stringify(r.body)).not.toContain(U.cashier);
    const task = await call('POST', '/tasks', { title: 'E2E ID shared assign', outletId, assigneeId: uid[U.cashier] }, tok.mgr);
    expect(task.status).toBeGreaterThanOrEqual(400);
  });

  test('one person, two identities: the employee account and the dashboard account never merge', async () => {
    const personA = (await createAs('owner', 'Person A')).created;
    const personal = await loginAs(personA.account.username, INITIAL);
    const changed = await call('POST', '/auth/change-password', { currentPassword: INITIAL, newPassword: 'Personal-pass-2026' }, personal.token);
    const personalToken = changed.body?.['accessToken'] as string;
    const dashboardToken = tok.cashier;

    const a = await call('GET', '/auth/me', undefined, personalToken);
    const b = await call('GET', '/auth/me', undefined, dashboardToken);
    expect(asMe(a).id).not.toBe(asMe(b).id);
    expect(asMe(a).employeeId).toBe(personA.employee.id);
    expect(asMe(b).employeeId).toBeNull();
    // Different capabilities: the personal account punches, the dashboard account does not.
    const punchPersonal = await call('POST', '/attendance/punch', { direction: 'IN', ...north(20) }, personalToken, idem());
    expect(punchPersonal.status).toBe(201);
    const punchDashboard = await call('POST', '/attendance/punch', { direction: 'IN', ...north(20) }, dashboardToken, idem());
    expect(punchDashboard.status).toBe(403);
    expect(await prisma.attendanceDay.count({ where: { employeeId: personA.employee.id } })).toBe(1);
    // Cashier-only capability is on the dashboard account, not the personal one.
    const aPerms = Object.keys(asMe(a).permissions);
    const bPerms = Object.keys(asMe(b).permissions);
    expect(bPerms).toContain('sales.entry.create');
    expect(aPerms).not.toContain('sales.entry.create');
  });

  test('an employee cannot read, or act as, another employee', async () => {
    const x = (await createAs('owner', 'Isolation X')).created;
    const y = (await createAs('owner', 'Isolation Y')).created;
    const login = async (c: Created) => {
      const s = await loginAs(c.account.username, INITIAL);
      const ch = await call('POST', '/auth/change-password', { currentPassword: INITIAL, newPassword: 'Isolation-pass-77' }, s.token);
      return ch.body?.['accessToken'] as string;
    };
    const tx = await login(x);
    await login(y);
    expect((await call('GET', `/employees/${y.employee.id}`, undefined, tx)).status).toBe(403);
    const forged = await call('POST', '/attendance/punch', { direction: 'IN', employeeId: y.employee.id, ...north(10) }, tx, idem());
    expect([403, 404]).toContain(forged.status);
    expect(await prisma.attendanceDay.count({ where: { employeeId: y.employee.id } })).toBe(0);
    const history = await call('GET', `/attendance?employeeId=${y.employee.id}`, undefined, tx);
    expect(rowsOf(history).length).toBe(0);
  });
});

describe('one eligibility rule across attendance, tasks and reports', () => {
  const analyticsHas = async (code: string) => {
    const r = await call('GET', `/analytics/performance?from=${toBusinessDate()}&to=${toBusinessDate()}`, undefined, tok.owner);
    expect(r.status).toBe(200);
    return JSON.stringify(r.body).includes(code);
  };
  let legacyCode: string;

  beforeAll(async () => {
    legacyCode = (await prisma.employee.findUniqueOrThrow({ where: { id: emp.legacy } })).employeeCode;
  });

  test('before any change, the role-named account with an employee row is an employee everywhere (today\'s behaviour is preserved)', async () => {
    expect(JSON.stringify((await call('GET', '/attendance/today', undefined, tok.mgr)).body)).toContain(legacyCode);
    expect((await call('POST', '/tasks', { title: 'E2E ID before', outletId, assigneeId: emp.legacy }, tok.mgr)).status).toBe(201);
    expect(await analyticsHas(legacyCode)).toBe(true);
    const punch = await call('POST', '/attendance/punch', { direction: 'IN', ...north(10) }, tok.legacy, idem());
    expect(punch.status).toBe(201);
  });

  test('only the Owner may change eligibility, and a reason is required', async () => {
    const body = { eligible: false, reason: 'Shared counter login' };
    for (const who of ['hr', 'mgr', 'cashier', 'legacy', 'other'] as const) {
      expect((await call('POST', `/employees/${emp.legacy}/eligibility`, body, tok[who])).status).toBe(403);
    }
    expect((await call('POST', `/employees/${emp.legacy}/eligibility`, { eligible: false }, tok.owner)).status).toBe(400);
    expect((await call('POST', `/employees/${emp.legacy}/eligibility`, { eligible: false, reason: 'ok' }, tok.owner)).status).toBe(400);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: emp.legacy } })).eligibleForWorkflows).toBe(true);
  });

  test('excluding the record removes it from the board, assignment and analytics, blocks punches, and keeps its history', async () => {
    const r = await call('POST', `/employees/${emp.legacy}/eligibility`, { eligible: false, reason: 'Shared counter login' }, tok.owner);
    expect(r.status).toBe(200);
    expect(asEmployee(r).eligibleForWorkflows).toBe(false);

    expect(JSON.stringify((await call('GET', '/attendance/today', undefined, tok.mgr)).body)).not.toContain(legacyCode);
    expect(await analyticsHas(legacyCode)).toBe(false);
    const task = await call('POST', '/tasks', { title: 'E2E ID after', outletId, assigneeId: emp.legacy }, tok.mgr);
    expect(task.status).toBe(422);

    const out = await call('POST', '/attendance/punch', { direction: 'OUT', ...north(10) }, tok.legacy, idem());
    expect(out.status).toBe(409);
    expect(code(out)).toBe('EMPLOYEE_NOT_ELIGIBLE');
    const entry = await call('POST', '/attendance/punch', { direction: 'OUT', employeeId: emp.legacy, at: new Date().toISOString(), reason: 'Correcting' }, tok.mgr, idem());
    expect(entry.status).toBe(409);
    expect((await call('POST', '/attendance/break/start', {}, tok.legacy)).status).toBe(409);

    // Nothing was deleted: the earlier punch and its day are still there.
    const history = await call('GET', `/attendance?employeeId=${emp.legacy}`, undefined, tok.mgr);
    expect(rowsOf(history).length).toBe(1);
    expect(await prisma.attendancePunch.count({ where: { day: { employeeId: emp.legacy } } })).toBe(1);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'workforce.employee.eligibility', entityId: emp.legacy } });
    expect(audit.actorId).toBe(uid[U.owner] ?? null);
    expect(JSON.stringify(audit.after)).toContain('Shared counter login');
  });

  test('restoring eligibility brings the record back', async () => {
    const r = await call('POST', `/employees/${emp.legacy}/eligibility`, { eligible: true, reason: 'Counted again' }, tok.owner);
    expect(r.status).toBe(200);
    expect(JSON.stringify((await call('GET', '/attendance/today', undefined, tok.mgr)).body)).toContain(legacyCode);
    expect((await call('POST', '/tasks', { title: 'E2E ID restored', outletId, assigneeId: emp.legacy }, tok.mgr)).status).toBe(201);
  });

  test('an employee on notice is still eligible; an exited one is not', async () => {
    const onNotice = (await createAs('owner', 'On Notice')).created;
    expect((await call('PATCH', `/employees/${onNotice.employee.id}`, { status: 'ON_NOTICE' }, tok.owner)).status).toBe(200);
    const task = await call('POST', '/tasks', { title: 'E2E ID notice', outletId, assigneeId: onNotice.employee.id }, tok.mgr);
    expect(task.status).toBe(201);
    expect(JSON.stringify((await call('GET', '/attendance/today', undefined, tok.mgr)).body)).toContain(onNotice.employee.employeeCode);

    expect((await call('POST', `/employees/${onNotice.employee.id}/exit`, { exitedOn: toBusinessDate(), reason: 'Left' }, tok.owner)).status).toBe(200);
    expect(JSON.stringify((await call('GET', '/attendance/today', undefined, tok.mgr)).body)).not.toContain(onNotice.employee.employeeCode);
  });

  test('the existing geofence still applies to an eligible employee, and nothing was loosened', async () => {
    const staff = (await createAs('owner', 'Geofence')).created;
    const s = await loginAs(staff.account.username, INITIAL);
    const ch = await call('POST', '/auth/change-password', { currentPassword: INITIAL, newPassword: 'Geofence-pass-2026' }, s.token);
    const token = ch.body?.['accessToken'] as string;
    const far = await call('POST', '/attendance/punch', { direction: 'IN', ...north(600) }, token, idem());
    expect(far.status).toBe(409);
    expect(code(far)).toBe('ATTENDANCE_OUTSIDE_GEOFENCE');
    expect((await call('POST', '/attendance/punch', { direction: 'IN', ...north(100) }, token, idem())).status).toBe(201);
  });
});
