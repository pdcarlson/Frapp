export function escapeFilterValue(value: string): string {
  // PostgREST string quoting: surround with double quotes and escape internal
  // backslashes and double quotes.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Escapes a user-supplied string for use inside a `like`/`ilike` pattern.
 *
 * `%` and `_` are wildcards to Postgres, so an unescaped search for `50%`
 * matches every row and `a_c` matches `abc`. Backslash is Postgres's default
 * LIKE escape character, so it has to be escaped first or it would escape the
 * wrong thing.
 *
 * This is orthogonal to {@link escapeFilterValue}, which handles PostgREST's
 * own quoting for `.or()` filter strings — a value can need both.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** The shape every PostgREST query resolves to, narrowed to what paging needs. */
export interface PagedQueryResult<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Runaway guard for {@link fetchAllPages}. Far above any legitimate read here —
 * the largest is a Discord import manifest — so crossing it means the backend
 * is not honouring the window, not that a chapter got big.
 */
const MAX_PAGED_ROWS = 1_000_000;

/**
 * Read a query's full result set, one `pageSize` page at a time.
 *
 * `page` must apply a **total** order. Offset paging over a non-unique sort key
 * has no guaranteed order between statements, so rows sharing a sort value
 * across a page boundary can come back twice or vanish entirely — a `.range()`
 * loop over an unstable order defeats the point of paging at all.
 *
 * Two rules make this correct against a server cap the caller cannot read, and
 * both are load-bearing:
 *
 * 1. **Only an empty page proves the rows ran out.** Treating a *short* page as
 *    the end silently truncates the moment the server's `max_rows` sits below
 *    `pageSize` — the caller asks for `pageSize`, is handed the cap, and reads
 *    that as "no more rows". The cost of the guarantee is one extra, empty
 *    round-trip once the rows run out.
 * 2. **Advance by what arrived, never by what was asked for.** If the server
 *    capped the page, the un-returned tail of the requested window has not been
 *    read yet, and stepping over it drops those rows outright with no error.
 *
 * `pageSize` is therefore a request size, not an assumption about the server's
 * cap: a project whose "Max rows" is lower still reads correctly, it just takes
 * more trips. That matters because `supabase/config.toml` governs the *local*
 * stack only — the hosted project's cap is a dashboard setting no code here can
 * see.
 *
 * Errors are **thrown**, never swallowed, so partial reads cannot be mistaken
 * for complete ones. A caller that wants a different policy expresses it at its
 * own call site (`scheduled-jobs.repository.ts` catches and returns `[]`;
 * `report.service.ts` translates the error inside its own `page` callback).
 *
 * @param limit Optional ceiling on rows read. Callers that need to distinguish
 * "complete" from "stopped early" pass `limit + 1` and compare the row count
 * themselves; this helper does not infer truncation.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
  { pageSize, limit }: { pageSize: number; limit?: number },
): Promise<T[]> {
  const ceiling = limit ?? Number.POSITIVE_INFINITY;
  const rows: T[] = [];

  for (let from = 0; from < ceiling;) {
    // Terminating only on an empty page means a backend that ignored the
    // window would hand back a full page forever, so the loop is bounded too —
    // the same guard, for the same reason, as `listEntries` in
    // `infrastructure/storage/supabase-storage.service.ts`. Three of the four
    // callers pass no `limit`, and two of them run inside a cron; failing
    // loudly at an absurd row count beats hanging a tick.
    if (rows.length > MAX_PAGED_ROWS) {
      throw new Error(
        `Paged read exceeded ${MAX_PAGED_ROWS} rows; refusing to page further`,
      );
    }
    const to = Math.min(from + pageSize, ceiling) - 1;
    const { data, error } = await page(from, to);
    // Rethrown verbatim, not wrapped: a PostgREST error is a plain object
    // carrying `code`/`details`/`hint`, and callers depend on those fields —
    // `supabase-discord-import.repository.ts` parses the quota violation out of
    // one. Wrapping it in an Error would satisfy the lint rule by destroying
    // the information the callers actually read.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (error) throw error;

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length === 0) break;
    from += batch.length;
  }

  return rows;
}
