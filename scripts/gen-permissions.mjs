// Regenerates packages/shared/src/permissions.ts from the matrix tables in
// book/src/14-rbac-and-permissions.md. The book is the source of truth; typing
// 84 rows by hand twice is how a role quietly gains a key nobody granted it.
import { readFileSync, writeFileSync } from 'node:fs';

const ROLES = [
  'OWNER', 'OPERATIONS_MANAGER', 'STORE_MANAGER', 'KITCHEN_MANAGER',
  'INVENTORY_MANAGER', 'PURCHASE_MANAGER', 'HR_ACCOUNTS', 'KITCHEN_STAFF',
  'COUNTER_CASHIER',
];

const md = readFileSync('book/src/14-rbac-and-permissions.md', 'utf8');
const block = md.slice(
  md.indexOf('## The permission matrix'),
  md.indexOf('## Per-role summary'),
);

const grants = Object.fromEntries(ROLES.map((r) => [r, {}]));
const keys = [];

for (const line of block.split('\n')) {
  const m = /^\|\s*`([a-z_]+\.[a-z_]+\.[a-z_]+)`\s*\|(.*)\|\s*$/.exec(line);
  if (!m) continue;
  const key = m[1];
  const cells = m[2].split('|').map((c) => c.trim());
  if (cells.length !== ROLES.length) {
    throw new Error(`${key}: expected ${ROLES.length} cells, got ${cells.length}`);
  }
  if (keys.includes(key)) throw new Error(`${key}: duplicate row`);
  keys.push(key);
  cells.forEach((cell, i) => {
    if (cell === '') return;
    if (!['A', 'O', 'S'].includes(cell)) throw new Error(`${key}: bad cell "${cell}"`);
    grants[ROLES[i]][key] = cell;
  });
}

const lines = [
  '// GENERATED from book/src/14-rbac-and-permissions.md.',
  '// Regenerate with `bun run scripts/gen-permissions.mjs`. Do not hand edit.',
  '// Scope modifiers: A = ALL_OUTLETS, O = OWN_OUTLET, S = SELF.',
  '',
  "export type ScopeModifier = 'A' | 'O' | 'S';",
  '',
  'export const PERMISSION_KEYS = [',
  ...keys.map((k) => `  '${k}',`),
  '] as const;',
  '',
  'export type PermissionKey = (typeof PERMISSION_KEYS)[number];',
  '',
  'export const PERMISSIONS: Record<string, Partial<Record<PermissionKey, ScopeModifier>>> = {',
  ...ROLES.flatMap((r) => [
    `  ${r}: {`,
    ...Object.entries(grants[r]).map(([k, v]) => `    '${k}': '${v}',`),
    '  },',
  ]),
  '};',
  '',
];

writeFileSync('packages/shared/src/permissions.ts', lines.join('\n'));
console.log(`${keys.length} keys written`);
for (const r of ROLES) console.log(`  ${r}: ${Object.keys(grants[r]).length}`);
