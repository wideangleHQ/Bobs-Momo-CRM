// bun test apps/api
// WhatsApp adapter and internal chat. Assumes `db:seed` has run.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { toE164India } from '@bobs-momo/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PasswordService } from '../src/modules/auth/password.service';
import { MessagingModule } from '../src/modules/messaging/messaging.module';
import { MessagingService } from '../src/modules/messaging/messaging.service';
import { WhatsappModule } from '../src/modules/whatsapp/whatsapp.module';
import { NullWhatsAppService } from '../src/modules/whatsapp/whatsapp.provider';
import { WhatsappService } from '../src/modules/whatsapp/whatsapp.service';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from '../src/modules/whatsapp/whatsapp.types';

const prisma = new PrismaClient();
let app: INestApplication;
let url: string;

const PASSWORD = 'saheed-momo-2026';
const SENDER = 'e2e.msg.sender';
const SAHEED = 'e2e.msg.saheed';
const THIRD = 'e2e.msg.third';
const PATIA = 'e2e.msg.patia';
const USERNAMES = [SENDER, SAHEED, THIRD, PATIA];
const CODE_PREFIX = 'BM-E2E-MSG-';
const WAMID = 'wamid.e2e-messaging-test';
const APP_SECRET = 'e2e-whatsapp-app-secret';
const VERIFY_TOKEN = 'e2e-whatsapp-verify-token';

const tokens: Record<string, string> = {};
const userIds: Record<string, string> = {};
let saheedOutletId: string;
let patiaOutletId: string;

async function api(
  method: string,
  path: string,
  as: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[as] ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

function uid(username: string): string {
  const id = userIds[username];
  if (!id) throw new Error(`no seeded user ${username}`);
  return id;
}

function ids(res: { body: Record<string, unknown> | null }): string[] {
  return ((res.body?.['data'] as Array<{ id: string }> | undefined) ?? []).map((m) => m.id);
}

function errorCode(res: { body: Record<string, unknown> | null }): string | undefined {
  return (res.body?.['error'] as { code?: string } | undefined)?.code;
}

function sign(raw: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
}

function statusPayload(status: string): string {
  // Deliberately non-canonical whitespace. If the signature were computed over
  // a re-serialised body instead of the bytes Meta signed, this would 401.
  return `{  "entry" : [ { "changes": [ { "value": {"statuses":[{"id":"${WAMID}","status":"${status}","timestamp":"1756200000"}]} } ] } ] }`;
}

async function postWebhook(raw: string, signature: string): Promise<number> {
  const res = await fetch(`${url}/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  });
  return res.status;
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { in: USERNAMES } },
    select: { id: true },
  });
  const ownerIds = users.map((u) => u.id);
  const messages = await prisma.message.findMany({
    where: { senderId: { in: ownerIds } },
    select: { id: true },
  });
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: messages.map((m) => m.id) } } });
  await prisma.message.deleteMany({ where: { senderId: { in: ownerIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ownerIds } } });
  await prisma.employee.deleteMany({ where: { employeeCode: { startsWith: CODE_PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { in: USERNAMES } } });
}

beforeAll(async () => {
  process.env['WHATSAPP_ENABLED'] = 'false';
  process.env['WHATSAPP_APP_SECRET'] = APP_SECRET;
  process.env['WHATSAPP_VERIFY_TOKEN'] = VERIFY_TOKEN;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, MessagingModule, WhatsappModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.listen(0);
  url = `${await app.getUrl()}/api/v1`.replace('[::1]', '127.0.0.1');

  const hash = await app.get(PasswordService).hash(PASSWORD);
  const saheed = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-SAHEED' } });
  const patia = await prisma.outlet.findFirstOrThrow({ where: { code: 'BM-PATIA' } });
  saheedOutletId = saheed.id;
  patiaOutletId = patia.id;

  await cleanup();

  const seedUser = async (
    username: string,
    roleKey: 'STORE_MANAGER' | 'KITCHEN_STAFF',
    outletId: string,
    suffix: string,
  ): Promise<void> => {
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, roleKey, mustReset: false },
    });
    await prisma.userOutlet.create({ data: { userId: user.id, outletId } });
    await prisma.employee.create({
      data: {
        userId: user.id,
        employeeCode: `${CODE_PREFIX}${suffix}`,
        fullName: `E2E ${suffix}`,
        phone: '9876543210',
        outletId,
        joinedOn: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    userIds[username] = user.id;
  };

  await seedUser(SENDER, 'STORE_MANAGER', saheedOutletId, 'SENDER');
  await seedUser(SAHEED, 'KITCHEN_STAFF', saheedOutletId, 'SAHEED');
  await seedUser(THIRD, 'KITCHEN_STAFF', saheedOutletId, 'THIRD');
  await seedUser(PATIA, 'KITCHEN_STAFF', patiaOutletId, 'PATIA');

  for (const username of USERNAMES) {
    const res = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: username, password: PASSWORD }),
    });
    tokens[username] = ((await res.json()) as { accessToken: string }).accessToken;
  }

  await prisma.notification.create({
    data: {
      userId: uid(SENDER),
      eventKey: 'BROADCAST',
      channel: 'WHATSAPP',
      status: 'QUEUED',
      title: 'Broadcast',
      body: 'Delivery status fixture',
      providerRef: WAMID,
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await app?.close();
});

describe('the WhatsApp adapter', () => {
  test('the flag being off picks the null adapter, and it never touches the network', async () => {
    const provider = app.get<WhatsAppProvider>(WHATSAPP_PROVIDER);
    expect(provider).toBeInstanceOf(NullWhatsAppService);

    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
      calls += 1;
      return realFetch(...args);
    }) as typeof realFetch;

    try {
      const sent = await app
        .get(WhatsappService)
        .sendTemplate('9876543210', 'SALES_ENTRY_MISSING', ['BM-SAHEED', '2026-08-26']);
      expect(sent?.providerRef.startsWith('stub:')).toBe(true);
      expect(sent?.accepted).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls).toBe(0);
  });

  test('Indian numbers normalise to E.164 and anything else is refused', () => {
    for (const raw of [
      '9876543210',
      '09876543210',
      '+91 98765 43210',
      '91-9876543210',
      '0091 9876543210',
    ]) {
      expect(toE164India(raw)).toBe('+919876543210');
    }
    for (const raw of ['1234567890', '98765', '+1 415 555 0123', 'abc', '']) {
      expect(toE164India(raw)).toBeNull();
    }
  });

  test('a number that will not normalise is never handed to the provider', async () => {
    const sent = await app
      .get(WhatsappService)
      .sendTemplate('+1 415 555 0123', 'SALES_ENTRY_MISSING', ['BM-SAHEED', '2026-08-26']);
    expect(sent).toBeNull();
  });

  test('a variable count that does not match the approved template is refused', async () => {
    await expect(
      app.get(WhatsappService).sendTemplate('9876543210', 'SALES_ENTRY_MISSING', ['only one']),
    ).rejects.toThrow(/2 variables/);
  });
});

describe('the webhook', () => {
  test('the verification handshake echoes the challenge for the right token only', async () => {
    const ok = await fetch(
      `${url}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');

    const bad = await fetch(
      `${url}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1158201444`,
    );
    expect(bad.status).toBe(403);
    expect(await bad.text()).toBe('');
  });

  test('a bad signature is rejected and changes nothing', async () => {
    const raw = statusPayload('delivered');
    expect(await postWebhook(raw, sign(`${raw} `))).toBe(401);
    expect(await postWebhook(raw, 'sha256=deadbeef')).toBe(401);
    expect(await postWebhook(raw, '')).toBe(401);

    const row = await prisma.notification.findFirstOrThrow({ where: { providerRef: WAMID } });
    expect(row.status).toBe('QUEUED');
  });

  test('a valid signature over the exact bytes advances the status, idempotently', async () => {
    const raw = statusPayload('delivered');
    expect(await postWebhook(raw, sign(raw))).toBe(200);
    expect(await postWebhook(raw, sign(raw))).toBe(200);

    const row = await prisma.notification.findFirstOrThrow({ where: { providerRef: WAMID } });
    expect(row.status).toBe('DELIVERED');

    // Meta does not guarantee ordering. Status only ever moves forward.
    const late = statusPayload('sent');
    expect(await postWebhook(late, sign(late))).toBe(200);
    const after = await prisma.notification.findFirstOrThrow({ where: { providerRef: WAMID } });
    expect(after.status).toBe('DELIVERED');
  });
});

describe('broadcast', () => {
  let broadcastId: string;

  test('an outlet broadcast writes one message and one BROADCAST outbox event', async () => {
    const res = await api('POST', '/messages/broadcast', SENDER, {
      scope: 'OUTLET',
      outletId: saheedOutletId,
      body: 'Fryer 2 is out of service until Thursday. Use fryer 1 for rolls.',
    });
    expect(res.status).toBe(201);
    broadcastId = res.body?.['id'] as string;

    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: broadcastId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventKey).toBe('BROADCAST');
    expect(events[0]?.status).toBe('PENDING');
  });

  test('it resolves to every active employee at that outlet, minus the sender', async () => {
    const recipients = await app.get(MessagingService).resolveRecipients({
      scope: 'OUTLET',
      senderId: uid(SENDER),
      recipientId: null,
      outletId: saheedOutletId,
      departmentId: null,
    });
    expect(recipients).toContain(uid(SAHEED));
    expect(recipients).toContain(uid(THIRD));
    expect(recipients).not.toContain(uid(PATIA));
    expect(recipients).not.toContain(uid(SENDER));
  });

  test('the other outlet never sees it', async () => {
    const mine = await api('GET', `/messages?scope=OUTLET&outletId=${saheedOutletId}`, SAHEED);
    expect(mine.status).toBe(200);
    expect(ids(mine)).toContain(broadcastId);

    const theirs = await api('GET', '/messages', PATIA);
    expect(theirs.status).toBe(200);
    expect(ids(theirs)).not.toContain(broadcastId);
  });

  test('asking for the other outlet is a 404, not a 403', async () => {
    const res = await api('GET', `/messages?scope=OUTLET&outletId=${patiaOutletId}`, SAHEED);
    expect(res.status).toBe(404);
  });

  test('a kitchen staff account cannot broadcast at all', async () => {
    const res = await api('POST', '/messages/broadcast', SAHEED, {
      scope: 'OUTLET',
      outletId: saheedOutletId,
      body: 'Everyone go home',
    });
    expect(res.status).toBe(403);
  });

  test('scope ALL is refused to a store manager', async () => {
    const res = await api('POST', '/messages/broadcast', SENDER, {
      scope: 'ALL',
      body: 'Company wide notice',
    });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('BROADCAST_SCOPE_FORBIDDEN');
  });
});

describe('direct messages', () => {
  let directId: string;

  test('a direct message writes an in-app notification and no outbox event', async () => {
    const res = await api('POST', '/messages', SENDER, {
      recipientId: uid(SAHEED),
      body: 'Can you cover the 6pm shift?',
    });
    expect(res.status).toBe(201);
    directId = res.body?.['id'] as string;

    expect(await prisma.outboxEvent.count({ where: { aggregateId: directId } })).toBe(0);
    const notifications = await prisma.notification.findMany({
      where: { userId: uid(SAHEED), eventKey: 'DIRECT_MESSAGE' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.channel).toBe('IN_APP');
  });

  test('the recipient sees it and a third party at the same outlet does not', async () => {
    const recipient = await api('GET', '/messages?scope=DIRECT', SAHEED);
    expect(ids(recipient)).toContain(directId);

    const third = await api('GET', '/messages', THIRD);
    expect(third.status).toBe(200);
    expect(ids(third)).not.toContain(directId);

    const thirdDirect = await api('GET', `/messages?scope=DIRECT&withUserId=${uid(SENDER)}`, THIRD);
    expect(ids(thirdDirect)).not.toContain(directId);
  });

  test('a third party cannot mark it read either', async () => {
    const res = await api('POST', `/messages/${directId}/read`, THIRD);
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('MESSAGE_NOT_FOUND');
  });

  test('marking read twice is one row and drops the unread count by one', async () => {
    const before = await api('GET', '/messages/unread-count', SAHEED);
    const start = before.body?.['count'] as number;
    expect(start).toBeGreaterThan(0);

    expect((await api('POST', `/messages/${directId}/read`, SAHEED)).status).toBe(204);
    expect((await api('POST', `/messages/${directId}/read`, SAHEED)).status).toBe(204);
    expect(await prisma.messageRead.count({ where: { messageId: directId } })).toBe(1);

    const after = await api('GET', '/messages/unread-count', SAHEED);
    expect(after.body?.['count']).toBe(start - 1);
  });

  test('a body over 2,000 characters is a validation failure', async () => {
    const res = await api('POST', '/messages', SENDER, {
      recipientId: uid(SAHEED),
      body: 'x'.repeat(2001),
    });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('COMMON_VALIDATION_FAILED');
  });
});
