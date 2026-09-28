/**
 * How many IDs one `in (...)` filter may carry.
 *
 * Bounded by measurement, not arithmetic: against the local Supabase stack,
 * 200 UUIDs (~7.5 KB of URL) succeeded and 250 (~9.3 KB) returned `414 URI Too
 * Long`. Those two probes bracket the true limit somewhere in 201–249 — they
 * do not establish 200 as the maximum — and how much of the request line is
 * left over depends on the `select`, `order`, and column filters sharing it.
 * 100 sits at well under half the smaller probe, which is the point.
 *
 * This limit is why the report roster's member lookup is chunked at all: it
 * passed every member ID in a single `in (...)`, so a large chapter failed the
 * whole report with a 414 — observed there before the chunking was added.
 */
export const ID_CHUNK_SIZE = 100;

/**
 * Split IDs into batches small enough that the resulting `in` list cannot
 * overflow a query string. Paging raised how many IDs a lookup can carry, and
 * a URL is the one part of this that fails without an error worth reading.
 *
 * Lives in `domain/utils` rather than beside one consumer because it is the
 * layer both `application/` and `infrastructure/` may import: the report
 * aggregates need it in a service, and the narrow user-display lookup needs it
 * inside a repository.
 */
export function chunkIds(ids: string[], size = ID_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/**
 * How many characters of encoded values one `in (...)` filter may carry: about
 * what `ID_CHUNK_SIZE` UUIDs cost, which the measurement above found safe.
 */
export const IN_FILTER_CHAR_BUDGET = 3_700;

/**
 * Split values of uneven length (storage paths, which end in a Discord
 * filename) into batches whose encoded `in` list stays within `budget`.
 *
 * A count cannot bound these: a path is 100 to several hundred characters once
 * encoded, so a fixed count that is safe for short paths overflows for long
 * ones. Staging's first real bot import failed on exactly this: one slice
 * marked a busy channel's attachments uploaded in a single `in` list, a 30 KB
 * request line the gateway refused with a 400 (#2825). A value longer than the
 * budget on its own still gets a batch of its own rather than being dropped.
 */
export function chunkByEncodedLength(
  values: string[],
  budget = IN_FILTER_CHAR_BUDGET,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const value of values) {
    // postgrest-js quotes a value holding a reserved character, and a comma
    // separates each one: three more characters, at most.
    const cost = encodeURIComponent(value).length + 3;
    if (current.length > 0 && used + cost > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(value);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
