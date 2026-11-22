// Employee identity rules shared by the API and the web app, so the two cannot
// drift. See SRS Amendment 1.2 (FR-IDN-xxx) and book/docs/identity.

/**
 * Generated employee usernames are `BMEMP0001`, `BMEMP0002`, and so on. They are
 * stored lower case because every username in this system is (login lower-cases
 * what it is given), and shown upper case. Four digits is a minimum, not a cap:
 * number 10000 becomes `bmemp10000`, so nothing already issued changes.
 */
export const EMPLOYEE_USERNAME_PREFIX = 'bmemp';
export const EMPLOYEE_USERNAME_PATTERN = /^bmemp\d{4,}$/;

export function formatEmployeeUsername(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('An employee username sequence starts at 1');
  }
  return `${EMPLOYEE_USERNAME_PREFIX}${String(sequence).padStart(4, '0')}`;
}

/** The form people read and type: BMEMP0001. Other usernames are left alone. */
export function displayUsername(username: string): string {
  return EMPLOYEE_USERNAME_PATTERN.test(username) ? username.toUpperCase() : username;
}

/**
 * The one rule for "is this employee record part of attendance, task assignment
 * and employee reporting". It looks at the record only, never at the role of any
 * login linked to it. A shared dashboard account has no employee record at all,
 * so it never qualifies.
 *
 * Which statuses count is decision E in the identity analysis; this is the single
 * place to change it. EXITED is never eligible.
 */
export const ELIGIBLE_EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_NOTICE'] as const;

export function isEligibleEmployee(employee: {
  status: string;
  eligibleForWorkflows: boolean;
}): boolean {
  return (
    employee.eligibleForWorkflows &&
    (ELIGIBLE_EMPLOYMENT_STATUSES as readonly string[]).includes(employee.status)
  );
}
