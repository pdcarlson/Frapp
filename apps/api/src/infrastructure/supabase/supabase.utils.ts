import {
  type PostgrestErrorRecord,
  SupabaseQueryError,
} from './supabase-query-error';

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
 *
 * Not `*`: PostgREST reads `*` in a `like`/`ilike` value as `%` before
 * Postgres sees it, and no escape here turns it back into a literal. A value
 * that may hold one still over-matches, so a caller that needs an exact
 * answer re-checks the rows (`SupabaseInviteRepository.findPendingByEmail`).
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Copies a row without the named columns: the one way a repository drops a
 * column from a row before it leaves the data layer (a disclosure boundary,
 * see `stripBookmarkRow`). The row is copied, never mutated in place, and a
 * listed key the row does not carry is a no-op. `T` is the caller's claim about
 * what remains, so name it at the call site when the input is untyped.
 */
export function omitColumns<T>(row: object, columns: readonly string[]): T {
  const rest: Record<string, unknown> = { ...row };
  for (const column of columns) delete rest[column];
  return rest as T;
}

/** The shape every PostgREST query resolves to, narrowed to what paging needs. */
export interface PagedQueryResult<T> {
  data: T[] | null;
  error: PostgrestErrorRecord | null;
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
 * for complete ones. A failed page throws a `SupabaseQueryError`. A caller that
 * wants a different policy expresses it at its own call site
 * (`supabase-scheduled-jobs.repository.ts` catches and returns `[]`;
 * `supabase-chat-notification-preference.repository.ts` degrades one chunk).
 *
 * @param limit Optional ceiling on rows read. Callers that need to distinguish
 * "complete" from "stopped early" pass `limit + 1` and compare the row count
 * themselves; this helper does not infer truncation.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PagedQueryResult<T>>,
  { pageSize, limit }: { pageSize: number; limit?: number },
): Promise<T[]> {
  const { rows } = await fetchCountedPages((from, to) => page(from, to), {
    pageSize,
    limit,
    count: false,
  });
  return rows;
}

/**
 * The one paging loop: {@link fetchAllPages}, and with `count` a read that
 * also learns its total (#5746). Both rules of `fetchAllPages` hold: it
 * advances by what arrived, and without a count only an empty page (or
 * `limit`) ends the read.
 *
 * With `count`, the first page asks PostgREST for the exact count of the
 * matching rows (`withCount`), so the loop stops once it holds them all, or
 * `limit` of them, however short the server's cap makes each page, with no
 * empty page after. A page that comes back empty still ends the read. When
 * to count:
 *
 * - **The caller wants the total**, which then costs no request of its own.
 * - **An uncapped read**, to save its terminating empty page.
 * - **Not** a capped read whose total is thrown away: it already stops once
 *   `limit` rows arrived, and the count is a second pass over every matching
 *   row on the database.
 *
 * The trade-off: the read stops at a count taken with the first page, so on a
 * read of several pages, a row inserted before the window between two pages
 * shifts it and the last row is dropped, where `fetchAllPages` would read
 * one row twice. Count only a read that tolerates that, as a list a member
 * reloads does.
 *
 * `total` is how many rows matched when the first page was read, before
 * `limit`; null when the read was not counted (or the backend sent no count,
 * which none here does).
 */
export async function fetchCountedPages<T>(
  page: (
    from: number,
    to: number,
    withCount: boolean,
  ) => PromiseLike<PagedQueryResult<T> & { count?: number | null }>,
  {
    pageSize,
    limit,
    count = true,
  }: { pageSize: number; limit?: number; count?: boolean },
): Promise<{ rows: T[]; total: number | null }> {
  const rows: T[] = [];
  let total: number | null = null;
  const ceiling = () =>
    Math.min(
      limit ?? Number.POSITIVE_INFINITY,
      total ?? Number.POSITIVE_INFINITY,
    );

  for (let from = 0; from < ceiling();) {
    // Terminating only on an empty page means a backend that ignored the
    // window would hand back a full page forever, so the loop is bounded too —
    // the same guard, for the same reason, as `listEntries` in
    // `infrastructure/storage/supabase-storage.service.ts`. Most callers pass
    // no `limit`, and the scheduled sweeps among them run inside a cron;
    // failing loudly at an absurd row count beats hanging a tick.
    if (rows.length > MAX_PAGED_ROWS) {
      throw new Error(
        `Paged read exceeded ${MAX_PAGED_ROWS} rows; refusing to page further`,
      );
    }
    const withCount = count && from === 0;
    const to = Math.min(from + pageSize, limit ?? Number.POSITIVE_INFINITY) - 1;
    const result = await page(from, to, withCount);
    // Wrapped like every other query failure (#1264). The wrapper keeps `code`
    // and `hint`, which is what a caller branching on the failure reads, and
    // drops `details`, the row values.
    if (result.error) throw new SupabaseQueryError(result.error);
    if (withCount && typeof result.count === 'number') total = result.count;

    const batch = result.data ?? [];
    rows.push(...batch);
    if (batch.length === 0) break;
    from += batch.length;
  }

  return { rows, total };
}

/**
 * Read a query's full result set by its `id`, one page at a time: each page is
 * the rows after the last id read (`id > last`, ordered by id, see `page`'s
 * `after`), until a page comes back empty. Prefer it to `fetchAllPages` for a
 * table that can change while it is read: an offset shifts when a row is added
 * or deleted before it, so the next page repeats a row or skips one, where a
 * row after the last id is read once or not at all. A row added during the
 * read may or may not be in the result; no row that was there throughout is
 * missed or read twice. The caller sorts the result if it wants another order.
 *
 * `page` must filter `id > after` when `after` is set, order by `id`
 * ascending, and limit the page. The same two rules as `fetchAllPages` hold:
 * only an empty page ends the read, since a server cap below the asked-for
 * size makes every page short.
 */
export async function fetchAllById<T extends { id: string }>(
  page: (after: string | null) => PromiseLike<PagedQueryResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    if (rows.length > MAX_PAGED_ROWS) {
      throw new Error(
        `Paged read exceeded ${MAX_PAGED_ROWS} rows; refusing to page further`,
      );
    }
    const { data, error } = await page(after);
    if (error) throw new SupabaseQueryError(error);
    const batch = data ?? [];
    if (batch.length === 0) return rows;
    rows.push(...batch);
    after = batch[batch.length - 1].id;
  }
}
