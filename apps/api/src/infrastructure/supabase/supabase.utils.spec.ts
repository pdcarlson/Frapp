import {
  escapeFilterValue,
  escapeLikePattern,
  fetchAllById,
  fetchAllPages,
  fetchCountedPages,
  omitColumns,
  type PagedQueryResult,
} from './supabase.utils';

describe('escapeFilterValue', () => {
  it('quotes the value and escapes backslashes and double quotes', () => {
    expect(escapeFilterValue('plain')).toBe('"plain"');
    expect(escapeFilterValue('a"b')).toBe('"a\\"b"');
    expect(escapeFilterValue('a\\b')).toBe('"a\\\\b"');
  });
});

describe('omitColumns', () => {
  it('drops the named columns and keeps the rest', () => {
    expect(
      omitColumns<{ id: string }>({ id: 'a', user_id: 'u', extra: 1 }, [
        'user_id',
        'extra',
      ]),
    ).toEqual({ id: 'a' });
  });

  it('copies rather than mutating the input row', () => {
    const row = { id: 'a', user_id: 'u' };
    omitColumns(row, ['user_id']);
    expect(row).toEqual({ id: 'a', user_id: 'u' });
  });

  it('ignores a listed column the row does not carry', () => {
    expect(omitColumns({ id: 'a' }, ['user_id'])).toEqual({ id: 'a' });
  });
});

describe('escapeLikePattern', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
    expect(escapeLikePattern('a_c')).toBe('a\\_c');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });
});

/**
 * Records the window each call asked for, and replays the given pages in
 * order. Once the script runs out it keeps answering with an empty page, which
 * is what a real server does past the end of a result set.
 */
function pager<T>(pages: Array<PagedQueryResult<T>>) {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  const page = (from: number, to: number) => {
    ranges.push([from, to]);
    const next = pages[index++] ?? { data: [], error: null };
    return Promise.resolve(next);
  };
  return { page, ranges };
}

const rows = (count: number, tag = 'r') =>
  Array.from({ length: count }, (_, i) => `${tag}-${i}`);

describe('fetchAllPages', () => {
  it('stops on an empty page, not a short one', async () => {
    // The bug #1628 closes. A server capping pages at 40 hands back a short
    // first page; reading that as "no more rows" loses everything after it.
    const { page, ranges } = pager([
      { data: rows(40), error: null },
      { data: rows(40), error: null },
      { data: rows(5), error: null },
      { data: [], error: null },
    ]);

    const result = await fetchAllPages(page, { pageSize: 100 });

    expect(result).toHaveLength(85);
    expect(ranges).toHaveLength(4);
  });

  it('advances by the rows that arrived, never by the rows requested', async () => {
    const { page, ranges } = pager([
      { data: rows(40), error: null },
      { data: rows(10), error: null },
      { data: [], error: null },
    ]);

    await fetchAllPages(page, { pageSize: 100 });

    // Had it advanced by pageSize, the second window would open at 100 and
    // rows 40..99 would never be read.
    expect(ranges).toEqual([
      [0, 99],
      [40, 139],
      [50, 149],
    ]);
  });

  it('reads a full page then confirms the end with one empty request', async () => {
    const { page, ranges } = pager([
      { data: rows(100), error: null },
      { data: [], error: null },
    ]);

    const result = await fetchAllPages(page, { pageSize: 100 });

    expect(result).toHaveLength(100);
    expect(ranges).toEqual([
      [0, 99],
      [100, 199],
    ]);
  });

  it('makes exactly one request when the first page is empty', async () => {
    const { page, ranges } = pager<string>([{ data: [], error: null }]);

    expect(await fetchAllPages(page, { pageSize: 100 })).toEqual([]);
    expect(ranges).toEqual([[0, 99]]);
  });

  it('treats a null data payload as an empty page', async () => {
    const { page, ranges } = pager<string>([{ data: null, error: null }]);

    expect(await fetchAllPages(page, { pageSize: 100 })).toEqual([]);
    expect(ranges).toHaveLength(1);
  });

  it('throws the error rather than returning a partial read', async () => {
    const { page } = pager([
      { data: rows(100), error: null },
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(fetchAllPages(page, { pageSize: 100 })).rejects.toMatchObject({
      name: 'SupabaseQueryError',
      message: 'connection reset',
    });
  });

  it('fails loudly instead of hanging when the backend ignores the window', async () => {
    // A backend that ignores `from` re-serves a full page forever, so the
    // empty-page rule never fires. Two of the four callers run inside a cron:
    // an error they can log beats a tick that never returns.
    const fixed = rows(1000);
    const page = () => Promise.resolve({ data: fixed, error: null });

    await expect(fetchAllPages(page, { pageSize: 1000 })).rejects.toThrow(
      /refusing to page further/,
    );
  });

  describe('with a limit', () => {
    it('never asks for a window past the ceiling', async () => {
      const { page, ranges } = pager([
        { data: rows(100), error: null },
        { data: rows(1), error: null },
        { data: [], error: null },
      ]);

      const result = await fetchAllPages(page, { pageSize: 100, limit: 101 });

      expect(result).toHaveLength(101);
      // Second window is clipped to the ceiling rather than a full page.
      expect(ranges).toEqual([
        [0, 99],
        [100, 100],
      ]);
    });

    it('stops once the ceiling is reached without an extra round-trip', async () => {
      const { page, ranges } = pager([{ data: rows(50), error: null }]);

      const result = await fetchAllPages(page, { pageSize: 100, limit: 50 });

      expect(result).toHaveLength(50);
      expect(ranges).toEqual([[0, 49]]);
    });
  });
});

describe('fetchCountedPages', () => {
  /** Answers like `pager`, with the total on whichever call asked for it. */
  function countedPager<T>(total: number, pages: T[][]) {
    const calls: Array<[number, number, boolean]> = [];
    let index = 0;
    const page = (from: number, to: number, withCount: boolean) => {
      calls.push([from, to, withCount]);
      return Promise.resolve({
        data: pages[index++] ?? [],
        error: null,
        count: withCount ? total : null,
      });
    };
    return { page, calls };
  }

  it('reads a list shorter than a page in one request, with its total', async () => {
    const { page, calls } = countedPager(5, [rows(5)]);

    const result = await fetchCountedPages(page, { pageSize: 1000 });

    expect(result).toEqual({ rows: rows(5), total: 5 });
    expect(calls).toEqual([[0, 999, true]]);
  });

  it('keeps reading past short pages until it holds every counted row', async () => {
    // A server capping pages at 40, below the page asked for.
    const { page, calls } = countedPager(85, [rows(40), rows(40), rows(5)]);

    const result = await fetchCountedPages(page, { pageSize: 100 });

    expect(result.rows).toHaveLength(85);
    expect(result.total).toBe(85);
    expect(calls).toEqual([
      [0, 99, true],
      [40, 139, false],
      [80, 179, false],
    ]);
  });

  it('stops at the limit and still counts every matching row', async () => {
    const { page, calls } = countedPager(300, [rows(25)]);

    const result = await fetchCountedPages(page, { pageSize: 25, limit: 25 });

    expect(result.rows).toHaveLength(25);
    expect(result.total).toBe(300);
    expect(calls).toEqual([[0, 24, true]]);
  });

  it('ends on an empty page when rows vanish between pages', async () => {
    const { page, calls } = countedPager(10, [rows(4), []]);

    const result = await fetchCountedPages(page, { pageSize: 4 });

    expect(result).toEqual({ rows: rows(4), total: 10 });
    expect(calls).toHaveLength(2);
  });

  it('without count, asks for none and ends on an empty page, as fetchAllPages does', async () => {
    const { page, calls } = countedPager(5, [rows(5)]);

    const result = await fetchCountedPages(page, {
      pageSize: 25,
      limit: 25,
      count: false,
    });

    expect(result).toEqual({ rows: rows(5), total: null });
    expect(calls).toEqual([
      [0, 24, false],
      [5, 24, false],
    ]);
  });

  it('throws a failed page rather than returning part of the rows', async () => {
    const page = () =>
      Promise.resolve({
        data: null,
        error: { message: 'boom' },
        count: null,
      });

    await expect(fetchCountedPages(page, { pageSize: 10 })).rejects.toThrow();
  });
});

describe('fetchAllById', () => {
  const byId = (...ids: string[]) => ids.map((id) => ({ id }));

  it('asks for the rows after the last id, until a page comes back empty', async () => {
    const pages: PagedQueryResult<{ id: string }>[] = [
      { data: byId('a', 'b'), error: null },
      // A short page is a server cap, not the end.
      { data: byId('c'), error: null },
      { data: [], error: null },
    ];
    const afters: (string | null)[] = [];
    const result = await fetchAllById(async (after) => {
      afters.push(after);
      return pages.shift()!;
    });

    expect(result.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(afters).toEqual([null, 'b', 'c']);
  });

  it('throws a failed page rather than returning part of the rows', async () => {
    await expect(
      fetchAllById(async () => ({
        data: null,
        error: { message: 'boom' },
      })),
    ).rejects.toMatchObject({ name: 'SupabaseQueryError' });
  });
});
