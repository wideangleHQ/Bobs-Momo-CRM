/**
 * Crons run unless a deployment turns them off. The test suite sets
 * JOBS_ENABLED=false so a 30 second tick does not fire mid-assertion; tests
 * call the plain service methods directly instead.
 *
 * Read straight off process.env rather than through env(), because a value
 * that only the test harness and a one-off Railway replica ever set does not
 * belong in the boot schema every other environment has to satisfy.
 */
export function jobsEnabled(): boolean {
  return process.env['JOBS_ENABLED'] !== 'false';
}
