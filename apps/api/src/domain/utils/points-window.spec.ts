import { resolveWindowSince, resolveArchiveRange } from './points-window';

describe('resolveWindowSince', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('returns null for the all-time window (no filter)', () => {
    expect(resolveWindowSince('all', { now })).toBeNull();
    // archive is irrelevant for all-time
    expect(
      resolveWindowSince('all', { now, latestArchiveEndDate: '2026-05-15' }),
    ).toBeNull();
  });

  describe('month', () => {
    it('returns now minus one calendar month', () => {
      const since = resolveWindowSince('month', { now });
      expect(since?.toISOString()).toBe('2026-05-15T12:00:00.000Z');
    });

    it('mirrors Date.setMonth rollover at month-end (matches the leaderboard)', () => {
      // 2026 is not a leap year: Feb has 28 days, so setMonth(-1) on Mar 31
      // overflows to Mar 3 — the exact behavior points.service.filterByWindow uses.
      const since = resolveWindowSince('month', {
        now: new Date('2026-03-31T00:00:00.000Z'),
      });
      const expected = new Date('2026-03-31T00:00:00.000Z');
      expected.setMonth(expected.getMonth() - 1);
      expect(since?.toISOString()).toBe(expected.toISOString());
    });
  });

  describe('semester', () => {
    it('returns the end of the archive end_date day (exclusive lower bound)', () => {
      const since = resolveWindowSince('semester', {
        now,
        latestArchiveEndDate: '2026-05-15',
      });
      expect(since?.toISOString()).toBe('2026-05-15T23:59:59.999Z');
    });

    it('tolerates a full ISO timestamp for end_date', () => {
      const since = resolveWindowSince('semester', {
        now,
        latestArchiveEndDate: '2026-05-15T08:30:00.000Z',
      });
      expect(since?.toISOString()).toBe('2026-05-15T23:59:59.999Z');
    });

    it('falls back to all-time (null) when there is no archive', () => {
      expect(resolveWindowSince('semester', { now })).toBeNull();
      expect(
        resolveWindowSince('semester', { now, latestArchiveEndDate: null }),
      ).toBeNull();
    });

    it('falls back to all-time (null) when end_date is unparseable', () => {
      expect(
        resolveWindowSince('semester', {
          now,
          latestArchiveEndDate: 'not-a-date',
        }),
      ).toBeNull();
    });
  });
});

describe('resolveArchiveRange', () => {
  it('spans the full calendar days [start_date, end_date], since exclusive and until inclusive', () => {
    const range = resolveArchiveRange({
      start_date: '2026-01-15',
      end_date: '2026-05-15',
    });
    expect(range?.since.toISOString()).toBe('2026-01-14T23:59:59.999Z');
    expect(range?.until.toISOString()).toBe('2026-05-15T23:59:59.999Z');
  });

  it('includes a transaction on start_date and one on end_date', () => {
    const range = resolveArchiveRange({
      start_date: '2026-01-15',
      end_date: '2026-05-15',
    })!;
    const onStart = new Date('2026-01-15T00:00:00.001Z');
    const onEnd = new Date('2026-05-15T23:59:59.998Z');
    expect(onStart > range.since && onStart <= range.until).toBe(true);
    expect(onEnd > range.since && onEnd <= range.until).toBe(true);
  });

  it('excludes a transaction the day before start_date or the day after end_date', () => {
    const range = resolveArchiveRange({
      start_date: '2026-01-15',
      end_date: '2026-05-15',
    })!;
    const beforeStart = new Date('2026-01-14T23:59:59.999Z');
    const afterEnd = new Date('2026-05-16T00:00:00.000Z');
    expect(beforeStart > range.since && beforeStart <= range.until).toBe(false);
    expect(afterEnd > range.since && afterEnd <= range.until).toBe(false);
  });

  it('tolerates a full ISO timestamp for either date', () => {
    const range = resolveArchiveRange({
      start_date: '2026-01-15T08:30:00.000Z',
      end_date: '2026-05-15T08:30:00.000Z',
    });
    expect(range?.since.toISOString()).toBe('2026-01-14T23:59:59.999Z');
    expect(range?.until.toISOString()).toBe('2026-05-15T23:59:59.999Z');
  });

  it('returns null for unparseable dates', () => {
    expect(
      resolveArchiveRange({ start_date: 'not-a-date', end_date: '2026-05-15' }),
    ).toBeNull();
    expect(
      resolveArchiveRange({ start_date: '2026-01-15', end_date: 'nope' }),
    ).toBeNull();
  });
});
