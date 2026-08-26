/**
 * The purchase manager checks the running total against the handwritten bill
 * before tapping Save. `(152.5 * 18.83).toFixed(2)` is "2871.57" and Postgres
 * numeric(14,2) stores "2871.58". One paisa off on eight lines and the screen
 * stops matching the paper. Chapter 29.
 *
 * ponytail: chapter 29 puts this at apps/web/lib/decimal, which is agent 7's
 * path and is not in the foundation contract. Move it there when it lands.
 */

/** Decimal string to scaled integer. toMinor("152.500", 3) is 152500n. */
export function toMinor(value: string, scale: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) throw new Error(`not a decimal: ${value}`);
  const sign = m[1] ?? '';
  const whole = m[2] ?? '0';
  const frac = m[3] ?? '';
  if (frac.length > scale) throw new Error(`too many decimals: ${value}`);
  return BigInt(sign + whole + frac.padEnd(scale, '0'));
}

export function fromMinor(value: bigint, scale: number): string {
  const neg = value < 0n;
  const digits = (neg ? -value : value).toString().padStart(scale + 1, '0');
  const cut = digits.length - scale;
  const out = scale === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  return (neg ? '-' : '') + out;
}

function roundHalfUp(value: bigint, dropDigits: number): bigint {
  const p = 10n ** BigInt(dropDigits);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const q = abs / p;
  const rounded = (abs % p) * 2n >= p ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** quantity (3dp) times unit price (2dp) to a line total (2dp), half up. */
export function multiplyMoney(quantity: string, rate: string): string {
  return fromMinor(roundHalfUp(toMinor(quantity, 3) * toMinor(rate, 2), 3), 2);
}

export const addMoney = (...values: string[]): string =>
  fromMinor(
    values.reduce((sum, v) => sum + toMinor(v, 2), 0n),
    2,
  );

/** Returns "0.00" instead of throwing, for a half-typed field. */
export function safeMultiplyMoney(quantity: string, rate: string): string {
  try {
    return multiplyMoney(quantity || '0', rate || '0');
  } catch {
    return '0.00';
  }
}

export function safeAddMoney(values: string[]): string {
  try {
    return addMoney(...values);
  } catch {
    return '0.00';
  }
}

/** Percent change from `before` to `after`, one decimal. Null when before is 0. */
export function changePct(before: string, after: string): string | null {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || !Number.isFinite(a) || b === 0) return null;
  return (((a - b) / b) * 100).toFixed(1);
}

export const addQty = (...values: string[]): string =>
  fromMinor(
    values.reduce((sum, v) => sum + toMinor(v, 3), 0n),
    3,
  );

/** Returns null instead of throwing, for a half-typed quantity field. */
export function safeAddQty(values: string[]): string | null {
  try {
    return addQty(...values);
  } catch {
    return null;
  }
}

export function cmpQty(a: string, b: string): number {
  const left = toMinor(a, 3);
  const right = toMinor(b, 3);
  return left === right ? 0 : left < right ? -1 : 1;
}
