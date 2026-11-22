// bun test packages/shared
import { describe, expect, test } from 'bun:test';
import {
  EMPLOYEE_USERNAME_PATTERN,
  displayUsername,
  formatEmployeeUsername,
  isEligibleEmployee,
} from './employee-identity';
import { createEmployeeSchema, updateEmployeeSchema } from './workforce';
import { createUserSchema, updateUserSchema } from './admin';

describe('formatEmployeeUsername', () => {
  test('pads to four digits', () => {
    expect(formatEmployeeUsername(1)).toBe('bmemp0001');
    expect(formatEmployeeUsername(42)).toBe('bmemp0042');
    expect(formatEmployeeUsername(9999)).toBe('bmemp9999');
  });

  test('grows past four digits without changing earlier ones', () => {
    expect(formatEmployeeUsername(10000)).toBe('bmemp10000');
    expect(formatEmployeeUsername(123456)).toBe('bmemp123456');
    expect(formatEmployeeUsername(9999)).toBe('bmemp9999');
  });

  test('refuses nonsense sequence values', () => {
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatEmployeeUsername(n)).toThrow();
    }
  });

  test('every generated name matches the reserved pattern and fits the username limit', () => {
    for (const n of [1, 999, 10000, 99999999]) {
      const u = formatEmployeeUsername(n);
      expect(EMPLOYEE_USERNAME_PATTERN.test(u)).toBe(true);
      expect(u.length).toBeLessThanOrEqual(32);
    }
  });
});

describe('displayUsername', () => {
  test('shows generated usernames in upper case and leaves others alone', () => {
    expect(displayUsername('bmemp0007')).toBe('BMEMP0007');
    expect(displayUsername('counter.cashier.patharagadia')).toBe('counter.cashier.patharagadia');
    expect(displayUsername('bmemp')).toBe('bmemp');
  });
});

describe('isEligibleEmployee', () => {
  const e = (status: string, eligibleForWorkflows = true) => ({ status, eligibleForWorkflows });

  test('active and on-notice employees are eligible', () => {
    expect(isEligibleEmployee(e('ACTIVE'))).toBe(true);
    expect(isEligibleEmployee(e('ON_NOTICE'))).toBe(true);
  });

  test('an exited employee never is', () => {
    expect(isEligibleEmployee(e('EXITED'))).toBe(false);
  });

  test('a record the Owner excluded is not eligible whatever its status', () => {
    expect(isEligibleEmployee(e('ACTIVE', false))).toBe(false);
    expect(isEligibleEmployee(e('ON_NOTICE', false))).toBe(false);
  });

  test('eligibility ignores the role: there is no role input to the rule', () => {
    // The function accepts only the record's own fields. A cashier role cannot
    // make a record eligible or ineligible.
    expect(isEligibleEmployee({ status: 'ACTIVE', eligibleForWorkflows: true, ...{ roleKey: 'COUNTER_CASHIER' } })).toBe(true);
  });
});

describe('request schemas', () => {
  const base = {
    fullName: 'Test Person',
    phone: '9437011223',
    outletId: '11111111-1111-4111-8111-111111111111',
    joinedOn: '2026-10-27',
    roleKey: 'KITCHEN_STAFF',
  };

  test('create accepts a valid employee and requires a role', () => {
    expect(createEmployeeSchema.safeParse(base).success).toBe(true);
    const noRole: Partial<typeof base> = { ...base };
    delete noRole.roleKey;
    expect(createEmployeeSchema.safeParse(noRole).success).toBe(false);
  });

  test('create refuses a client-supplied username, user id or distance of any kind', () => {
    for (const extra of [{ username: 'bmemp0001' }, { userId: base.outletId }, { password: 'x' }]) {
      expect(createEmployeeSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  test('the Owner role cannot be handed out from Add Employee', () => {
    expect(createEmployeeSchema.safeParse({ ...base, roleKey: 'OWNER' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, roleKey: 'COUNTER_CASHIER' }).success).toBe(true);
  });

  test('update cannot change role, join date, user link or username', () => {
    for (const extra of [{ roleKey: 'OWNER' }, { joinedOn: '2026-01-01' }, { userId: base.outletId }, { username: 'x1y' }]) {
      expect(updateEmployeeSchema.safeParse(extra).success).toBe(false);
    }
    expect(updateEmployeeSchema.safeParse({ status: 'ON_NOTICE' }).success).toBe(true);
    expect(updateEmployeeSchema.safeParse({ status: 'EXITED' }).success).toBe(false);
  });

  test('ordinary account creation cannot take a name from the generated range', () => {
    const user = { roleKey: 'COUNTER_CASHIER', outletIds: [base.outletId] };
    expect(createUserSchema.safeParse({ ...user, username: 'counter.main' }).success).toBe(true);
    for (const reserved of ['bmemp0001', 'BMEMP0001', 'bmemp12345']) {
      expect(createUserSchema.safeParse({ ...user, username: reserved }).success).toBe(false);
      expect(updateUserSchema.safeParse({ username: reserved }).success).toBe(false);
    }
  });
});
