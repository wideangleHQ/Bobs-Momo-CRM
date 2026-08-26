import { describe, expect, test } from 'bun:test';
import { hm, istHhmm, liveWorkedMins, mondayOf, weekDays } from './api';
import { dueLabel } from '../tasks/api';

describe('worked time', () => {
  test('hm reads as a clock, not a number', () => {
    expect(hm(0)).toBe('0 min');
    expect(hm(22)).toBe('22 min');
    expect(hm(206)).toBe('3h 26m');
  });

  test('a closed day uses the servers workedMins', () => {
    const row = { state: 'OUT' as const, firstInAt: null, workedMins: 495, breakMins: 45 };
    expect(liveWorkedMins(row, Date.now())).toBe(495);
  });

  test('somebody still on the floor counts from their first punch, less breaks', () => {
    const firstInAt = '2026-08-26T03:30:00.000Z';
    const now = Date.parse('2026-08-26T07:00:00.000Z'); // three and a half hours later
    const row = { state: 'IN' as const, firstInAt, workedMins: 0, breakMins: 20 };
    expect(liveWorkedMins(row, now)).toBe(190);
  });
});

describe('roster week', () => {
  test('snaps to Monday from any day of that week', () => {
    expect(mondayOf('2026-08-26')).toBe('2026-08-24'); // a Wednesday
    expect(mondayOf('2026-08-24')).toBe('2026-08-24');
    expect(mondayOf('2026-08-30')).toBe('2026-08-24'); // the Sunday
  });

  test('seven consecutive days', () => {
    const days = weekDays('2026-08-24');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-24');
    expect(days[6]).toBe('2026-08-30');
  });

  test('shift times render in IST', () => {
    expect(istHhmm('2026-08-26T03:30:00.000Z')).toBe('09:00');
  });
});

describe('task due labels', () => {
  const now = Date.parse('2026-08-26T08:00:00.000Z');
  test('ahead of time', () => {
    expect(dueLabel('2026-08-26T08:40:00.000Z', now)).toBe('due in 40 min');
  });
  test('late is not terminal, it is just late', () => {
    expect(dueLabel('2026-08-26T06:00:00.000Z', now)).toBe('2h 0m late');
  });
  test('no due time', () => {
    expect(dueLabel(null, now)).toBe('No due time');
  });
});
