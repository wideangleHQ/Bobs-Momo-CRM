// Adversarial and integration checks for attendance. Needs an ISOLATED database
// (migrations applied, reference data seeded) and Redis. Never run against the
// shared Supabase project: it creates, mutates and deletes rows.
//   TZ=Asia/Kolkata DATABASE_URL=... DIRECT_URL=... REDIS_URL=... \
//   JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... bun test test/attendance-security.e2e.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { businessDateOffset, toBusinessDate } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';
import { TokenService } from '../src/modules/auth/token.service';
import { OutboxDispatcherService } from '../src/modules/notifications/outbox-dispatcher.service';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;

const PASSWORD = 'saheed-momo-2026';
const U = {
  staff: 'e2e.sec.staff',
  staff2: 'e2e.sec.staff2',
  mgr: 'e2e.sec.mgr', // STORE_MANAGER and an employee
  mgrB: 'e2e.sec.mgrb', // STORE_MANAGER, no employee record
  mgrOther: 'e2e.sec.mgro', // STORE_MANAGER of the other outlet
  hr: 'e2e.sec.hr',
  ops: 'e2e.sec.ops',
  owner: 'e2e.sec.owner',
};
const ALL_USERNAMES = Object.values(U);

const SITE = { latitude: 20.3661741, longitude: 85.7944251 };
const RADIUS_M = 500;
const north = (m: number) => ({
  location: { latitude: SITE.latitude + m / 111_194.93, longitude: SITE.longitude, accuracyM: 10 },
});

let outletId: string;
let otherOutletId: string;
let departmentId: string;
let originalGeofence: {
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number | null;
};
const tok: Record<keyof typeof U, string> = {} as Record<keyof typeof U, string>;
const emp: Record<'staff' | 'staff2' | 'mgr', string> = { staff: '', staff2: '', mgr: '' };
const userId: Record<string, string> = {};

async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const code = (r: { body: Record<string, unknown> | null }) =>
  (r.body?.['error'] as { code?: string } | undefined)?.code;
const idem = () => ({ 'idempotency-key': crypto.randomUUID() });
const punch = (who: keyof typeof U, body: Record<string, unknown>, key = idem()) =>
  call('POST', '/attendance/punch', body, tok[who], key);
const date = (offset: number) => businessDateOffset(offset).toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
const uuid0 = '00000000-0000-4000-8000-000000000000';

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { in: ALL_USERNAMES } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({
    where: { OR: [{ userId: { in: ids } }, { fullName: { startsWith: 'E2E SEC' } }] },
    select: { id: true },
  });
  const empIds = employees.map((e) => e.id);
  const days = await prisma.attendanceDay.findMany({
    where: { employeeId: { in: empIds } },
    select: { id: true },
  });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: days.map((d) => d.id) } } });
  await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.shift.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { id: { in: empIds } } });
  await prisma.user.deleteMany({ where: { username: { in: ALL_USERNAMES } } });
}
const clearDays = (...who: ('staff' | 'staff2' | 'mgr')[]) =>
  prisma.attendanceDay.deleteMany({ where: { employeeId: { in: who.map((w) => emp[w]) } } });

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
  originalGeofence = {
    latitude: outlet.latitude,
    longitude: outlet.longitude,
    geofenceRadiusM: outlet.geofenceRadiusM,
  };
  await prisma.outlet.update({ where: { id: outletId }, data: { ...SITE, geofenceRadiusM: RADIUS_M } });
  departmentId = (
    await prisma.department.findFirstOrThrow({ where: { outletId, name: 'Kitchen' } })
  ).id;

  const mk = async (
    username: string,
    roleKey: 'KITCHEN_STAFF' | 'STORE_MANAGER' | 'HR_ACCOUNTS' | 'OPERATIONS_MANAGER' | 'OWNER',
    outlets: string[],
  ) => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    for (const o of outlets) await prisma.userOutlet.create({ data: { userId: user.id, outletId: o } });
    userId[username] = user.id;
    return user;
  };
  const withEmployee = async (user: { id: string }, n: number, name: string) =>
    (
      await prisma.employee.create({
        data: {
          employeeCode: `BM-EMP-91${n}`,
          userId: user.id,
          fullName: `E2E SEC ${name}`,
          phone: `99379991${n}`,
          outletId,
          departmentId,
          joinedOn: new Date('2026-01-01T00:00:00.000Z'),
        },
      })
    ).id;

  const staff = await mk(U.staff, 'KITCHEN_STAFF', [outletId]);
  const staff2 = await mk(U.staff2, 'KITCHEN_STAFF', [outletId]);
  const mgr = await mk(U.mgr, 'STORE_MANAGER', [outletId]);
  await mk(U.mgrB, 'STORE_MANAGER', [outletId]);
  await mk(U.mgrOther, 'STORE_MANAGER', [otherOutletId]);
  await mk(U.hr, 'HR_ACCOUNTS', [outletId]);
  await mk(U.ops, 'OPERATIONS_MANAGER', []);
  await mk(U.owner, 'OWNER', []);
  emp.staff = await withEmployee(staff, 11, 'Staff');
  emp.staff2 = await withEmployee(staff2, 12, 'Staff Two');
  emp.mgr = await withEmployee(mgr, 13, 'Manager');

  for (const [key, username] of Object.entries(U)) {
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: username, password: PASSWORD }),
    });
    tok[key as keyof typeof U] = ((await res.json()) as { accessToken: string }).accessToken;
  }
});

afterAll(async () => {
  await cleanup();
  if (outletId && originalGeofence) {
    await prisma.outlet.update({ where: { id: outletId }, data: originalGeofence });
  }
  await prisma.$disconnect();
  await app?.close();
});

describe('authentication', () => {
  const routes: [string, string][] = [
    ['POST', '/attendance/punch'],
    ['POST', '/attendance/break/start'],
    ['POST', '/attendance/break/end'],
    ['GET', '/attendance/today'],
    ['GET', '/attendance'],
    ['GET', '/attendance/summary'],
    ['GET', '/attendance/verification-queue'],
    ['POST', `/attendance/days/${uuid0}/verify`],
    ['POST', `/attendance/days/${uuid0}/reject`],
    ['PATCH', `/attendance/punches/${uuid0}`],
  ];

  test.each(routes)('%s %s needs a token', async (method, path) => {
    const res = await call(method, path, method === 'GET' ? undefined : {});
    expect(res.status).toBe(401);
  });

  test('a garbage, truncated or tampered token is refused', async () => {
    const good = tok.staff;
    const flipped = `${good.slice(0, -2)}${good.endsWith('A') ? 'B' : 'A'}${good.slice(-1)}`;
    for (const bad of ['garbage', good.split('.').slice(0, 2).join('.'), flipped]) {
      expect((await call('GET', '/attendance/today', undefined, bad)).status).toBe(401);
    }
  });

  test('a token carrying an out-of-date permission set is refused, not honoured', async () => {
    const stale = await app.get(TokenService).signAccess({
      sub: userId[U.mgrB]!,
      roleKey: 'STORE_MANAGER',
      employeeId: null,
      outletIds: [outletId],
      scope: 'OWN_OUTLET',
      permHash: 'stale',
      mustReset: false,
    });
    const res = await call('GET', '/attendance/verification-queue', undefined, stale);
    expect(res.status).toBe(401);
    expect(code(res)).toBe('AUTH_PERMISSIONS_STALE');
  });
});

describe('authorization matrix', () => {
  test('only a Store Manager holds the verification routes', async () => {
    for (const who of ['staff', 'hr', 'ops', 'owner'] as const) {
      expect((await call('GET', '/attendance/verification-queue', undefined, tok[who])).status).toBe(403);
      expect((await call('POST', `/attendance/days/${uuid0}/verify`, {}, tok[who])).status).toBe(403);
      expect(
        (await call('POST', `/attendance/days/${uuid0}/reject`, { reason: 'because' }, tok[who])).status,
      ).toBe(403);
    }
    expect((await call('GET', '/attendance/verification-queue', undefined, tok.mgrB)).status).toBe(200);
  });

  test('staff cannot edit punches or list the whole outlet', async () => {
    expect(
      (await call('PATCH', `/attendance/punches/${uuid0}`, { punchedAt: new Date().toISOString(), reason: 'abc' }, tok.staff))
        .status,
    ).toBe(403);
    await clearDays('staff', 'staff2');
    expect((await punch('staff2', { direction: 'IN', ...north(10) })).status).toBe(201);
    const res = await call('GET', `/attendance?employeeId=${emp.staff2}`, undefined, tok.staff);
    expect(res.status).toBe(200);
    expect((res.body?.['data'] as unknown[]).length).toBe(0);
    await clearDays('staff2');
  });

  test('staff cannot reach another outlet through outletId', async () => {
    expect((await call('GET', `/attendance?outletId=${otherOutletId}`, undefined, tok.staff)).status).toBe(404);
    expect(
      (await call('GET', `/attendance/verification-queue?outletId=${otherOutletId}`, undefined, tok.mgrB)).status,
    ).toBe(404);
  });
});

describe('forged request fields', () => {
  // Built lazily: otherOutletId is only known once beforeAll has run.
  const forged: [string, () => Record<string, unknown>][] = [
    ['a client distance', () => ({ distanceM: 0 })],
    ['an outlet id', () => ({ outletId: otherOutletId })],
    ['a verification status', () => ({ verificationStatus: 'VERIFIED' })],
    ['a verifier', () => ({ verifiedById: uuid0 })],
    ['a role', () => ({ roleKey: 'OWNER' })],
    ['a top-level latitude', () => ({ latitude: SITE.latitude })],
  ];

  test.each(forged)('a punch carrying %s is rejected and writes nothing', async (_n, make) => {
    const extra = make();
    expect(Object.values(extra).every((v) => v !== undefined)).toBe(true);
    await clearDays('staff');
    const res = await punch('staff', { direction: 'IN', ...north(10), ...extra });
    // A foreign outletId is answered 404 by the outlet guard (it must not confirm
    // the outlet exists); every other forged field fails validation with 400.
    expect([400, 404]).toContain(res.status);
    expect(await prisma.attendancePunch.count({ where: { day: { employeeId: emp.staff } } })).toBe(0);
  });

  test('a decision cannot name its own actor, time or outcome', async () => {
    for (const extra of [{ verifiedById: uuid0 }, { verifiedAt: '2020-01-01T00:00:00.000Z' }, { verificationStatus: 'VERIFIED' }]) {
      expect((await call('POST', `/attendance/days/${uuid0}/verify`, extra, tok.mgrB)).status).toBe(400);
      expect(
        (await call('POST', `/attendance/days/${uuid0}/reject`, { reason: 'long enough', ...extra }, tok.mgrB)).status,
      ).toBe(400);
    }
  });

  test('a break cannot name an employee or outlet', async () => {
    expect((await call('POST', '/attendance/break/start', { employeeId: emp.staff2 }, tok.staff)).status).toBe(400);
    expect([400, 404]).toContain(
      (await call('POST', '/attendance/break/start', { outletId: otherOutletId }, tok.staff)).status,
    );
  });

  test('a client cannot override the calculated percentage', async () => {
    const res = await call(
      'GET',
      '/attendance/summary?attendancePercent=100&eligibleDays=1&verifiedPresentDays=1',
      undefined,
      tok.staff,
    );
    expect(res.status).toBe(200);
    expect(res.body?.['attendancePercent']).toBeNull();
    expect(res.body?.['eligibleDays']).toBe(0);
  });
});

describe('malformed coordinates', () => {
  const bad: [string, unknown][] = [
    ['latitude above 90', { latitude: 90.0001, longitude: 85 }],
    ['latitude below -90', { latitude: -91, longitude: 85 }],
    ['longitude above 180', { latitude: 20, longitude: 180.5 }],
    ['strings', { latitude: '20.36', longitude: '85.79' }],
    ['null coordinates', { latitude: null, longitude: null }],
    ['a missing longitude', { latitude: 20.36 }],
    ['an empty object', {}],
    ['a negative accuracy', { latitude: 20.36, longitude: 85.79, accuracyM: -1 }],
    ['an extra key', { latitude: 20.36, longitude: 85.79, distanceM: 0 }],
    ['an array', [20.36, 85.79]],
  ];
  test.each(bad)('%s is refused and nothing is written', async (_n, location) => {
    await clearDays('staff');
    const res = await punch('staff', { direction: 'IN', location });
    expect(res.status).toBe(400);
    expect(await prisma.attendanceDay.count({ where: { employeeId: emp.staff } })).toBe(0);
  });

  test('NaN and Infinity cannot survive JSON and are refused', async () => {
    const res = await fetch(`${url}/attendance/punch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.staff}`, ...idem() },
      body: '{"direction":"IN","location":{"latitude":NaN,"longitude":Infinity}}',
    });
    expect(res.status).toBe(400);
  });

  test('1 m either side of the boundary is decided by the server', async () => {
    await clearDays('staff');
    expect(errorOf(await punch('staff', { direction: 'IN', ...north(501) }))).toBe('ATTENDANCE_OUTSIDE_GEOFENCE');
    expect((await punch('staff', { direction: 'IN', ...north(499) })).status).toBe(201);
    await clearDays('staff');
  });
});
function errorOf(r: { body: Record<string, unknown> | null }) {
  return code(r);
}

describe('punch integrity', () => {
  test('a self punch cannot be backdated or future-dated', async () => {
    for (const at of [new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)]) {
      const res = await punch('staff', { direction: 'IN', at: at.toISOString(), reason: 'trying', ...north(10) });
      expect(res.status).toBe(403);
    }
  });

  test('a manager cannot enter a future punch, nor move one into the future', async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const res = await punch('mgrB', { direction: 'IN', employeeId: emp.staff, at: future, reason: 'early' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('ATTENDANCE_FUTURE_PUNCH');

    await clearDays('staff');
    expect((await punch('staff', { direction: 'IN', ...north(10) })).status).toBe(201);
    const row = await prisma.attendancePunch.findFirstOrThrow({ where: { day: { employeeId: emp.staff } } });
    const edit = await call(
      'PATCH',
      `/attendance/punches/${row.id}`,
      { punchedAt: future, reason: 'moving it ahead' },
      tok.mgrB,
    );
    expect(edit.status).toBe(400);
    expect(code(edit)).toBe('ATTENDANCE_FUTURE_PUNCH');
    await clearDays('staff');
  });

  test('a retried request replays; the same key with a different body is refused', async () => {
    await clearDays('staff');
    const key = idem();
    const a = await punch('staff', { direction: 'IN', ...north(10) }, key);
    const b = await punch('staff', { direction: 'IN', ...north(10) }, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((b.body?.['punch'] as { id: string }).id).toBe((a.body?.['punch'] as { id: string }).id);
    expect(await prisma.attendancePunch.count({ where: { day: { employeeId: emp.staff } } })).toBe(1);

    const clash = await punch('staff', { direction: 'IN', ...north(20) }, key);
    expect(clash.status).toBe(409);
    expect(code(clash)).toBe('IDEMPOTENCY_KEY_REPLAYED');
    await clearDays('staff');
  });

  test('the database refuses a half-configured or out-of-range outlet location', async () => {
    const set = async (data: Record<string, unknown>) =>
      prisma.outlet.update({ where: { id: otherOutletId }, data: data as never });
    await expect(set({ latitude: 20.3 })).rejects.toThrow();
    await expect(set({ latitude: 20.3, longitude: 85.7 })).rejects.toThrow();
    await expect(set({ latitude: 20.3, longitude: 85.7, geofenceRadiusM: 0 })).rejects.toThrow();
    await expect(set({ latitude: 91, longitude: 85.7, geofenceRadiusM: 500 })).rejects.toThrow();
    const clean = await prisma.outlet.findUniqueOrThrow({ where: { id: otherOutletId } });
    expect([clean.latitude, clean.longitude, clean.geofenceRadiusM]).toEqual([null, null, null]);
  });

  test('an inactive outlet refuses self punches', async () => {
    await prisma.outlet.update({ where: { id: outletId }, data: { isActive: false } });
    try {
      const res = await punch('staff', { direction: 'IN', ...north(10) });
      expect(res.status).toBe(409);
      expect(code(res)).toBe('ATTENDANCE_OUTLET_INACTIVE');
    } finally {
      await prisma.outlet.update({ where: { id: outletId }, data: { isActive: true } });
    }
  });

  test('an exited employee cannot punch, even by naming their own id', async () => {
    await prisma.employee.update({ where: { id: emp.staff }, data: { status: 'EXITED' } });
    try {
      for (const body of [
        { direction: 'IN', ...north(10) },
        { direction: 'IN', employeeId: emp.staff, ...north(10) },
      ]) {
        const res = await punch('staff', body);
        expect(res.status).toBe(409);
        expect(code(res)).toBe('ATTENDANCE_EMPLOYEE_EXITED');
      }
      expect((await call('POST', '/attendance/break/start', {}, tok.staff)).status).toBe(409);
    } finally {
      await prisma.employee.update({ where: { id: emp.staff }, data: { status: 'ACTIVE' } });
    }
  });

  test('a manager-entered OUT leaves an open break visibly open, never closes it', async () => {
    await clearDays('staff');
    await punch('staff', { direction: 'IN', ...north(10) });
    expect((await call('POST', '/attendance/break/start', {}, tok.staff)).status).toBe(200);
    const out = await punch('mgrB', { direction: 'OUT', employeeId: emp.staff, at: new Date().toISOString(), reason: 'Left in a hurry' });
    expect(out.status).toBe(201);
    expect((out.body?.['attendanceDay'] as { openBreak: boolean }).openBreak).toBe(true);
    const day = await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: emp.staff } });
    expect(await prisma.breakLog.count({ where: { attendanceDayId: day.id, endedAt: null } })).toBe(1);
    await clearDays('staff');
  });

  test('a break cannot start after check-out or before check-in', async () => {
    await clearDays('staff');
    const before = await call('POST', '/attendance/break/start', {}, tok.staff);
    expect(before.status).toBe(409);
    expect(code(before)).toBe('ATTENDANCE_NOT_PUNCHED_IN');
    await punch('staff', { direction: 'IN', ...north(10) });
    await punch('staff', { direction: 'OUT', ...north(10) });
    const after = await call('POST', '/attendance/break/start', {}, tok.staff);
    expect(after.status).toBe(409);
    await clearDays('staff');
  });
});

describe('verification integrity, audit and notifications', () => {
  let dayId: string;
  const audits = (action: string, id: string) =>
    prisma.auditLog.count({ where: { action, entityId: id } });
  const outbox = (eventKey: string, id: string) =>
    prisma.outboxEvent.count({ where: { eventKey, aggregateId: id } });
  // The dispatcher compares availableAt (app clock) with the database clock, so
  // two hosts whose clocks disagree delay delivery. That is real but orthogonal;
  // this makes the rows claimable now and drains the queue in batches of 50.
  const deliver = async (id: string) => {
    await prisma.outboxEvent.updateMany({
      where: { aggregateId: id, status: 'PENDING' },
      data: { availableAt: new Date(Date.now() - 10 * 60_000) },
    });
    for (let i = 0; i < 10; i++) {
      await app.get(OutboxDispatcherService).dispatch();
      const open = await prisma.outboxEvent.count({ where: { aggregateId: id, status: { not: 'DONE' } } });
      if (open === 0) return;
    }
  };

  beforeAll(async () => {
    await clearDays('staff', 'mgr');
    await punch('staff', { direction: 'IN', ...north(10) });
    dayId = (await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: emp.staff } })).id;
  });

  test('refused decisions leave no audit row and no notification', async () => {
    const refused = [
      call('POST', `/attendance/days/${dayId}/reject`, { reason: 'no' }, tok.mgrB), // too short
      call('POST', `/attendance/days/${dayId}/verify`, {}, tok.mgrOther), // other outlet
      call('POST', `/attendance/days/${dayId}/verify`, {}, tok.staff), // not permitted
    ];
    expect((await Promise.all(refused)).map((r) => r.status)).toEqual([400, 404, 403]);
    expect(await audits('workforce.attendance.verify', dayId)).toBe(0);
    expect(await audits('workforce.attendance.reject', dayId)).toBe(0);
    expect(await outbox('ATTENDANCE_DECIDED', dayId)).toBe(0);
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: dayId } })).verificationStatus).toBe('PENDING');
  });

  test('a manager who is also an employee cannot decide their own day', async () => {
    await punch('mgr', { direction: 'IN', ...north(10) });
    const own = await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: emp.mgr } });
    const res = await call('POST', `/attendance/days/${own.id}/verify`, {}, tok.mgr);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('ATTENDANCE_SELF_VERIFY');
    expect(await audits('workforce.attendance.verify', own.id)).toBe(0);
    // A different manager of the same outlet can.
    expect((await call('POST', `/attendance/days/${own.id}/verify`, {}, tok.mgrB)).status).toBe(200);
  });

  test('a decision records the token identity, and the notifications reach the right people', async () => {
    expect((await call('POST', `/attendance/days/${dayId}/reject`, { reason: 'Shown at the wrong site' }, tok.mgrB)).status).toBe(200);
    const row = await prisma.attendanceDay.findUniqueOrThrow({ where: { id: dayId } });
    expect(row.verifiedById).toBe(userId[U.mgrB]!);
    expect(row.verifiedAt).not.toBeNull();
    expect(row.verificationNote).toBe('Shown at the wrong site');
    expect(await audits('workforce.attendance.reject', dayId)).toBe(1);

    await deliver(dayId);
    const toStaff = await prisma.notification.findMany({
      where: { userId: userId[U.staff]!, eventKey: 'ATTENDANCE_DECIDED' },
    });
    expect(toStaff.length).toBe(1);
    expect(toStaff[0]?.body).toContain('rejected');
    expect(toStaff[0]?.body).toContain('Shown at the wrong site');
    expect(toStaff[0]?.deepLink).toBe('/attendance');

    const toManagers = await prisma.notification.findMany({
      where: { eventKey: 'ATTENDANCE_SUBMITTED', userId: { in: [userId[U.mgr]!, userId[U.mgrB]!] } },
    });
    expect(toManagers.length).toBeGreaterThanOrEqual(2);
    // The other outlet's manager, HR, ops and the employee are not told.
    const others = await prisma.notification.count({
      where: {
        eventKey: 'ATTENDANCE_SUBMITTED',
        userId: { in: [userId[U.mgrOther]!, userId[U.hr]!, userId[U.staff]!] },
      },
    });
    expect(others).toBe(0);
  });

  test('redelivering the same outbox row does not duplicate the notification', async () => {
    await prisma.outboxEvent.updateMany({
      where: { aggregateId: dayId, eventKey: 'ATTENDANCE_DECIDED' },
      data: { status: 'PENDING', processedAt: null },
    });
    await deliver(dayId);
    expect(
      await prisma.notification.count({ where: { userId: userId[U.staff]!, eventKey: 'ATTENDANCE_DECIDED' } }),
    ).toBe(1);
  });

  test('neither the outbox, the audit row nor a notification carries location data', async () => {
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: dayId } });
    const audit = await prisma.auditLog.findMany({ where: { entityId: dayId } });
    const notes = await prisma.notification.findMany({ where: { userId: { in: [userId[U.staff]!, userId[U.mgrB]!] } } });
    const blob = JSON.stringify([events, audit, notes]);
    expect(blob).not.toMatch(/latitude|longitude|accuracy|distanceM|20\.3661|85\.7944/i);
  });

  test('a rejected day stays rejected after a manager enters a correction', async () => {
    const res = await punch('mgrB', {
      direction: 'OUT',
      employeeId: emp.staff,
      at: new Date().toISOString(),
      reason: 'Correcting the close time',
    });
    expect(res.status).toBe(201);
    expect((await prisma.attendanceDay.findUniqueOrThrow({ where: { id: dayId } })).verificationStatus).toBe('REJECTED');
    expect(await audits('workforce.attendance.manual_punch', dayId)).toBe(1);
  });

  test('the database itself refuses an incomplete decision', async () => {
    const day = await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: emp.mgr } });
    const set = async (data: Record<string, unknown>) =>
      prisma.attendanceDay.update({ where: { id: day.id }, data: data as never });
    await set({ verificationStatus: 'PENDING', verifiedById: null, verifiedAt: null });
    await expect(set({ verificationStatus: 'VERIFIED', verifiedById: null, verifiedAt: null })).rejects.toThrow();
    await expect(
      set({ verificationStatus: 'REJECTED', verifiedById: userId[U.mgrB], verifiedAt: new Date(), verificationNote: null }),
    ).rejects.toThrow();
    await expect(
      set({ verificationStatus: 'REJECTED', verifiedById: userId[U.mgrB], verifiedAt: new Date(), verificationNote: 'abc' }),
    ).rejects.toThrow();
  });
});

describe('history and percentage against real rows', () => {
  const windowStart = () => date(-364);

  beforeAll(async () => {
    await clearDays('staff2');
    const creator = userId[U.hr]!;
    const mkShift = (offset: number) =>
      prisma.shift.create({
        data: {
          employeeId: emp.staff2,
          outletId,
          shiftDate: asDate(date(offset)),
          startsAt: new Date(`${date(offset)}T09:00:00+05:30`),
          endsAt: new Date(`${date(offset)}T17:00:00+05:30`),
          createdById: creator,
        },
      });
    const mkDay = (offset: number, status: 'PRESENT' | 'HALF_DAY', v: 'PENDING' | 'VERIFIED' | 'REJECTED' | null) =>
      prisma.attendanceDay.create({
        data: {
          employeeId: emp.staff2,
          outletId,
          businessDate: asDate(date(offset)),
          status,
          verificationStatus: v,
          ...(v === 'VERIFIED' || v === 'REJECTED'
            ? {
                verifiedById: userId[U.mgrB]!,
                verifiedAt: new Date(),
                verificationNote: v === 'REJECTED' ? 'Not at the outlet' : null,
              }
            : {}),
        },
      });
    for (const o of [-12, -11, -10, -9, -8, -7]) await mkShift(o);
    await mkDay(-12, 'PRESENT', 'VERIFIED');
    await mkDay(-11, 'PRESENT', 'VERIFIED');
    await mkDay(-10, 'HALF_DAY', 'VERIFIED');
    await mkDay(-9, 'PRESENT', 'PENDING');
    await mkDay(-8, 'PRESENT', 'REJECTED');
    await mkDay(-7, 'PRESENT', null); // legacy: no verification record
    const leave = (from: number, to: number, status: 'APPROVED' | 'PENDING' | 'REJECTED', days: string) =>
      prisma.leaveRequest.create({
        data: {
          employeeId: emp.staff2,
          type: 'CASUAL',
          fromDate: asDate(date(from)),
          toDate: asDate(date(to)),
          dayCount: days,
          reason: 'e2e leave',
          status,
        },
      });
    await leave(-9, -9, 'APPROVED', '1.0'); // full day: leaves the denominator
    await leave(-11, -11, 'APPROVED', '0.5'); // half day: reported, not weighted
    await leave(-8, -8, 'PENDING', '1.0'); // pending: no effect
    await leave(-7, -7, 'REJECTED', '1.0'); // rejected: no effect
  });
  afterAll(async () => {
    await clearDays('staff2');
  });

  test('the SRS formula holds against stored shifts, leave and verification', async () => {
    const res = await call('GET', '/attendance/summary', undefined, tok.staff2);
    expect(res.status).toBe(200);
    const s = res.body as Record<string, number | null>;
    expect(s['scheduledWorkingDays']).toBe(6);
    expect(s['approvedLeaveDays']).toBe(1);
    expect(s['eligibleDays']).toBe(5);
    expect(s['verifiedPresentDays']).toBe(3);
    expect(s['attendancePercent']).toBe(60);
    expect(s['halfDayLeaveDays']).toBe(1);
    expect(s['pendingDays']).toBe(1);
    expect(s['rejectedDays']).toBe(1);
    expect(s['unverifiedDays']).toBe(1);
  });

  test('a manager sees the same figure for the same employee', async () => {
    const res = await call('GET', `/attendance/summary?employeeId=${emp.staff2}`, undefined, tok.mgrB);
    expect(res.status).toBe(200);
    expect(res.body?.['attendancePercent']).toBe(60);
  });

  test('cross-employee and cross-outlet summaries are refused', async () => {
    expect((await call('GET', `/attendance/summary?employeeId=${emp.staff2}`, undefined, tok.staff)).status).toBe(404);
    expect((await call('GET', `/attendance/summary?employeeId=${emp.staff2}`, undefined, tok.mgrOther)).status).toBe(404);
  });

  test('an employee with no roster gets null, not 0', async () => {
    const res = await call('GET', '/attendance/summary', undefined, tok.staff);
    expect(res.body?.['attendancePercent']).toBeNull();
  });

  test('the 365-day window: first day in, the day before out', async () => {
    expect((await call('GET', `/attendance?from=${windowStart()}`, undefined, tok.staff2)).status).toBe(200);
    expect((await call('GET', `/attendance?from=${date(-365)}`, undefined, tok.staff2)).status).toBe(400);
    expect((await call('GET', `/attendance/summary?from=${windowStart()}`, undefined, tok.staff2)).status).toBe(200);
    const out = await call('GET', `/attendance/summary?from=${date(-365)}`, undefined, tok.staff2);
    expect(out.status).toBe(400);
    expect(code(out)).toBe('ATTENDANCE_WINDOW_EXCEEDED');
    expect(toBusinessDate()).toBe(date(0));
  });

  test('filters and pagination cannot be abused', async () => {
    for (const q of ['pageSize=101', 'pageSize=0', 'page=0', 'pageSize=abc', 'from=garbage', 'from=2026-13-45', 'verification=NOPE', 'status=NOPE']) {
      expect((await call('GET', `/attendance?${q}`, undefined, tok.staff2)).status).toBe(400);
    }
    expect((await call('GET', '/attendance/verification-queue?pageSize=1000', undefined, tok.mgrB)).status).toBe(400);
    expect((await call('GET', '/attendance/summary?employeeId=not-a-uuid', undefined, tok.mgrB)).status).toBe(400);
    const swapped = await call('GET', `/attendance?from=${date(0)}&to=${date(-5)}`, undefined, tok.staff2);
    expect(swapped.status).toBe(200);
    expect((swapped.body?.['data'] as unknown[]).length).toBe(0);
  });

  test('the verification filter returns only that status, and only own rows for staff', async () => {
    const res = await call('GET', '/attendance?verification=REJECTED', undefined, tok.staff2);
    const rows = res.body?.['data'] as { verificationStatus: string; employeeId: string; verificationNote: string }[];
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.verificationStatus === 'REJECTED' && r.employeeId === emp.staff2)).toBe(true);
    expect(rows[0]?.verificationNote).toBe('Not at the outlet');
    expect(JSON.stringify(rows)).not.toContain('verifiedById');
  });
});
