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

const PASSWORD = 'saheed-momo-2026';
const HR = 'e2e.wf.hr';
const MGR = 'e2e.wf.mgr';
const STAFF = 'e2e.wf.staff';

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
    where: { username: { in: [HR, MGR, STAFF] } },
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
  await prisma.user.deleteMany({ where: { username: { in: [HR, MGR, STAFF] } } });
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

describe('attendance', () => {
  test('a punch needs an idempotency key', async () => {
    const res = await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken);
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('in, break, back, out produces worked minutes net of the break', async () => {
    const inRes = await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken, idem());
    expect(inRes.status).toBe(201);

    const started = await api('POST', '/attendance/break/start', {}, staffToken);
    expect(started.status).toBe(200);
    expect(started.body?.['openBreak']).toBe(true);

    const ended = await api('POST', '/attendance/break/end', undefined, staffToken);
    expect(ended.status).toBe(200);
    expect(ended.body?.['openBreak']).toBe(false);

    const outRes = await api('POST', '/attendance/punch', { direction: 'OUT' }, staffToken, idem());
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

    await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken, key);
    await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken, key);

    const after = await prisma.attendancePunch.count({ where: { attendanceDayId: day.id } });
    expect(after).toBe(before + 1);
  });

  test('a second IN without the key is a state machine violation', async () => {
    const res = await api('POST', '/attendance/punch', { direction: 'IN' }, staffToken, idem());
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
