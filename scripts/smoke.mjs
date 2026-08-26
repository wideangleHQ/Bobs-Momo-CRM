// Post-deploy gate. Runs against a live deployment, not a test database.
//
//   bun run scripts/smoke.mjs https://api.example.com/api/v1 owner 'the-password'
//
// It only reads and it never writes, so it is safe to point at production. A
// smoke suite that creates rows is one somebody eventually forgets to clean up.
// Exits non-zero on the first failure, which is what a deploy step wants.

const [, , baseArg, userArg, passArg] = process.argv;
const BASE = baseArg ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3001/api/v1';
const USER = userArg ?? process.env.SMOKE_USER ?? 'owner';
const PASS = passArg ?? process.env.SMOKE_PASSWORD;

if (!PASS) {
  console.error('Give a password as the third argument or set SMOKE_PASSWORD');
  process.exit(2);
}

let token = null;
let failures = 0;

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    console.log(`  ok    ${name} (${Date.now() - started}ms)`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(Date.now() - 4 * 60 * 60 * 1000));

console.log(`smoke ${BASE}`);

await check('liveness answers', async () => {
  const res = await call('/health/healthz', { auth: false });
  expect(res.status === 200, `expected 200, got ${res.status}`);
});

await check('readiness reaches the database', async () => {
  const res = await call('/health/readyz', { auth: false });
  expect(res.status === 200, `expected 200, got ${res.status}`);
  expect(res.body.db === 'up', `database is ${res.body.db}`);
});

await check('an unauthenticated request is refused', async () => {
  const res = await call('/inventory/stock', { auth: false });
  expect(res.status === 401, `expected 401, got ${res.status}`);
});

await check('login issues a token and a permission list', async () => {
  const res = await call('/auth/login', {
    method: 'POST',
    auth: false,
    body: { identifier: USER, password: PASS },
  });
  expect(res.status === 200, `expected 200, got ${res.status}`);
  expect(typeof res.body.accessToken === 'string', 'no access token');
  expect(Object.keys(res.body.user.permissions).length > 0, 'no permissions');
  token = res.body.accessToken;
});

await check('a wrong password is refused with the same shape', async () => {
  const res = await call('/auth/login', {
    method: 'POST',
    auth: false,
    body: { identifier: USER, password: 'definitely-not-the-password' },
  });
  expect(res.status === 401, `expected 401, got ${res.status}`);
  expect(res.body.error.code === 'AUTH_INVALID_CREDENTIALS', res.body.error.code);
});

await check('the session identifies itself', async () => {
  const res = await call('/auth/me');
  expect(res.status === 200, `expected 200, got ${res.status}`);
  expect(res.body.username === USER, `got ${res.body.username}`);
});

await check('outlets resolve', async () => {
  const res = await call('/outlets');
  expect(res.status === 200, `expected 200, got ${res.status}`);
  expect(res.body.data.length > 0, 'no outlets');
});

await check('reference data is seeded', async () => {
  const res = await call('/inventory/items?pageSize=5');
  expect(res.status === 200, `expected 200, got ${res.status}`);
  expect(res.body.meta.total > 0, 'the item master is empty');
});

await check('stock balances read', async () => {
  const res = await call('/inventory/stock?pageSize=5');
  expect(res.status === 200, `expected 200, got ${res.status}`);
});

await check('the ledger reads', async () => {
  const res = await call('/inventory/transactions?pageSize=5');
  expect(res.status === 200, `expected 200, got ${res.status}`);
});

for (const [name, path] of [
  ['purchases', '/purchases?pageSize=1'],
  ['purchase requests', '/purchase-requests?pageSize=1'],
  ['vendors', '/vendors?pageSize=1'],
  ['employees', '/employees?pageSize=1'],
  ['the attendance board', '/attendance/today'],
  ['shifts', '/shifts?pageSize=1'],
  ['leave requests', '/leave-requests?pageSize=1'],
  ['tasks', '/tasks?pageSize=1'],
  ['checklist templates', '/checklist-templates'],
  ['sales entries', '/sales-entries?pageSize=1'],
  ['notifications', '/notifications?pageSize=1'],
  ['the audit log', '/admin/audit-log?pageSize=1'],
]) {
  await check(`${name} read`, async () => {
    const res = await call(path);
    expect(res.status === 200, `expected 200, got ${res.status}`);
  });
}

await check('the dashboard renders', async () => {
  const res = await call('/analytics/dashboard');
  expect(res.status === 200, `expected 200, got ${res.status}`);
  expect(typeof res.body.tiles === 'object', 'no tiles');
});

await check('a report needs an explicit date range', async () => {
  const res = await call('/analytics/sales');
  expect(res.status === 400, `expected 400, got ${res.status}`);
});

await check('the sales report runs', async () => {
  const res = await call(`/analytics/sales?from=${today}&to=${today}`);
  expect(res.status === 200, `expected 200, got ${res.status}`);
});

await check('gross margin carries its caveat', async () => {
  const res = await call(`/analytics/gross-margin?from=${today}&to=${today}`);
  expect(res.status === 200, `expected 200, got ${res.status}`);
  // A margin figure presented as profit is this report's failure mode, so the
  // caveat travelling with the number is part of the contract, not decoration.
  expect(res.body.approximation === true, 'approximation flag missing');
  expect(typeof res.body.caveat === 'string' && res.body.caveat.length > 0, 'caveat missing');
});

await check('an unknown route returns the error envelope', async () => {
  const res = await call('/definitely-not-a-route');
  expect(res.status === 404, `expected 404, got ${res.status}`);
  expect(typeof res.body.error?.requestId === 'string', 'no requestId in the envelope');
});

console.log(failures === 0 ? '\nsmoke passed' : `\nsmoke failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
