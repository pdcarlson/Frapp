import {
  localDateIn,
  parseLocalDate,
  parseLocalTime,
  zonedTimeToUtc,
} from './zoned-time';

describe('zoned-time', () => {
  it('reads only a real calendar date', () => {
    expect(parseLocalDate('2026-12-05')).toEqual({
      year: 2026,
      month: 12,
      day: 5,
    });
    expect(parseLocalDate('2026-02-30')).toBeNull();
    expect(parseLocalDate('December 5')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
  });

  it('reads only a 24-hour time', () => {
    expect(parseLocalTime('7:05')).toEqual({ hour: 7, minute: 5 });
    expect(parseLocalTime('19:00')).toEqual({ hour: 19, minute: 0 });
    expect(parseLocalTime('24:00')).toBeNull();
    expect(parseLocalTime('7pm')).toBeNull();
  });

  it('finds the instant a wall clock reads a time, on either side of a clock change', () => {
    // Eastern: standard time in November, daylight time in July.
    expect(
      zonedTimeToUtc('2026-11-17', '19:00', 'America/New_York')?.toISOString(),
    ).toBe('2026-11-18T00:00:00.000Z');
    expect(
      zonedTimeToUtc('2026-07-17', '19:00', 'America/New_York')?.toISOString(),
    ).toBe('2026-07-17T23:00:00.000Z');
    // The morning after clocks go back (November 1, 2026).
    expect(
      zonedTimeToUtc('2026-11-01', '09:00', 'America/New_York')?.toISOString(),
    ).toBe('2026-11-01T14:00:00.000Z');
    expect(zonedTimeToUtc('2026-11-17', '19:00', 'UTC')?.toISOString()).toBe(
      '2026-11-17T19:00:00.000Z',
    );
    expect(zonedTimeToUtc('soon', '19:00', 'UTC')).toBeNull();
  });

  it("names the day a zone's calendar shows", () => {
    const lateEvening = new Date('2026-11-13T03:30:00.000Z');
    expect(localDateIn(lateEvening, 'America/New_York')).toBe('2026-11-12');
    expect(localDateIn(lateEvening, 'UTC')).toBe('2026-11-13');
  });
});
