// bun test apps/api
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

let hrToken: string; // HR_ACCOUNTS: employees, salary, leave decisions
let mgrToken: string; // STORE_MANAGER: shifts, attendance edit, leave decisions
let staffToken: string; // KITCHEN_STAFF: punch, break, own leave only
let outletId: string;
let departmentId: string;
let staffEmployeeId: string;
let originalGeofence: {
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number | null;
};

// Fixture only: the Pathargadia pin. One degree of latitude is 111,194.93 m on
// the haversine sphere the server uses, so offsets are metres due north.
const SITE = { latitude: 20.3661741, longitude: 85.7944251 };
const RADIUS_M = 500;
const north = (metres: number) => ({
  location: {
    latitude: SITE.latitude + metres / 111_194.93,
    longitude: SITE.longitude,
    accuracyM: 12,
  },
});

const PASSWORD = 'saheed-momo-2026';
const HR = 'e2e.wf.hr';
const MGR = 'e2e.wf.mgr';
const STAFF = 'e2e.wf.staff';
const MGR2 = 'e2e.wf.mgr2'; // STORE_MANAGER who is also an employee
const MGR_OTHER = 'e2e.wf.mgr.other'; // STORE_MANAGER of the other outlet

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = hrToken,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
}

function idem(): Record<string, string> {
  return { 'idempotency-key': crypto.randomUUID() };
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { in: [HR, MGR, STAFF, MGR2, MGR_OTHER] } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({
    where: { OR: [{ userId: { in: ids } }, { fullName: { startsWith: 'E2E WF' } }] },
    select: { id: true },
  });
  const empIds = employees.map((e) => e.id);

  await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.shift.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.salaryRecord.deleteMany({ where: { employeeId: { in: empIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: empIds } } });
  await prisma.user.deleteMany({ where: { username: { in: [HR, MGR, STAFF, MGR2, MGR_OTHER] } } });
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

  const passwords = app.get(PasswordService);
  const hash = await passwords.hash(PASSWORD);
  const outlet = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  outletId = outlet.id;
  originalGeofence = {
    latitude: outlet.latitude,
    longitude: outlet.longitude,
    geofenceRadiusM: outlet.geofenceRadiusM,
  };
  await prisma.outlet.update({ where: { id: outletId }, data: { ...SITE, geofenceRadiusM: RADIUS_M } });
  const department = await prisma.department.findFirstOrThrow({
    where: { outletId, name: 'Kitchen' },
  });
  departmentId = department.id;

  const mk = async (username: string, roleKey: 'HR_ACCOUNTS' | 'STORE_MANAGER' | 'KITCHEN_STAFF') => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    await prisma.userOutlet.create({ data: { userId: user.id, outletId } });
    return user;
  };
  await mk(HR, 'HR_ACCOUNTS');
  await mk(MGR, 'STORE_MANAGER');
  const staffUser = await mk(STAFF, 'KITCHEN_STAFF');

  const staffEmployee = await prisma.employee.create({
    data: {
      employeeCode: 'BM-EMP-9001',
      userId: staffUser.id,
      fullName: 'E2E WF Cook',
      phone: '9937999001',
      outletId,
      departmentId,
      joinedOn: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  staffEmployeeId = staffEmployee.id;

  const login = async (identifier: string) => {
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: PASSWORD }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  hrToken = await login(HR);
  mgrToken = await login(MGR);
  staffToken = await login(STAFF);
});

afterAll(async () => {
  await cleanup();
  if (outletId && originalGeofence) {
    await prisma.outlet.update({ where: { id: outletId }, data: originalGeofence });
  }
  await prisma.$disconnect();
  await app?.close();
});

describe('employees', () => {
  let createdId: string;

  test('HR creates an employee and the code is allocated', async () => {
    const res = await api('POST', '/employees', {
      fullName: 'E2E WF Helper',
      phone: '9937999002',
      outletId,
      departmentId,
      joinedOn: toBusinessDate(),
    });
    expect(res.status).toBe(201);
    expect(String(res.body?.['employeeCode'])).toMatch(/^BM-EMP-\d{4}$/);
    createdId = res.body?.['id'] as string;
  });

  test('a department from the other outlet is refused', async () => {
    const other = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
    const otherDept = await prisma.department.findFirstOrThrow({
      where: { outletId: other.id, name: 'Kitchen' },
    });
    const res = await api('PATCH', `/employees/${createdId}`, { departmentId: otherDept.id });
    expect(res.status).toBe(400);
  });

  test('kitchen staff cannot list the roster', async () => {
    const res = await api('GET', '/employees', undefined, staffToken);
    expect(res.status).toBe(403);
  });

  test('an exit disables the login and revokes its sessions', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: STAFF } });
    const res = await api('POST', `/employees/${staffEmployeeId}/exit`, {
      exitedOn: toBusinessDate(),
      reason: 'Moved to another city',
    });
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('EXITED');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe('DISABLED');

    // Put it back so the attendance tests below can still log in.
    await prisma.employee.update({
      where: { id: staffEmployeeId },
      data: { status: 'ACTIVE', exitedOn: null },
    });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
  });
});

describe('attendance geofence and identity', () => {
  const clearStaffDays = () =>
    prisma.attendanceDay.deleteMany({ where: { employeeId: staffEmployeeId } });

  test('a self punch without a location is refused', async () => {
    const res = await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken, idem());
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('ATTENDANCE_LOCATION_REQUIRED');
  });

  test('501 m from the outlet is outside, 499 m is inside', async () => {
    const outside = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', ...north(501) },
      staffToken,
      idem(),
    );
    expect(outside.status).toBe(409);
    expect(errorCode(outside)).toBe('ATTENDANCE_OUTSIDE_GEOFENCE');
    expect(await prisma.attendancePunch.count({ where: { day: { employeeId: staffEmployeeId } } })).toBe(0);

    const inside = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', ...north(499) },
      staffToken,
      idem(),
    );
    expect(inside.status).toBe(201);
    const row = await prisma.attendancePunch.findFirstOrThrow({
      where: { day: { employeeId: staffEmployeeId } },
    });
    expect(row.source).toBe('WEB');
    expect(row.distanceM).toBeGreaterThan(498);
    expect(row.distanceM).toBeLessThan(500);
    await clearStaffDays();
  });

  test('the client cannot supply its own distance', async () => {
    const res = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', location: { ...north(0).location, distanceM: 0 } },
      staffToken,
      idem(),
    );
    expect(res.status).toBe(400);
  });

  test('staff cannot backdate by sending a time', async () => {
    const res = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', at: new Date(Date.now() - 3_600_000).toISOString(), reason: 'forgot' },
      staffToken,
      idem(),
    );
    expect(res.status).toBe(403);
  });

  test('staff naming their own employee id is still a geofenced self punch', async () => {
    const res = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', employeeId: staffEmployeeId },
      staffToken,
      idem(),
    );
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('ATTENDANCE_LOCATION_REQUIRED');
  });

  test('staff cannot punch for another employee', async () => {
    const other = await prisma.employee.findFirstOrThrow({
      where: { outletId, id: { not: staffEmployeeId } },
    });
    const res = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', employeeId: other.id, ...north(10) },
      staffToken,
      idem(),
    );
    expect(res.status).toBe(404);
  });

  test('an outlet with no coordinates refuses self punches', async () => {
    await prisma.outlet.update({
      where: { id: outletId },
      data: { latitude: null, longitude: null, geofenceRadiusM: null },
    });
    try {
      const res = await api(
        'POST',
        '/attendance/punch',
        { direction: 'IN', ...north(0) },
        staffToken,
        idem(),
      );
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ATTENDANCE_OUTLET_NOT_CONFIGURED');
    } finally {
      await prisma.outlet.update({
        where: { id: outletId },
        data: { ...SITE, geofenceRadiusM: RADIUS_M },
      });
    }
  });

  test('a manager entry for staff needs no location and is marked MANAGER_EDIT', async () => {
    const res = await api(
      'POST',
      '/attendance/punch',
      {
        direction: 'IN',
        employeeId: staffEmployeeId,
        at: new Date().toISOString(),
        reason: 'Phone broke',
      },
      mgrToken,
      idem(),
    );
    expect(res.status).toBe(201);
    const row = await prisma.attendancePunch.findFirstOrThrow({
      where: { day: { employeeId: staffEmployeeId } },
    });
    expect(row.source).toBe('MANAGER_EDIT');
    expect(row.distanceM).toBeNull();
    await clearStaffDays();
  });

  test('two simultaneous first punches produce one IN', async () => {
    const results = await Promise.all([
      api('POST', '/attendance/punch', { direction: 'IN', ...north(10) }, staffToken, idem()),
      api('POST', '/attendance/punch', { direction: 'IN', ...north(10) }, staffToken, idem()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    await clearStaffDays();
  });
});

describe('attendance verification, breaks, history and summary', () => {
  let mgr2Token: string;
  let otherMgrToken: string;
  let mgr2EmployeeId: string;
  const dayIds: string[] = [];

  const clearStaffDays = () =>
    prisma.attendanceDay.deleteMany({ where: { employeeId: staffEmployeeId } });
  const staffPunch = (direction: 'IN' | 'OUT') =>
    api('POST', '/attendance/punch', { direction, ...north(50) }, staffToken, idem());
  const staffDay = () =>
    prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: staffEmployeeId } });
  const outbox = (eventKey: string, aggregateId: string) =>
    prisma.outboxEvent.count({ where: { eventKey, aggregateId } });

  beforeAll(async () => {
    const hash = await app.get(PasswordService).hash(PASSWORD);
    const other = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
    const mkUser = async (username: string, outlet: string) => {
      const user = await prisma.user.create({
        data: { username, passwordHash: hash, roleKey: 'STORE_MANAGER', mustReset: false },
      });
      await prisma.userOutlet.create({ data: { userId: user.id, outletId: outlet } });
      return user;
    };
    const mgr2 = await mkUser(MGR2, outletId);
    await mkUser(MGR_OTHER, other.id);
    const emp = await prisma.employee.create({
      data: {
        employeeCode: 'BM-EMP-9902',
        userId: mgr2.id,
        fullName: 'E2E WF Manager',
        phone: '9937999003',
        outletId,
        departmentId,
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    mgr2EmployeeId = emp.id;
    const login = async (identifier: string) => {
      const res = await fetch(`${url}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password: PASSWORD }),
      });
      return ((await res.json()) as { accessToken: string }).accessToken;
    };
    mgr2Token = await login(MGR2);
    otherMgrToken = await login(MGR_OTHER);
    await clearStaffDays();
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: dayIds } } });
    await clearStaffDays();
  });

  test('a first self punch creates one PENDING submission and one manager notification', async () => {
    expect((await staffPunch('IN')).status).toBe(201);
    const day = await staffDay();
    dayIds.push(day.id);
    expect(day.verificationStatus).toBe('PENDING');
    expect(await outbox('ATTENDANCE_SUBMITTED', day.id)).toBe(1);

    // A later punch the same day is not a second submission.
    expect((await staffPunch('OUT')).status).toBe(201);
    expect(await outbox('ATTENDANCE_SUBMITTED', day.id)).toBe(1);
  });

  test('staff cannot verify or reject', async () => {
    const day = await staffDay();
    expect((await api('POST', `/attendance/days/${day.id}/verify`, {}, staffToken)).status).toBe(403);
    expect(
      (await api('POST', `/attendance/days/${day.id}/reject`, { reason: 'not mine to say' }, staffToken))
        .status,
    ).toBe(403);
  });

  test('a manager of another outlet cannot see or decide it', async () => {
    const day = await staffDay();
    expect((await api('POST', `/attendance/days/${day.id}/verify`, {}, otherMgrToken)).status).toBe(404);
  });

  test('the queue shows the measured distance and no coordinates', async () => {
    const res = await api('GET', '/attendance/verification-queue', undefined, mgrToken);
    expect(res.status).toBe(200);
    const rows = res.body?.['data'] as Record<string, unknown>[];
    const mine = rows.find((r) => r['employeeId'] === staffEmployeeId);
    expect(mine).toBeDefined();
    const location = mine?.['location'] as { distanceM: number; radiusM: number };
    expect(location.distanceM).toBeLessThanOrEqual(RADIUS_M);
    expect(JSON.stringify(mine)).not.toContain('latitude');
  });

  test('a rejection needs a real reason', async () => {
    const day = await staffDay();
    for (const reason of [undefined, '', '  ', 'no']) {
      const res = await api('POST', `/attendance/days/${day.id}/reject`, { reason }, mgrToken);
      expect(res.status).toBe(400);
    }
    expect((await staffDay()).verificationStatus).toBe('PENDING');
  });

  test('a manager cannot verify their own attendance and does not see it queued', async () => {
    expect(
      (await api('POST', '/attendance/punch', { direction: 'IN', ...north(20) }, mgr2Token, idem())).status,
    ).toBe(201);
    const own = await prisma.attendanceDay.findFirstOrThrow({ where: { employeeId: mgr2EmployeeId } });
    dayIds.push(own.id);
    const res = await api('POST', `/attendance/days/${own.id}/verify`, {}, mgr2Token);
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('ATTENDANCE_SELF_VERIFY');

    const queue = await api('GET', '/attendance/verification-queue', undefined, mgr2Token);
    const rows = queue.body?.['data'] as { employeeId: string }[];
    expect(rows.some((r) => r.employeeId === mgr2EmployeeId)).toBe(false);
  });

  test('verify records who and when, audits once and tells the employee once', async () => {
    const day = await staffDay();
    const res = await api('POST', `/attendance/days/${day.id}/verify`, {}, mgrToken);
    expect(res.status).toBe(200);

    const after = await staffDay();
    const mgrUser = await prisma.user.findUniqueOrThrow({ where: { username: MGR } });
    expect(after.verificationStatus).toBe('VERIFIED');
    expect(after.verifiedById).toBe(mgrUser.id);
    expect(after.verifiedAt).not.toBeNull();
    expect(await outbox('ATTENDANCE_DECIDED', day.id)).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: 'workforce.attendance.verify', entityId: day.id } }),
    ).toBe(1);
  });

  test('a decided record cannot be decided again, either way', async () => {
    const day = await staffDay();
    const again = await api('POST', `/attendance/days/${day.id}/verify`, {}, mgrToken);
    const flip = await api(
      'POST',
      `/attendance/days/${day.id}/reject`,
      { reason: 'changed my mind' },
      mgrToken,
    );
    expect(again.status).toBe(409);
    expect(flip.status).toBe(409);
    expect(errorCode(flip)).toBe('ATTENDANCE_NOT_PENDING');
    expect(await outbox('ATTENDANCE_DECIDED', day.id)).toBe(1);
  });

  test('simultaneous opposite decisions leave exactly one outcome', async () => {
    await clearStaffDays();
    await staffPunch('IN');
    const day = await staffDay();
    dayIds.push(day.id);
    const [a, b] = await Promise.all([
      api('POST', `/attendance/days/${day.id}/verify`, {}, mgrToken),
      api('POST', `/attendance/days/${day.id}/reject`, { reason: 'late and unclear' }, mgrToken),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await outbox('ATTENDANCE_DECIDED', day.id)).toBe(1);
  });

  test('a rejected day is closed to the employee: punch and break both refused', async () => {
    await clearStaffDays();
    await staffPunch('IN');
    const day = await staffDay();
    dayIds.push(day.id);
    const rejected = await api(
      'POST',
      `/attendance/days/${day.id}/reject`,
      { reason: 'Photo shows a different place' },
      mgrToken,
    );
    expect(rejected.status).toBe(200);
    const after = await staffDay();
    expect(after.verificationNote).toBe('Photo shows a different place');

    const punch = await staffPunch('OUT');
    expect(punch.status).toBe(409);
    expect(errorCode(punch)).toBe('ATTENDANCE_DAY_REJECTED');
    const brk = await api('POST', '/attendance/break/start', {}, staffToken);
    expect(brk.status).toBe(409);
    expect(errorCode(brk)).toBe('ATTENDANCE_DAY_REJECTED');

    // The rejected record is kept, not deleted or reopened.
    expect((await staffDay()).verificationStatus).toBe('REJECTED');
  });

  test('breaks: no overlap, no end without a start, no checkout while on break', async () => {
    await clearStaffDays();
    expect((await staffPunch('IN')).status).toBe(201);
    dayIds.push((await staffDay()).id);

    const [s1, s2] = await Promise.all([
      api('POST', '/attendance/break/start', {}, staffToken),
      api('POST', '/attendance/break/start', {}, staffToken),
    ]);
    expect([s1.status, s2.status].sort()).toEqual([200, 409]);
    const day = await staffDay();
    expect(await prisma.breakLog.count({ where: { attendanceDayId: day.id, endedAt: null } })).toBe(1);

    const out = await staffPunch('OUT');
    expect(out.status).toBe(409);
    expect(errorCode(out)).toBe('ATTENDANCE_BREAK_STILL_OPEN');

    const [e1, e2] = await Promise.all([
      api('POST', '/attendance/break/end', undefined, staffToken),
      api('POST', '/attendance/break/end', undefined, staffToken),
    ]);
    expect([e1.status, e2.status].sort()).toEqual([200, 409]);
    expect((await staffPunch('OUT')).status).toBe(201);
  });

  test('break requests cannot name another employee', async () => {
    const res = await api(
      'POST',
      '/attendance/break/start',
      { employeeId: mgr2EmployeeId },
      staffToken,
    );
    expect(res.status).toBe(400);
  });

  test('history: 365-day limit, own records only, verification filter', async () => {
    const tooOld = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const old = await api('GET', `/attendance?from=${tooOld}`, undefined, staffToken);
    expect(old.status).toBe(400);
    expect(errorCode(old)).toBe('ATTENDANCE_WINDOW_EXCEEDED');

    const mine = await api('GET', `/attendance?employeeId=${mgr2EmployeeId}`, undefined, staffToken);
    expect(mine.status).toBe(200);
    const rows = mine.body?.['data'] as { employeeId: string }[];
    expect(rows.every((r) => r.employeeId === staffEmployeeId)).toBe(true);

    const rejected = await api('GET', '/attendance?verification=REJECTED', undefined, mgrToken);
    const list = rejected.body?.['data'] as { verificationStatus: string }[];
    expect(list.every((r) => r.verificationStatus === 'REJECTED')).toBe(true);
  });

  test('summary: server computed, scoped, and N/A when there is nothing to measure', async () => {
    const own = await api('GET', '/attendance/summary', undefined, staffToken);
    expect(own.status).toBe(200);
    const pct = own.body?.['attendancePercent'] as number | null;
    expect(pct === null || (pct >= 0 && pct <= 100)).toBe(true);

    expect(
      (await api('GET', `/attendance/summary?employeeId=${mgr2EmployeeId}`, undefined, staffToken)).status,
    ).toBe(404);
    expect((await api('GET', '/attendance/summary', undefined, mgrToken)).status).toBe(400);
    expect(
      (await api('GET', `/attendance/summary?employeeId=${staffEmployeeId}`, undefined, otherMgrToken)).status,
    ).toBe(404);
    expect(
      (await api('GET', `/attendance/summary?employeeId=${staffEmployeeId}`, undefined, mgrToken)).status,
    ).toBe(200);
  });
});

describe('attendance', () => {
  test('a punch needs an idempotency key', async () => {
    const res = await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken);
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('in, break, back, out produces worked minutes net of the break', async () => {
    const inRes = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', ...north(100) },
      staffToken,
      idem(),
    );
    expect(inRes.status).toBe(201);

    const started = await api('POST', '/attendance/break/start', {}, staffToken);
    expect(started.status).toBe(200);
    expect(started.body?.['openBreak']).toBe(true);

    const ended = await api('POST', '/attendance/break/end', undefined, staffToken);
    expect(ended.status).toBe(200);
    expect(ended.body?.['openBreak']).toBe(false);

    const outRes = await api(
      'POST',
      '/attendance/punch',
      { direction: 'OUT', ...north(100) },
      staffToken,
      idem(),
    );
    expect(outRes.status).toBe(201);
    const day = outRes.body?.['attendanceDay'] as Record<string, number>;
    expect(day['workedMins']).toBeGreaterThanOrEqual(0);
  });

  test('the same key replays instead of double punching', async () => {
    const key = idem();
    const day = await prisma.attendanceDay.findFirstOrThrow({
      where: { employeeId: staffEmployeeId },
    });
    const before = await prisma.attendancePunch.count({ where: { attendanceDayId: day.id } });

    const body = { direction: 'IN', ...north(100) };
    await api('POST', '/attendance/punch', body, staffToken, key);
    await api('POST', '/attendance/punch', body, staffToken, key);

    const after = await prisma.attendancePunch.count({ where: { attendanceDayId: day.id } });
    expect(after).toBe(before + 1);
  });

  test('a second IN without the key is a state machine violation', async () => {
    const res = await api(
      'POST',
      '/attendance/punch',
      { direction: 'IN', ...north(100) },
      staffToken,
      idem(),
    );
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATTENDANCE_ALREADY_PUNCHED_IN');
  });

  test('ending a break that was never started is a conflict', async () => {
    const res = await api('POST', '/attendance/break/end', undefined, staffToken);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATTENDANCE_BREAK_NOT_OPEN');
  });

  test('a manager edit is attributed, reasoned and audited', async () => {
    const day = await prisma.attendanceDay.findFirstOrThrow({
      where: { employeeId: staffEmployeeId },
    });
    const punch = await prisma.attendancePunch.findFirstOrThrow({
      where: { attendanceDayId: day.id, direction: 'IN' },
      orderBy: { punchedAt: 'asc' },
    });
    const moved = new Date(punch.punchedAt.getTime() - 30 * 60_000).toISOString();

    const res = await api(
      'PATCH',
      `/attendance/punches/${punch.id}`,
      { punchedAt: moved, reason: 'Wifi was down at the door' },
      mgrToken,
    );
    expect(res.status).toBe(200);

    const updated = await prisma.attendancePunch.findUniqueOrThrow({ where: { id: punch.id } });
    expect(updated.source).toBe('MANAGER_EDIT');
    expect(updated.editReason).toBe('Wifi was down at the door');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'workforce.attendance.edit', entityId: punch.id },
    });
    expect(audit).not.toBeNull();
  });

  test('staff cannot edit their own punch', async () => {
    const day = await prisma.attendanceDay.findFirstOrThrow({
      where: { employeeId: staffEmployeeId },
    });
    const punch = await prisma.attendancePunch.findFirstOrThrow({
      where: { attendanceDayId: day.id },
    });
    const res = await api(
      'PATCH',
      `/attendance/punches/${punch.id}`,
      { punchedAt: new Date().toISOString(), reason: 'trying it on' },
      staffToken,
    );
    expect(res.status).toBe(403);
  });

  test('staff see only their own row on the live board', async () => {
    const res = await api('GET', '/attendance/today', undefined, staffToken);
    expect(res.status).toBe(200);
    const rows = res.body?.['employees'] as { employeeId: string }[];
    expect(rows.every((r) => r.employeeId === staffEmployeeId)).toBe(true);
  });
});

describe('shifts', () => {
  test('an overlapping shift is refused, a back-to-back one is not', async () => {
    const date = toBusinessDate();
    const first = await api(
      'POST',
      '/shifts',
      { employeeId: staffEmployeeId, outletId, shiftDate: date, startsAt: '09:00', endsAt: '17:00' },
      mgrToken,
    );
    expect(first.status).toBe(201);

    const overlap = await api(
      'POST',
      '/shifts',
      { employeeId: staffEmployeeId, outletId, shiftDate: date, startsAt: '16:00', endsAt: '22:00' },
      mgrToken,
    );
    expect(overlap.status).toBe(409);
    expect(errorCode(overlap)).toBe('SHIFT_OVERLAP');

    // Half-open interval: 17:00 to 22:00 starts exactly where the first ended.
    const adjacent = await api(
      'POST',
      '/shifts',
      { employeeId: staffEmployeeId, outletId, shiftDate: date, startsAt: '17:00', endsAt: '22:00' },
      mgrToken,
    );
    expect(adjacent.status).toBe(201);
  });

  test('a bulk roster is all or nothing', async () => {
    const date = toBusinessDate();
    const before = await prisma.shift.count({ where: { employeeId: staffEmployeeId } });
    const res = await api(
      'POST',
      '/shifts/bulk',
      {
        shifts: [
          { employeeId: staffEmployeeId, outletId, shiftDate: date, startsAt: '06:00', endsAt: '08:00' },
          // Clashes with the 09:00 to 17:00 shift above, so neither should land.
          { employeeId: staffEmployeeId, outletId, shiftDate: date, startsAt: '10:00', endsAt: '12:00' },
        ],
      },
      mgrToken,
    );
    expect(res.status).toBe(409);
    expect(await prisma.shift.count({ where: { employeeId: staffEmployeeId } })).toBe(before);
  });
});

describe('leave', () => {
  let leaveId: string;

  function future(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }

  test('staff cannot backdate their own leave', async () => {
    const res = await api(
      'POST',
      '/leave-requests',
      { type: 'SICK', fromDate: '2026-01-05', toDate: '2026-01-05', reason: 'Was unwell' },
      staffToken,
    );
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('LEAVE_PAST_DATE');
  });

  test('staff raise a request and it queues an event', async () => {
    const before = await prisma.outboxEvent.count({ where: { eventKey: 'LEAVE_REQUESTED' } });
    const res = await api(
      'POST',
      '/leave-requests',
      { type: 'CASUAL', fromDate: future(5), toDate: future(6), reason: 'Family function' },
      staffToken,
    );
    expect(res.status).toBe(201);
    expect(res.body?.['dayCount']).toBe('2.0');
    leaveId = res.body?.['id'] as string;
    expect(await prisma.outboxEvent.count({ where: { eventKey: 'LEAVE_REQUESTED' } })).toBe(
      before + 1,
    );
  });

  test('an overlapping request is refused', async () => {
    const res = await api(
      'POST',
      '/leave-requests',
      { type: 'CASUAL', fromDate: future(6), toDate: future(7), reason: 'Same week' },
      staffToken,
    );
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('LEAVE_OVERLAP');
  });

  test('staff cannot approve their own request', async () => {
    const res = await api('POST', `/leave-requests/${leaveId}/approve`, {}, staffToken);
    expect(res.status).toBe(403);
  });

  test('the manager approves and the attendance board shows ON_LEAVE', async () => {
    const res = await api('POST', `/leave-requests/${leaveId}/approve`, {}, mgrToken);
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('APPROVED');

    const days = await prisma.attendanceDay.findMany({
      where: {
        employeeId: staffEmployeeId,
        businessDate: { gte: new Date(`${future(5)}T00:00:00.000Z`) },
      },
    });
    expect(days.length).toBe(2);
    expect(days.every((d) => d.status === 'ON_LEAVE')).toBe(true);
  });

  test('deciding twice is a conflict', async () => {
    const res = await api('POST', `/leave-requests/${leaveId}/reject`, {}, mgrToken);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('LEAVE_NOT_PENDING');
  });

  test('a manager cancel of future approved leave clears the ON_LEAVE days', async () => {
    const res = await api('POST', `/leave-requests/${leaveId}/cancel`, undefined, mgrToken);
    expect(res.status).toBe(200);
    const days = await prisma.attendanceDay.findMany({
      where: { employeeId: staffEmployeeId, status: 'ON_LEAVE' },
    });
    expect(days.length).toBe(0);
  });
});

describe('salary', () => {
  test('a new record closes the previous one rather than editing it', async () => {
    await api('POST', '/salary', {
      employeeId: staffEmployeeId,
      effectiveFrom: '2026-01-01',
      monthlyCtc: 18000,
    });
    const res = await api('POST', '/salary', {
      employeeId: staffEmployeeId,
      effectiveFrom: '2026-07-01',
      monthlyCtc: 21000,
    });
    expect(res.status).toBe(201);

    const records = res.body?.['records'] as { effectiveTo: string | null; isCurrent: boolean }[];
    expect(records.length).toBe(2);
    expect(records.filter((r) => r.isCurrent).length).toBe(1);
    expect(records.find((r) => !r.isCurrent)?.effectiveTo).toBe('2026-06-30');
  });

  test('a manager cannot read salary and staff cannot either', async () => {
    for (const token of [mgrToken, staffToken]) {
      const res = await api('GET', `/employees/${staffEmployeeId}/salary`, undefined, token);
      expect(res.status).toBe(403);
    }
  });
});

// writeLeaveDays used to overwrite unconditionally, contradicting its own
// comment. A manager filing backdated sick leave across a day the cook had
// actually worked turned PRESENT into ON_LEAVE, and the attendance consistency
// report drops ON_LEAVE from its denominator, so the worked day vanished with
// nothing left to recompute it.
describe('approved leave does not erase a worked day', () => {
  test('a day the employee worked stays PRESENT', async () => {
    const worked = new Date(`${toBusinessDate()}T00:00:00.000Z`);
    await prisma.attendanceDay.upsert({
      where: { employeeId_businessDate: { employeeId: staffEmployeeId, businessDate: worked } },
      create: {
        employeeId: staffEmployeeId,
        outletId,
        businessDate: worked,
        status: 'PRESENT',
        workedMins: 480,
      },
      update: { status: 'PRESENT', workedMins: 480 },
    });

    const today = toBusinessDate();
    const filed = await api(
      'POST',
      '/leave-requests',
      {
        employeeId: staffEmployeeId,
        type: 'SICK',
        fromDate: today,
        toDate: today,
        reason: 'Filed the next morning',
      },
      mgrToken,
    );
    expect(filed.status).toBe(201);
    const approved = await api(
      'POST',
      `/leave-requests/${filed.body?.['id'] as string}/approve`,
      {},
      mgrToken,
    );
    expect(approved.status).toBe(200);

    const day = await prisma.attendanceDay.findUniqueOrThrow({
      where: { employeeId_businessDate: { employeeId: staffEmployeeId, businessDate: worked } },
    });
    // He came in anyway. The form does not get to say otherwise.
    expect(day.status).toBe('PRESENT');
    expect(day.workedMins).toBe(480);
  });

  test('an absent day still becomes ON_LEAVE', async () => {
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const filed = await api(
      'POST',
      '/leave-requests',
      {
        employeeId: staffEmployeeId,
        type: 'CASUAL',
        fromDate: future,
        toDate: future,
        reason: 'Wedding',
      },
      mgrToken,
    );
    await api('POST', `/leave-requests/${filed.body?.['id'] as string}/approve`, {}, mgrToken);

    const day = await prisma.attendanceDay.findUniqueOrThrow({
      where: {
        employeeId_businessDate: {
          employeeId: staffEmployeeId,
          businessDate: new Date(`${future}T00:00:00.000Z`),
        },
      },
    });
    expect(day.status).toBe('ON_LEAVE');
  });
});
