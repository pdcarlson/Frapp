/**
 * A list of ids in a query string: one comma-separated value, or the key
 * repeated, both arrive as one list. Lowercased, because Postgres answers with
 * lowercase ids and services match them back by string, and de-duplicated, so
 * 50 copies of one id don't do 50 times the work. A part that isn't a string
 * passes through for `@IsUUID` to refuse.
 *
 * Used with `@Transform(({ value }) => splitIdList(value))` on a query DTO
 * field (backwork download URLs, chat attachments).
 */
export function splitIdList(value: unknown): unknown[] {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  const ids = parts
    .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
    .map((part) =>
      typeof part === 'string' ? part.trim().toLowerCase() : part,
    )
    .filter((part) => part !== '');
  return [...new Set(ids)];
}
