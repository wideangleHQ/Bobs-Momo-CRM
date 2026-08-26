// Money stays a string end to end. The payment split has to be added exactly,
// so it is added in paise as a bigint. Chapter 29, decimals on the client.

export function toPaise(value: string): bigint | null {
  const match = /^\s*(-?)(\d+)(?:\.(\d{0,2}))?\s*$/.exec(value);
  if (!match) return null;
  const [, sign = '', whole = '0', frac = ''] = match;
  return BigInt(`${sign}${whole}${frac.padEnd(2, '0')}`);
}

export function fromPaise(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, '0');
  const cut = digits.length - 2;
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/** null when any input is not a two decimal money string. */
export function sumPaise(values: string[]): bigint | null {
  let total = 0n;
  for (const value of values) {
    const parsed = toPaise(value === '' ? '0' : value);
    if (parsed === null) return null;
    total += parsed;
  }
  return total;
}

/** One rupee, matching SALES_SPLIT_TOLERANCE_PAISE. The server is the authority. */
export const SPLIT_TOLERANCE_PAISE = 100n;

export function absPaise(value: bigint): bigint {
  return value < 0n ? -value : value;
}
