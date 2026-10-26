// bun test test/attendance-summary.test.ts  (pure, no database)
import { describe, expect, test } from 'bun:test';
import {
  summariseAttendance,
  type SummaryDay,
  type SummaryInput,
} from '../src/modules/workforce/attendance-summary';

const verified = (d: string, status: SummaryDay['status'] = 'PRESENT'): SummaryDay => ({
  businessDate: d,
  status,
  verificationStatus: 'VERIFIED',
});
const other = (d: string, v: SummaryDay['verificationStatus']): SummaryDay => ({
  businessDate: d,
  status: 'PRESENT',
  verificationStatus: v,
});

const base = (over: Partial<SummaryInput>): SummaryInput => ({
  from: '2026-10-01',
  to: '2026-10-31',
  today: '2026-10-26',
  joinedOn: '2026-01-01',
  exitedOn: null,
  scheduledDates: [],
  days: [],
  approvedLeave: [],
  ...over,
});

const D = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

describe('attendance percentage', () => {
  test('no roster means N/A, not 0%', () => {
    const s = summariseAttendance(base({ days: [verified('2026-10-05')] }));
    expect(s.eligibleDays).toBe(0);
    expect(s.attendancePercent).toBeNull();
  });

  test('verified present over eligible scheduled days', () => {
    const s = summariseAttendance(
      base({ scheduledDates: D, days: D.slice(0, 4).map((d) => verified(d)) }),
    );
    expect(s.eligibleDays).toBe(5);
    expect(s.verifiedPresentDays).toBe(4);
    expect(s.attendancePercent).toBe(80);
  });

  test('pending is not present and is not removed from the denominator', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: D,
        days: [verified(D[0]!), verified(D[1]!), verified(D[2]!), other(D[3]!, 'PENDING')],
      }),
    );
    expect(s.verifiedPresentDays).toBe(3);
    expect(s.eligibleDays).toBe(5);
    expect(s.pendingDays).toBe(1);
    expect(s.attendancePercent).toBe(60);
  });

  test('rejected does not count as present and is reported', () => {
    const s = summariseAttendance(
      base({ scheduledDates: D, days: [verified(D[0]!), other(D[1]!, 'REJECTED')] }),
    );
    expect(s.verifiedPresentDays).toBe(1);
    expect(s.rejectedDays).toBe(1);
  });

  test('days with no verification record are reported, never counted as present', () => {
    const s = summariseAttendance(
      base({ scheduledDates: D, days: [other(D[0]!, null), verified(D[1]!)] }),
    );
    expect(s.verifiedPresentDays).toBe(1);
    expect(s.unverifiedDays).toBe(1);
  });

  test('approved leave on a scheduled day leaves the denominator', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: D,
        days: [verified(D[0]!), verified(D[1]!), verified(D[3]!)],
        approvedLeave: [{ fromDate: D[2]!, toDate: D[2]!, halfDay: false }],
      }),
    );
    expect(s.approvedLeaveDays).toBe(1);
    expect(s.eligibleDays).toBe(4);
    expect(s.attendancePercent).toBe(75);
  });

  test('leave over days that are not scheduled changes nothing', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: D,
        days: D.map((d) => verified(d)),
        approvedLeave: [{ fromDate: '2026-10-10', toDate: '2026-10-12', halfDay: false }],
      }),
    );
    expect(s.approvedLeaveDays).toBe(0);
    expect(s.attendancePercent).toBe(100);
  });

  test('multi-day leave only removes the scheduled days it covers', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: D,
        days: [verified(D[0]!)],
        approvedLeave: [{ fromDate: D[1]!, toDate: D[3]!, halfDay: false }],
      }),
    );
    expect(s.approvedLeaveDays).toBe(3);
    expect(s.eligibleDays).toBe(2);
  });

  test('a worked, verified day inside approved leave is not double counted', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: D,
        days: D.map((d) => verified(d)),
        approvedLeave: [{ fromDate: D[0]!, toDate: D[0]!, halfDay: false }],
      }),
    );
    expect(s.eligibleDays).toBe(4);
    expect(s.verifiedPresentDays).toBe(4);
    expect(s.verifiedOnIneligibleDays).toBe(1);
    expect(s.attendancePercent).toBe(100);
  });

  test('approved half-day leave is reported, not weighted', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: D,
        days: D.map((d) => verified(d)),
        approvedLeave: [{ fromDate: D[0]!, toDate: D[0]!, halfDay: true }],
      }),
    );
    expect(s.eligibleDays).toBe(5);
    expect(s.halfDayLeaveDays).toBe(1);
  });

  test('verified work on an unrostered day cannot push the figure past 100', () => {
    const s = summariseAttendance(
      base({
        scheduledDates: [D[0]!],
        days: [verified(D[0]!), verified(D[1]!), verified(D[2]!)],
      }),
    );
    expect(s.attendancePercent).toBe(100);
    expect(s.verifiedOnIneligibleDays).toBe(2);
  });

  test('two shifts on one date are one scheduled day', () => {
    const s = summariseAttendance(
      base({ scheduledDates: [D[0]!, D[0]!], days: [verified(D[0]!)] }),
    );
    expect(s.scheduledWorkingDays).toBe(1);
    expect(s.attendancePercent).toBe(100);
  });

  test('a HALF_DAY with a verified record counts as one present day', () => {
    const s = summariseAttendance(
      base({ scheduledDates: [D[0]!], days: [verified(D[0]!, 'HALF_DAY')] }),
    );
    expect(s.verifiedPresentDays).toBe(1);
  });
});

describe('date boundaries', () => {
  test('future scheduled days are not absences', () => {
    const s = summariseAttendance(
      base({ scheduledDates: ['2026-10-27', '2026-10-28'], days: [] }),
    );
    expect(s.eligibleDays).toBe(0);
    expect(s.attendancePercent).toBeNull();
    expect(s.to).toBe('2026-10-26');
  });

  test('today is in progress: not an absence, but counted once verified', () => {
    const open = summariseAttendance(
      base({ scheduledDates: [D[0]!, '2026-10-26'], days: [verified(D[0]!)] }),
    );
    expect(open.eligibleDays).toBe(1);
    expect(open.inProgressDays).toBe(1);

    const done = summariseAttendance(
      base({
        scheduledDates: [D[0]!, '2026-10-26'],
        days: [verified(D[0]!), verified('2026-10-26')],
      }),
    );
    expect(done.eligibleDays).toBe(2);
    expect(done.attendancePercent).toBe(100);
  });

  test('days before the joining date are not eligible', () => {
    const s = summariseAttendance(
      base({ joinedOn: '2026-10-07', scheduledDates: D, days: [verified(D[2]!)] }),
    );
    expect(s.from).toBe('2026-10-07');
    expect(s.eligibleDays).toBe(3);
  });

  test('days after the exit date are not eligible', () => {
    const s = summariseAttendance(
      base({ exitedOn: '2026-10-06', scheduledDates: D, days: [verified(D[0]!)] }),
    );
    expect(s.to).toBe('2026-10-06');
    expect(s.eligibleDays).toBe(2);
  });

  test('a range entirely before joining is N/A', () => {
    const s = summariseAttendance(
      base({ joinedOn: '2026-10-20', to: '2026-10-10', scheduledDates: D }),
    );
    expect(s.attendancePercent).toBeNull();
  });

  test('month end, year end and a leap day fall in the right monthly bucket', () => {
    const dates = ['2027-12-31', '2028-01-01', '2028-02-28', '2028-02-29', '2028-03-01'];
    const s = summariseAttendance({
      from: '2027-12-01',
      to: '2028-03-31',
      today: '2028-03-31',
      joinedOn: '2020-01-01',
      exitedOn: null,
      scheduledDates: dates,
      days: dates.map((d) => verified(d)),
      approvedLeave: [],
    });
    expect(s.months.map((m) => [m.month, m.eligibleDays])).toEqual([
      ['2027-12', 1],
      ['2028-01', 1],
      ['2028-02', 2],
      ['2028-03', 1],
    ]);
    expect(s.eligibleDays).toBe(5);
  });

  test('the monthly figures add up to the total', () => {
    const dates = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
    const s = summariseAttendance(
      base({
        from: '2026-09-01',
        scheduledDates: dates,
        days: [verified(dates[0]!), verified(dates[2]!), verified(dates[3]!)],
      }),
    );
    expect(s.months.reduce((a, m) => a + m.eligibleDays, 0)).toBe(s.eligibleDays);
    expect(s.months.reduce((a, m) => a + m.verifiedPresentDays, 0)).toBe(s.verifiedPresentDays);
    expect(s.attendancePercent).toBe(75);
  });
});
