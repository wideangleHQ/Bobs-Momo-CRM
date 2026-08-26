// bun test packages/shared
import { expect, test } from 'bun:test';
import { toBusinessDate } from './business-date';

// IST is UTC+5:30. 03:59 IST on 17 Aug is 22:29 UTC on 16 Aug.
test('03:59 IST belongs to the previous trading day', () => {
  expect(toBusinessDate(new Date('2026-08-16T22:29:00.000Z'))).toBe('2026-08-16');
});

test('04:01 IST starts the new trading day', () => {
  expect(toBusinessDate(new Date('2026-08-16T22:31:00.000Z'))).toBe('2026-08-17');
});

test('midday IST is its own trading day', () => {
  expect(toBusinessDate(new Date('2026-08-17T06:30:00.000Z'))).toBe('2026-08-17');
});

test('a closing checklist at 00:30 IST sits on the day it closed', () => {
  expect(toBusinessDate(new Date('2026-08-16T19:00:00.000Z'))).toBe('2026-08-16');
});
