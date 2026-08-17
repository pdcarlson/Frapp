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
