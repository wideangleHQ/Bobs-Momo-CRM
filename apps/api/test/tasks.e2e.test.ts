// bun test apps/api
// The task engine: one table behind one-offs, recurring work, checklists and
// audits. Assumes `db:seed` has run.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { toBusinessDate } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';
import { TasksService } from '../src/modules/tasks/tasks.service';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;
let tasks: TasksService;

let opsToken: string; // OPERATIONS_MANAGER: templates, recurrences, all outlets
let mgrToken: string; // STORE_MANAGER at Saheed Nagar: create, verify, cancel
let cookToken: string; // KITCHEN_STAFF at Saheed Nagar: start, complete, self only
let patiaToken: string; // STORE_MANAGER at Patia: the other outlet

let outletId: string;
let otherOutletId: string;
let departmentId: string;
let mgrEmployeeId: string;
let cookEmployeeId: string;
let storeManagerEmployeeId: string;

const PASSWORD = 'saheed-momo-2026';
const OPS = 'e2e.task.ops';
const MGR = 'e2e.task.mgr';
const COOK = 'e2e.task.cook';
const PATIA = 'e2e.task.patia';
const USERNAMES = [OPS, MGR, COOK, PATIA];
const CODE_PREFIX = 'BM-EMP-95';
const TEMPLATE_CODE = 'E2E_TASKS_AUDIT';
const CHECKLIST_CODE = 'E2E_TASKS_OPEN';

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = mgrToken,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
}

function details(res: { body: Record<string, unknown> | null }): unknown {
  return (res.body?.['error'] as { details?: unknown } | undefined)?.details;
}

async function outboxCount(eventKey: string, aggregateId: string): Promise<number> {
  return prisma.outboxEvent.count({ where: { eventKey, aggregateId } });
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { in: USERNAMES } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({
    where: { OR: [{ userId: { in: userIds } }, { employeeCode: { startsWith: CODE_PREFIX } }] },
    select: { id: true },
  });
  const employeeIds = employees.map((e) => e.id);
  const templates = await prisma.checklistTemplate.findMany({
    where: { code: { in: [TEMPLATE_CODE, CHECKLIST_CODE] } },
    select: { id: true },
  });
  const templateIds = templates.map((t) => t.id);
  const recurrences = await prisma.taskRecurrence.findMany({
    where: { name: { startsWith: 'E2E ' } },
    select: { id: true },
  });
  const recurrenceIds = recurrences.map((r) => r.id);

  const rows = await prisma.task.findMany({
    where: {
      OR: [
        { createdById: { in: employeeIds } },
        { assigneeId: { in: employeeIds } },
        { templateId: { in: templateIds } },
        { recurrenceId: { in: recurrenceIds } },
        { title: { startsWith: 'E2E ' } },
        { title: { startsWith: 'Fix: E2E ' } },
      ],
    },
    select: { id: true },
  });
  const taskIds = rows.map((t) => t.id);

  await prisma.outboxEvent.deleteMany({
    where: { aggregateType: 'Task', aggregateId: { in: taskIds } },
  });
  await prisma.auditLog.deleteMany({ where: { entityType: 'Task', entityId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.taskRecurrence.deleteMany({ where: { id: { in: recurrenceIds } } });
  await prisma.checklistTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');
  tasks = app.get(TasksService);

  await cleanup();

  const passwords = app.get(PasswordService);
  const hash = await passwords.hash(PASSWORD);
  const saheed = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  const patia = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
  outletId = saheed.id;
  otherOutletId = patia.id;
  departmentId = (
    await prisma.department.findFirstOrThrow({ where: { outletId, name: 'Kitchen' } })
  ).id;

  let seq = 9501;
  const mk = async (
    username: string,
    roleKey: 'OPERATIONS_MANAGER' | 'STORE_MANAGER' | 'KITCHEN_STAFF',
    at: string,
    dept: string | null,
  ) => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    // OPERATIONS_MANAGER gets every active outlet computed at login instead.
    if (roleKey !== 'OPERATIONS_MANAGER') {
      await prisma.userOutlet.create({ data: { userId: user.id, outletId: at } });
    }
    const employee = await prisma.employee.create({
      data: {
        employeeCode: `BM-EMP-${seq++}`,
        userId: user.id,
        fullName: `E2E ${username}`,
        phone: '9937950001',
        outletId: at,
        departmentId: dept,
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    return employee.id;
  };

  await mk(OPS, 'OPERATIONS_MANAGER', outletId, null);
  mgrEmployeeId = await mk(MGR, 'STORE_MANAGER', outletId, null);
  cookEmployeeId = await mk(COOK, 'KITCHEN_STAFF', outletId, departmentId);
  await mk(PATIA, 'STORE_MANAGER', otherOutletId, null);

  // The follow-up assignee is resolved by the service the same way. Reading it
  // here rather than hard-coding keeps the assertion honest whichever store
  // manager the seed created first.
  storeManagerEmployeeId = (
    await prisma.employee.findFirstOrThrow({
      where: {
        outletId,
        status: { in: ['ACTIVE', 'ON_NOTICE'] },
        user: { roleKey: 'STORE_MANAGER', status: 'ACTIVE' },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
  ).id;

  const login = async (identifier: string) => {
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password: PASSWORD }),
    });
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
  opsToken = await login(OPS);
  mgrToken = await login(MGR);
  cookToken = await login(COOK);
  patiaToken = await login(PATIA);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app?.close();
});

describe('the state machine', () => {
  let taskId: string;

  test('a created task opens, and the assignee is told about it', async () => {
    const res = await api('POST', '/tasks', {
      title: 'E2E Call the AC technician',
      outletId,
      departmentId,
      assigneeId: cookEmployeeId,
      priority: 'HIGH',
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body?.['status']).toBe('OPEN');
    expect(res.body?.['kind']).toBe('ONE_OFF');
    expect(res.body?.['businessDate']).toBe(toBusinessDate());
    taskId = res.body?.['id'] as string;

    expect(await outboxCount('TASK_ASSIGNED', taskId)).toBe(1);
  });

  test('the assignee starts it and startedAt is stamped', async () => {
    const res = await api('POST', `/tasks/${taskId}/start`, undefined, cookToken);
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('IN_PROGRESS');
    expect(res.body?.['startedAt']).not.toBeNull();
  });

  test('starting an already started task is a conflict', async () => {
    const res = await api('POST', `/tasks/${taskId}/start`, undefined, cookToken);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('TASK_INVALID_TRANSITION');
  });

  test('a cook cannot touch somebody else another cook owns', async () => {
    const other = await api('POST', '/tasks', {
      title: 'E2E Somebody elses job',
      outletId,
      assigneeId: mgrEmployeeId,
    });
    const res = await api('POST', `/tasks/${other.body?.['id'] as string}/start`, undefined, cookToken);
    expect(res.status).toBe(403);
  });

  test('PATCH edits fields but refuses to move the status', async () => {
    const rejected = await api('PATCH', `/tasks/${taskId}`, { status: 'COMPLETED' });
    expect(rejected.status).toBe(422);
    expect(errorCode(rejected)).toBe('TASK_INVALID_TRANSITION');

    const edited = await api('PATCH', `/tasks/${taskId}`, { priority: 'URGENT' });
    expect(edited.status).toBe(200);
    expect(edited.body?.['priority']).toBe('URGENT');
    expect(edited.body?.['status']).toBe('IN_PROGRESS');
  });

  test('a reassignment tells the new person', async () => {
    const before = await outboxCount('TASK_ASSIGNED', taskId);
    const res = await api('PATCH', `/tasks/${taskId}`, { assigneeId: mgrEmployeeId });
    expect(res.status).toBe(200);
    expect(res.body?.['assigneeId']).toBe(mgrEmployeeId);
    expect(await outboxCount('TASK_ASSIGNED', taskId)).toBe(before + 1);

    await api('PATCH', `/tasks/${taskId}`, { assigneeId: cookEmployeeId });
  });

  test('completing stores the note as a comment', async () => {
    const res = await api(
      'POST',
      `/tasks/${taskId}/complete`,
      { note: 'E2E technician came at 4pm' },
      cookToken,
    );
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('COMPLETED');
    expect(res.body?.['completedAt']).not.toBeNull();

    const comments = await api('GET', `/tasks/${taskId}/comments`);
    const rows = comments.body?.['data'] as { body: string }[];
    expect(rows.some((c) => c.body === 'E2E technician came at 4pm')).toBe(true);
  });

  test('a completed task rejects a start and rejects an edit', async () => {
    const started = await api('POST', `/tasks/${taskId}/start`, undefined, cookToken);
    expect(started.status).toBe(409);
    expect(errorCode(started)).toBe('TASK_INVALID_TRANSITION');

    const edited = await api('PATCH', `/tasks/${taskId}`, { priority: 'LOW' });
    expect(edited.status).toBe(409);
    expect(errorCode(edited)).toBe('TASK_INVALID_TRANSITION');
  });

  test('verify on a task that does not need it is refused', async () => {
    const res = await api('POST', `/tasks/${taskId}/verify`, {});
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('VERIFICATION_NOT_REQUIRED');
  });

  test('a kitchen cook has no verify key at all', async () => {
    const res = await api('POST', `/tasks/${taskId}/verify`, {}, cookToken);
    expect(res.status).toBe(403);
  });

  test('sign-off works, and not on your own work', async () => {
    const own = await api('POST', '/tasks', {
      title: 'E2E Count the till, my own',
      outletId,
      assigneeId: mgrEmployeeId,
      requiresVerification: true,
    });
    const ownId = own.body?.['id'] as string;
    await api('POST', `/tasks/${ownId}/complete`, {});
    const self = await api('POST', `/tasks/${ownId}/verify`, {});
    expect(self.status).toBe(403);

    const theirs = await api('POST', '/tasks', {
      title: 'E2E Deep clean the grill',
      outletId,
      assigneeId: cookEmployeeId,
      requiresVerification: true,
    });
    const theirsId = theirs.body?.['id'] as string;
    await api('POST', `/tasks/${theirsId}/complete`, {}, cookToken);
    const signed = await api('POST', `/tasks/${theirsId}/verify`, { note: 'E2E looks right' });
    expect(signed.status).toBe(200);
    expect(signed.body?.['status']).toBe('VERIFIED');
    expect(signed.body?.['verifiedAt']).not.toBeNull();
  });

  test('cancelling needs a reason, and leaves a comment and an audit row', async () => {
    const created = await api('POST', '/tasks', {
      title: 'E2E Order the wrong thing',
      outletId,
      assigneeId: cookEmployeeId,
    });
    const id = created.body?.['id'] as string;

    const bare = await api('POST', `/tasks/${id}/cancel`, {});
    expect(bare.status).toBe(400);

    const res = await api('POST', `/tasks/${id}/cancel`, { reason: 'E2E duplicate of another task' });
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('CANCELLED');

    expect(await prisma.taskComment.count({ where: { taskId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'Task', entityId: id } })).toBe(1);

    const again = await api('POST', `/tasks/${id}/cancel`, { reason: 'E2E second go' });
    expect(again.status).toBe(409);
  });
});

describe('the overdue sweep', () => {
  let lateId: string;
  let dueAt: Date;

  test('a late task is flagged once and only once', async () => {
    const created = await api('POST', '/tasks', {
      title: 'E2E Post yesterdays sales figure',
      outletId,
      assigneeId: cookEmployeeId,
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    lateId = created.body?.['id'] as string;
    dueAt = new Date(Date.now() - 60_000);
    await prisma.task.update({ where: { id: lateId }, data: { dueAt } });

    await tasks.sweepOverdue(new Date());
    await tasks.sweepOverdue(new Date());
    await tasks.sweepOverdue(new Date());

    const row = await prisma.task.findUniqueOrThrow({ where: { id: lateId } });
    expect(row.status).toBe('OVERDUE');
    expect(row.overdueNotifiedAt).not.toBeNull();
    // 372 WhatsApp messages for one late task is how a manager learns to mute
    // the app. overdueNotifiedAt is the whole defence.
    expect(await outboxCount('TASK_OVERDUE', lateId)).toBe(1);
  });

  test('the sweep leaves a completed task alone', async () => {
    const created = await api('POST', '/tasks', {
      title: 'E2E Already done and late',
      outletId,
      assigneeId: cookEmployeeId,
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const id = created.body?.['id'] as string;
    await api('POST', `/tasks/${id}/complete`, {}, cookToken);
    await prisma.task.update({ where: { id }, data: { dueAt: new Date(Date.now() - 60_000) } });

    await tasks.sweepOverdue(new Date());
    const row = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('COMPLETED');
    expect(row.overdueNotifiedAt).toBeNull();
  });

  test('the sweep ignores a task with no due time', async () => {
    const created = await api('POST', '/tasks', {
      title: 'E2E No deadline at all',
      outletId,
      assigneeId: cookEmployeeId,
    });
    const id = created.body?.['id'] as string;
    await tasks.sweepOverdue(new Date());
    const row = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('OPEN');
  });

  test('overdue is not terminal: it starts and completes, and the lateness survives', async () => {
    const started = await api('POST', `/tasks/${lateId}/start`, undefined, cookToken);
    expect(started.status).toBe(200);
    expect(started.body?.['status']).toBe('IN_PROGRESS');
    expect(started.body?.['overdueNotifiedAt']).not.toBeNull();

    const done = await api('POST', `/tasks/${lateId}/complete`, {}, cookToken);
    expect(done.status).toBe(200);
    expect(done.body?.['status']).toBe('COMPLETED');
    expect(done.body?.['overdueNotifiedAt']).not.toBeNull();
    // Lateness is completedAt against dueAt, not a boolean anybody maintains.
    expect(done.body?.['wasLate']).toBe(true);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: lateId } });
    expect(row.completedAt?.getTime()).toBeGreaterThan(dueAt.getTime());
  });
});

describe('checklists and audits', () => {
  let templateId: string;
  let itemNote: string;
  let itemFail: string;
  let itemPhoto: string;
  let auditId: string;
  let attachmentId: string;

  test('only a template manager may define a template', async () => {
    const refused = await api('POST', '/checklist-templates', {
      code: TEMPLATE_CODE,
      name: 'E2E hygiene audit',
      isAudit: true,
      items: [{ sortOrder: 1, label: 'E2E Fridge temperature under 4C' }],
    });
    expect(refused.status).toBe(403);

    const res = await api(
      'POST',
      '/checklist-templates',
      {
        code: TEMPLATE_CODE,
        name: 'E2E hygiene audit',
        isAudit: true,
        items: [
          { sortOrder: 1, label: 'E2E Fridge temperature under 4C', requiresNote: true },
          { sortOrder: 2, label: 'E2E Chimney filter clean', failCreatesTask: true },
          { sortOrder: 3, label: 'E2E Fryer oil colour', requiresPhoto: true },
        ],
      },
      opsToken,
    );
    expect(res.status).toBe(201);
    templateId = res.body?.['id'] as string;
    const items = res.body?.['items'] as { id: string; sortOrder: number }[];
    itemNote = items.find((i) => i.sortOrder === 1)?.id as string;
    itemFail = items.find((i) => i.sortOrder === 2)?.id as string;
    itemPhoto = items.find((i) => i.sortOrder === 3)?.id as string;
  });

  test('a duplicate code is a conflict', async () => {
    const res = await api(
      'POST',
      '/checklist-templates',
      { code: TEMPLATE_CODE, name: 'E2E again', items: [{ sortOrder: 1, label: 'E2E anything' }] },
      opsToken,
    );
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('DUPLICATE_TEMPLATE_CODE');
  });

  test('an audit run defaults to needing a sign-off', async () => {
    const res = await api('POST', '/tasks', {
      title: 'E2E Monthly hygiene audit',
      outletId,
      departmentId,
      templateId,
      assigneeId: cookEmployeeId,
    });
    expect(res.status).toBe(201);
    expect(res.body?.['kind']).toBe('AUDIT_RUN');
    expect(res.body?.['requiresVerification']).toBe(true);
    auditId = res.body?.['id'] as string;
  });

  test('completing an unsubmitted checklist points at the checklist endpoint', async () => {
    const res = await api('POST', `/tasks/${auditId}/complete`, {}, cookToken);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHECKLIST_INCOMPLETE');
  });

  test('attachments check the mime type and the size, then follow the key convention', async () => {
    const pdf = await api(
      'POST',
      `/tasks/${auditId}/attachments`,
      { mimeType: 'application/pdf', sizeBytes: 1000 },
      cookToken,
    );
    expect(pdf.status).toBe(422);
    expect(errorCode(pdf)).toBe('UNSUPPORTED_MIME_TYPE');

    const huge = await api(
      'POST',
      `/tasks/${auditId}/attachments`,
      { mimeType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 },
      cookToken,
    );
    expect(huge.status).toBe(422);
    expect(errorCode(huge)).toBe('ATTACHMENT_TOO_LARGE');

    const res = await api(
      'POST',
      `/tasks/${auditId}/attachments`,
      { mimeType: 'image/jpeg', sizeBytes: 1_843_200 },
      cookToken,
    );
    expect(res.status).toBe(201);
    attachmentId = res.body?.['attachmentId'] as string;
    expect(res.body?.['storageKey']).toMatch(
      /^task-proof\/BM-[A-Z]+\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\/[0-9a-f-]+\.jpg$/,
    );
  });

  test('a missing item result names the labels that are missing', async () => {
    const res = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      { results: [{ templateItemId: itemNote, result: 'PASS', note: '3.1 C' }] },
      cookToken,
    );
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('CHECKLIST_INCOMPLETE');
    const missing = (details(res) as { missing: { label: string }[] }).missing;
    expect(missing.map((m) => m.label)).toContain('E2E Chimney filter clean');
  });

  test('an item from another template is refused', async () => {
    const res = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      {
        results: [
          { templateItemId: itemNote, result: 'PASS', note: '3.1 C' },
          { templateItemId: itemFail, result: 'PASS' },
          { templateItemId: crypto.randomUUID(), result: 'PASS' },
        ],
      },
      cookToken,
    );
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('TEMPLATE_MISMATCH');
  });

  test('a photo item passed without a photo is refused, NA is not', async () => {
    const base = [
      { templateItemId: itemNote, result: 'PASS', note: '3.1 C' },
      { templateItemId: itemFail, result: 'PASS' },
    ];
    const bare = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      { results: [...base, { templateItemId: itemPhoto, result: 'PASS' }] },
      cookToken,
    );
    expect(bare.status).toBe(422);
    expect(errorCode(bare)).toBe('PHOTO_REQUIRED');

    // "The fryer was not used today" is a real answer and needs no photograph.
    const skipped = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      { results: [...base, { templateItemId: itemPhoto, result: 'NA' }] },
      cookToken,
    );
    expect(skipped.status).toBe(200);
  });

  test('a note item passed without a note is refused', async () => {
    const res = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      {
        results: [
          { templateItemId: itemNote, result: 'PASS' },
          { templateItemId: itemFail, result: 'PASS' },
          { templateItemId: itemPhoto, result: 'NA' },
        ],
      },
      cookToken,
    );
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('NOTE_REQUIRED');
  });

  test('a FAIL on a failCreatesTask item spawns one follow-up in the same write', async () => {
    const res = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      {
        results: [
          { templateItemId: itemNote, result: 'PASS', note: '3.1 C' },
          { templateItemId: itemFail, result: 'FAIL', note: 'E2E chimney filter clogged' },
          { templateItemId: itemPhoto, result: 'PASS', attachmentId },
        ],
      },
      cookToken,
    );
    expect(res.status).toBe(200);
    const task = res.body?.['task'] as { status: string; completedAt: string | null };
    expect(task.status).toBe('COMPLETED');
    expect(task.completedAt).not.toBeNull();

    const followUps = res.body?.['followUpTasks'] as { id: string; priority: string }[];
    expect(followUps).toHaveLength(1);
    const child = await prisma.task.findUniqueOrThrow({ where: { id: followUps[0]?.id ?? '' } });
    expect(child.kind).toBe('ONE_OFF');
    expect(child.parentTaskId).toBe(auditId);
    expect(child.priority).toBe('HIGH');
    expect(child.requiresVerification).toBe(true);
    expect(child.assigneeId).toBe(storeManagerEmployeeId);
    const hours = ((child.dueAt?.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);

    expect(await outboxCount('AUDIT_ITEM_FAILED', child.id)).toBe(1);
  });

  test('a resubmit writes the same rows and no second follow-up', async () => {
    const res = await api(
      'POST',
      `/tasks/${auditId}/checklist`,
      {
        results: [
          { templateItemId: itemNote, result: 'PASS', note: '3.1 C' },
          { templateItemId: itemFail, result: 'FAIL', note: 'E2E chimney filter clogged' },
          { templateItemId: itemPhoto, result: 'PASS', attachmentId },
        ],
      },
      cookToken,
    );
    expect(res.status).toBe(200);
    expect(await prisma.taskChecklistResult.count({ where: { taskId: auditId } })).toBe(3);
    expect(await prisma.task.count({ where: { parentTaskId: auditId } })).toBe(1);

    const late = await api(
      'POST',
      `/tasks/${auditId}/attachments`,
      { mimeType: 'image/jpeg', sizeBytes: 1000 },
      cookToken,
    );
    expect(late.status).toBe(409);
    expect(errorCode(late)).toBe('TASK_INVALID_TRANSITION');
  });

  test('the detail view assembles items, results, comments and children', async () => {
    const res = await api('GET', `/tasks/${auditId}`);
    expect(res.status).toBe(200);
    expect((res.body?.['items'] as unknown[]).length).toBe(3);
    expect((res.body?.['attachments'] as unknown[]).length).toBe(1);
    expect((res.body?.['followUpTasks'] as unknown[]).length).toBe(1);
  });

  test('editing a template keeps an item that history points at', async () => {
    const res = await api(
      'PATCH',
      `/checklist-templates/${templateId}`,
      {
        name: 'E2E hygiene audit v2',
        items: [{ sortOrder: 1, label: 'E2E Fridge temperature under 4C', requiresNote: true }],
      },
      opsToken,
    );
    expect(res.status).toBe(200);
    expect(res.body?.['name']).toBe('E2E hygiene audit v2');
    // Items 2 and 3 carry recorded results, so their rows survive the edit.
    const surviving = await prisma.checklistTemplateItem.count({ where: { templateId } });
    expect(surviving).toBe(3);
  });
});

describe('recurrence', () => {
  let recurrenceId: string;
  let checklistTemplateId: string;

  test('cron is read in IST, not UTC', async () => {
    const template = await api(
      'POST',
      '/checklist-templates',
      {
        code: CHECKLIST_CODE,
        name: 'E2E kitchen opening checklist',
        items: [{ sortOrder: 1, label: 'E2E Fridge on and cold' }],
      },
      opsToken,
    );
    checklistTemplateId = template.body?.['id'] as string;

    const res = await api(
      'POST',
      '/task-recurrences',
      {
        name: 'E2E kitchen opening',
        cronExpr: '0 7 * * *',
        templateId: checklistTemplateId,
        outletId,
        dueAfterMins: 120,
      },
      opsToken,
    );
    expect(res.status).toBe(201);
    recurrenceId = res.body?.['id'] as string;
    // 07:00 in Asia/Kolkata is 01:30 UTC. A cron read in UTC puts the opening
    // checklist on the board at half past noon.
    const fires = res.body?.['nextFireTimes'] as string[];
    expect(fires[0]).toMatch(/T01:30:00\.000Z$/);
  });

  test('a nonsense cron expression is refused', async () => {
    const res = await api(
      'POST',
      '/task-recurrences',
      { name: 'E2E broken', cronExpr: '99 99 * * *', title: 'E2E never' },
      opsToken,
    );
    expect(res.status).toBe(400);
  });

  test('the generator materialises one instance per outlet per business date', async () => {
    const first = await tasks.generateRecurringInstances(new Date());
    expect(first.created).toBeGreaterThanOrEqual(1);

    const rows = await prisma.task.findMany({ where: { recurrenceId } });
    expect(rows).toHaveLength(1);
    const instance = rows[0];
    expect(instance?.kind).toBe('CHECKLIST_RUN');
    expect(instance?.outletId).toBe(outletId);
    expect(instance?.status).toBe('OPEN');
    // 07:00 plus 120 minutes is 09:00 IST, which is 03:30 UTC.
    expect(instance?.dueAt?.toISOString()).toMatch(/T03:30:00\.000Z$/);
  });

  test('running the generator again over the same window creates nothing', async () => {
    await prisma.taskRecurrence.update({ where: { id: recurrenceId }, data: { lastRunAt: null } });
    const second = await tasks.generateRecurringInstances(new Date());
    expect(second.skipped).toBeGreaterThanOrEqual(1);
    expect(await prisma.task.count({ where: { recurrenceId } })).toBe(1);
  });

  test('an inactive recurrence generates nothing', async () => {
    const patched = await api(
      'PATCH',
      `/task-recurrences/${recurrenceId}`,
      { isActive: false },
      opsToken,
    );
    expect(patched.status).toBe(200);
    expect(patched.body?.['isActive']).toBe(false);

    await prisma.task.deleteMany({ where: { recurrenceId } });
    await tasks.generateRecurringInstances(new Date());
    expect(await prisma.task.count({ where: { recurrenceId } })).toBe(0);
  });
});

describe('outlet scope and self scope', () => {
  let saheedTaskId: string;

  test('a task at the other outlet reads as missing, not forbidden', async () => {
    const created = await api('POST', '/tasks', {
      title: 'E2E Scope check',
      outletId,
      assigneeId: cookEmployeeId,
    });
    saheedTaskId = created.body?.['id'] as string;

    const res = await api('GET', `/tasks/${saheedTaskId}`, undefined, patiaToken);
    // 404, not 403. A 403 confirms the other outlet's task exists.
    expect(res.status).toBe(404);
  });

  test('a manager cannot create into another outlet', async () => {
    const res = await api(
      'POST',
      '/tasks',
      { title: 'E2E Cross outlet write', outletId: otherOutletId },
      mgrToken,
    );
    expect(res.status).toBe(404);
  });

  test('a cook has no create key', async () => {
    const res = await api('POST', '/tasks', { title: 'E2E Cook writes', outletId }, cookToken);
    expect(res.status).toBe(403);
  });

  test('a cook asking for somebody elses list gets their own', async () => {
    const res = await api('GET', `/tasks?assigneeId=${mgrEmployeeId}&pageSize=100`, undefined, cookToken);
    expect(res.status).toBe(200);
    const rows = res.body?.['data'] as { assigneeId: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.assigneeId === cookEmployeeId)).toBe(true);
  });

  test('an unassigned outlet task reaches the cook through /tasks/my', async () => {
    const created = await api('POST', '/tasks', {
      title: 'E2E Whoever opens the kitchen',
      outletId,
      departmentId,
    });
    const id = created.body?.['id'] as string;

    const res = await api('GET', '/tasks/my', undefined, cookToken);
    expect(res.status).toBe(200);
    const all = [
      ...(res.body?.['overdue'] as { id: string }[]),
      ...(res.body?.['today'] as { id: string }[]),
      ...(res.body?.['upcoming'] as { id: string }[]),
    ];
    expect(all.some((t) => t.id === id)).toBe(true);
  });

  test('the board groups by status with a count per column', async () => {
    const res = await api('GET', `/tasks/board?outletId=${outletId}`, undefined, mgrToken);
    expect(res.status).toBe(200);
    const columns = res.body?.['columns'] as Record<string, { count: number; tasks: unknown[] }>;
    expect(columns['OPEN']?.count).toBeGreaterThan(0);
    expect(columns['OPEN']?.count).toBe(columns['OPEN']?.tasks.length ?? -1);
  });

  test('a cook can comment on a task they can read', async () => {
    const res = await api(
      'POST',
      `/tasks/${saheedTaskId}/comments`,
      { body: 'E2E the fridge is still warm' },
      cookToken,
    );
    expect(res.status).toBe(201);
    expect(res.body?.['authorId']).toBe(cookEmployeeId);
  });
});

// The compliance report is the number the owner opens to answer "is the Patia
// kitchen actually running the opening checklist".
describe('compliance', () => {
  test('a range with no checklists reports null rates, not zero', async () => {
    const res = await api('GET', '/tasks/compliance?from=2020-01-01&to=2020-01-02');
    expect(res.status).toBe(200);
    const rows = res.body?.['data'] as Array<{ completionRate: number | null }>;
    // Zero would read as total failure. Nothing happened, so there is no rate.
    expect(rows.every((r) => r.completionRate === null)).toBe(true);
  });

  test('a cancelled run does not count against the completion rate', async () => {
    const today = toBusinessDate();
    const res = await api('GET', `/tasks/compliance?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    const rows = res.body?.['data'] as Array<{
      generated: number;
      completed: number;
      cancelled: number;
      completionRate: number | null;
    }>;
    for (const r of rows) {
      const expected = r.generated - r.cancelled;
      if (expected === 0) {
        expect(r.completionRate).toBeNull();
      } else {
        expect(r.completionRate).toBeCloseTo(r.completed / expected, 3);
      }
    }
  });

  test('an out of scope outlet is 404', async () => {
    const today = toBusinessDate();
    const res = await api(
      'GET',
      `/tasks/compliance?from=${today}&to=${today}&outletId=00000000-0000-4000-8000-000000000000`,
    );
    expect(res.status).toBe(404);
  });

  test('an inverted date range is refused', async () => {
    const res = await api('GET', '/tasks/compliance?from=2026-08-26&to=2026-08-01');
    expect(res.status).toBe(400);
  });
});
