import type { AttendanceStatus } from '@prisma/client';
import type { VerificationStatus } from '@bobs-momo/shared';

/**
 * SRS Amendment v1.1 A7, as literally as the data allows:
 *
 *   Eligible days = scheduled working days - approved leave on scheduled days
 *   Attendance %  = verified present days / eligible days x 100
 *
 * "Scheduled working day" is a date on which the employee has a SCHEDULED shift.
 * Nothing is assumed about days with no roster: they are neither eligible nor
 * absent, so an employee with no roster gets `null` (shown as N/A), not 0%.
 *
 * Choices the SRS does not make, each reported rather than hidden (see the open
 * decisions document):
 *  - HALF_DAY with a VERIFIED record counts as one present day (A5.10 counts the
 *    verified record once per workday; no weighting is defined).
 *  - Approved half-day leave does not remove the day from the denominator; it is
 *    counted in `halfDayLeaveDays` instead of inventing a 0.5 weighting.
 *  - The current business date is in progress: it is never an absence, and joins
 *    the denominator only once it has a verified present record.
 *  - Verified presence on a day that is not eligible (unscheduled, or covered by
 *    approved leave) stays out of the numerator so the percentage cannot pass 100.
 */

export interface SummaryDay {
  businessDate: string;
  status: AttendanceStatus;
  verificationStatus: VerificationStatus | null;
}

export interface SummaryLeave {
  fromDate: string;
  toDate: string;
  halfDay: boolean;
}

export interface SummaryInput {
  from: string;
  to: string;
  today: string;
  joinedOn: string;
  exitedOn: string | null;
  scheduledDates: string[];
  days: SummaryDay[];
  approvedLeave: SummaryLeave[];
}

export interface SummaryCounts {
  scheduledWorkingDays: number;
  approvedLeaveDays: number;
  eligibleDays: number;
  verifiedPresentDays: number;
  /** null when there are no eligible days: the UI shows N/A. */
  attendancePercent: number | null;
  halfDayLeaveDays: number;
  inProgressDays: number;
  pendingDays: number;
  rejectedDays: number;
  /** Present-looking days with no verification record (pre-verification data). */
  unverifiedDays: number;
  verifiedOnIneligibleDays: number;
}

export interface MonthlySummary extends SummaryCounts {
  month: string;
}

export interface AttendanceSummary extends SummaryCounts {
  from: string;
  to: string;
  months: MonthlySummary[];
}

const PRESENT: readonly AttendanceStatus[] = ['PRESENT', 'HALF_DAY'];

function zero(): Omit<SummaryCounts, 'attendancePercent'> {
  return {
    scheduledWorkingDays: 0,
    approvedLeaveDays: 0,
    eligibleDays: 0,
    verifiedPresentDays: 0,
    halfDayLeaveDays: 0,
    inProgressDays: 0,
    pendingDays: 0,
    rejectedDays: 0,
    unverifiedDays: 0,
    verifiedOnIneligibleDays: 0,
  };
}

function finish(c: Omit<SummaryCounts, 'attendancePercent'>): SummaryCounts {
  return {
    ...c,
    // Two decimals is a display precision, not a rounding policy: none is defined.
    attendancePercent:
      c.eligibleDays === 0
        ? null
        : Math.round((c.verifiedPresentDays / c.eligibleDays) * 10_000) / 100,
  };
}

export function summariseAttendance(input: SummaryInput): AttendanceSummary {
  const start = input.from > input.joinedOn ? input.from : input.joinedOn;
  let end = input.to < input.today ? input.to : input.today;
  if (input.exitedOn && input.exitedOn < end) end = input.exitedOn;

  const total = zero();
  const byMonth = new Map<string, ReturnType<typeof zero>>();
  const bucket = (date: string) => {
    const key = date.slice(0, 7);
    let b = byMonth.get(key);
    if (!b) {
      b = zero();
      byMonth.set(key, b);
    }
    return b;
  };
  const bump = (date: string, field: keyof ReturnType<typeof zero>) => {
    total[field] += 1;
    bucket(date)[field] += 1;
  };

  if (start <= end) {
    const dayByDate = new Map(input.days.map((d) => [d.businessDate, d]));
    const scheduled = new Set(
      input.scheduledDates.filter((d) => d >= start && d <= end),
    );
    const covered = (date: string, half: boolean) =>
      input.approvedLeave.some((l) => l.halfDay === half && l.fromDate <= date && date <= l.toDate);
    const verifiedPresent = (date: string) => {
      const d = dayByDate.get(date);
      return d !== undefined && d.verificationStatus === 'VERIFIED' && PRESENT.includes(d.status);
    };

    for (const day of input.days) {
      if (day.businessDate < start || day.businessDate > end) continue;
      if (!PRESENT.includes(day.status)) continue;
      if (day.verificationStatus === 'PENDING') bump(day.businessDate, 'pendingDays');
      else if (day.verificationStatus === 'REJECTED') bump(day.businessDate, 'rejectedDays');
      else if (day.verificationStatus === null) bump(day.businessDate, 'unverifiedDays');
    }

    for (const date of scheduled) {
      bump(date, 'scheduledWorkingDays');
      const present = verifiedPresent(date);
      if (covered(date, false)) {
        bump(date, 'approvedLeaveDays');
        if (present) bump(date, 'verifiedOnIneligibleDays');
        continue;
      }
      if (date === input.today && !present) {
        bump(date, 'inProgressDays');
        continue;
      }
      bump(date, 'eligibleDays');
      if (present) bump(date, 'verifiedPresentDays');
      if (covered(date, true)) bump(date, 'halfDayLeaveDays');
    }

    for (const d of input.days) {
      if (d.businessDate < start || d.businessDate > end || scheduled.has(d.businessDate)) continue;
      if (verifiedPresent(d.businessDate)) bump(d.businessDate, 'verifiedOnIneligibleDays');
    }
  }

  return {
    from: start,
    to: end,
    ...finish(total),
    months: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, c]) => ({ month, ...finish(c) })),
  };
}
