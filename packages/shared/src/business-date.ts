export const BUSINESS_DAY_START_HOUR = 4;

/** "2026-08-16". The trading day that `at` belongs to. Chapter 12. */
export function toBusinessDate(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() - BUSINESS_DAY_START_HOUR * 60 * 60 * 1000);
  // en-CA formats as YYYY-MM-DD. No date library needed.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/** What Prisma wants for a @db.Date column: midnight UTC on that date. */
export function toBusinessDateUtc(at: Date = new Date()): Date {
  return new Date(`${toBusinessDate(at)}T00:00:00.000Z`);
}

/** `n` business days before the trading day containing `at`. */
export function businessDateOffset(days: number, at: Date = new Date()): Date {
  const base = toBusinessDateUtc(at);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
