/**
 * Item search runs on the client over the cached active item master. A round
 * trip per keystroke on 3G in a basement kitchen does not work, and the person
 * typing has wet hands and spells it "chiken".
 */

function bigrams(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) out.push(value.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams. 1 is identical, 0 is nothing shared. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return 0;
  const pool = [...right];
  let hits = 0;
  for (const gram of left) {
    const at = pool.indexOf(gram);
    if (at >= 0) {
      pool.splice(at, 1);
      hits += 1;
    }
  }
  return (2 * hits) / (left.length + right.length);
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();

/**
 * Score one haystack against the query. A substring hit always outranks a fuzzy
 * hit, so typing "mince" never buries Chicken Mince under a near-miss.
 */
export function score(query: string, haystack: string): number {
  const q = norm(query);
  const h = norm(haystack);
  if (q === '') return 0;
  if (h.startsWith(q)) return 3;
  if (h.includes(q)) return 2;
  const words = h.split(' ').filter(Boolean);
  let best = similarity(q, h);
  for (const word of words) best = Math.max(best, similarity(q, word));
  return best;
}

const FUZZY_FLOOR = 0.34;

/** Ranked matches. `text` pulls the searchable string out of each row. */
export function rank<T>(rows: readonly T[], query: string, text: (row: T) => string, limit = 25): T[] {
  if (query.trim() === '') return rows.slice(0, limit);
  const scored: { row: T; s: number }[] = [];
  for (const row of rows) {
    const s = score(query, text(row));
    if (s >= FUZZY_FLOOR) scored.push({ row, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.row);
}
