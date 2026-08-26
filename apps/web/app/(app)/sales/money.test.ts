import { expect, test } from 'bun:test';
import { absPaise, fromPaise, SPLIT_TOLERANCE_PAISE, sumPaise, toPaise } from './money';

test('money strings convert to paise without float drift', () => {
  expect(toPaise('62480.00')).toBe(6248000n);
  expect(toPaise('0.1')).toBe(10n);
  expect(toPaise('99999999.99')).toBe(9999999999n);
  expect(toPaise('12.345')).toBeNull();
  expect(toPaise('twelve')).toBeNull();
});

test('paise render back as two decimal strings', () => {
  expect(fromPaise(6125000n)).toBe('61250.00');
  expect(fromPaise(5n)).toBe('0.05');
  expect(fromPaise(0n)).toBe('0.00');
});

test('the payment split adds exactly, unlike a float sum', () => {
  // 0.1 + 0.2 in JavaScript floats is 0.30000000000000004.
  expect(fromPaise(sumPaise(['0.10', '0.20']) ?? 0n)).toBe('0.30');
  expect(sumPaise(['18400.00', '39850.00', '3000.00', '0.00'])).toBe(6125000n);
  expect(sumPaise(['1.00', 'oops'])).toBeNull();
});

test('drift inside one rupee passes, drift beyond it does not', () => {
  const net = toPaise('61250.00') ?? 0n;
  const inside = sumPaise(['18400.00', '39850.00', '3000.00', '0.25']) ?? 0n;
  const outside = sumPaise(['18400.00', '39850.00', '3000.00', '1.50']) ?? 0n;
  expect(absPaise(inside - net) <= SPLIT_TOLERANCE_PAISE).toBe(true);
  expect(absPaise(outside - net) <= SPLIT_TOLERANCE_PAISE).toBe(false);
  // The message the operator reads is the exact difference.
  expect(fromPaise(absPaise(outside - net))).toBe('1.50');
});
