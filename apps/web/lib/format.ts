/**
 * Display formatting only. Everything renders in Asia/Kolkata whatever the
 * device clock says, so a phone set to Dubai still shows the Indian day.
 * Arithmetic on a decimal string never happens here.
 */

const IST = 'Asia/Kolkata';

const inr = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "4427.5" -> "₹4,427.50". Indian grouping, two decimals, always. */
export function money(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '₹0.00';
  return `₹${inr.format(n)}`;
}

/** "15" -> "15.000", with the unit appended when one is given. */
export function qty(value: string | number, unit?: string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const s = Number.isFinite(n) ? n.toFixed(3) : '0.000';
  return unit ? `${s} ${unit}` : s;
}

const shortDateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
});

const longDateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parse(iso: string): Date | null {
  // A bare "2026-08-26" parses as UTC midnight, which is 05:30 IST on the same
  // day, so the date reads correctly without a special case.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-08-26" -> "26 Aug" */
export function shortDate(iso: string): string {
  const d = parse(iso);
  return d ? shortDateFmt.format(d) : '';
}

/** "2026-08-26" -> "26 Aug 2026" */
export function longDate(iso: string): string {
  const d = parse(iso);
  return d ? longDateFmt.format(d) : '';
}

/** UTC ISO timestamp -> "09:24" in IST */
export function time(iso: string): string {
  const d = parse(iso);
  return d ? timeFmt.format(d) : '';
}

const relFmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** UTC ISO timestamp -> "2 hours ago" */
export function relative(iso: string): string {
  const d = parse(iso);
  if (!d) return '';
  const seconds = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return relFmt.format(Math.round(seconds / size), unit);
  }
  return relFmt.format(Math.round(seconds), 'second');
}

/** "3h 26m", "26m". Attendance and break durations. */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
