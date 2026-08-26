import { expect, test } from 'bun:test';
import { addMoney, changePct, fromMinor, multiplyMoney, toMinor } from './decimal';
import { rank, score } from '../inventory/search';

test('money multiply rounds half up where a float would not', () => {
  // The chapter 29 case: (152.5 * 18.83).toFixed(2) gives "2871.57".
  expect(multiplyMoney('152.500', '18.83')).toBe('2871.58');
  expect(multiplyMoney('12.000', '24.50')).toBe('294.00');
  expect(multiplyMoney('0.000', '99.99')).toBe('0.00');
});

test('money addition does not drift', () => {
  expect(addMoney('294.00', '248.00')).toBe('542.00');
  expect(addMoney('0.10', '0.20')).toBe('0.30');
});

test('minor unit round trip', () => {
  expect(toMinor('152.500', 3)).toBe(152500n);
  expect(fromMinor(152500n, 3)).toBe('152.500');
  expect(fromMinor(-5n, 2)).toBe('-0.05');
});

test('percent change is null without a prior price', () => {
  expect(changePct('240.00', '310.00')).toBe('29.2');
  expect(changePct('0.00', '310.00')).toBeNull();
});

test('item search tolerates the misspellings a wet hand produces', () => {
  const items = [
    { name: 'Chicken Mince' },
    { name: 'Refined Flour' },
    { name: 'Cabbage' },
    { name: 'Chicken Sausage' },
  ];
  const pick = (q: string) => rank(items, q, (i) => i.name).map((i) => i.name);
  expect(pick('chiken')[0]).toBe('Chicken Mince');
  expect(pick('mince')[0]).toBe('Chicken Mince');
  expect(pick('cabage')[0]).toBe('Cabbage');
  expect(pick('zzzz')).toHaveLength(0);
  // A substring hit must outrank a fuzzy one.
  expect(score('chicken', 'Chicken Mince')).toBeGreaterThan(score('chiken', 'Chicken Mince'));
});
