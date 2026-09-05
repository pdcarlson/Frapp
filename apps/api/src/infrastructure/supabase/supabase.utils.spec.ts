import {
  escapeFilterValue,
  escapeLikePattern,
  fetchAllPages,
  type PagedQueryResult,
} from './supabase.utils';

describe('escapeFilterValue', () => {
  it('quotes the value and escapes backslashes and double quotes', () => {
    expect(escapeFilterValue('plain')).toBe('"plain"');
    expect(escapeFilterValue('a"b')).toBe('"a\\"b"');
    expect(escapeFilterValue('a\\b')).toBe('"a\\\\b"');
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

    await expect(fetchAllPages(page, { pageSize: 100 })).rejects.toEqual({
      message: 'connection reset',
    });
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
