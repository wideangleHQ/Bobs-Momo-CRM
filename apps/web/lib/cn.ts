/** Joins class names and drops falsy ones. No clsx dependency for this. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
