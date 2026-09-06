import { ISO_INSTANT_REGEX, parseIsoInstant } from './iso-instant';

// This helper exists because `new Date(string)` is the wrong parser for a
// `timestamptz` filter in three separate ways, so the cases below are the
// specification rather than incidental coverage. Each rejection names the
// concrete mishandling it prevents.
describe('parseIsoInstant', () => {
  it('agrees with Date on the forms both handle correctly', () => {
    for (const value of [
      '2026-01-31T12:00:00Z',
      '2026-01-31T12:00:00.000Z',
      '2026-01-31T12:00:00-05:00',
      '2026-06-30T23:59:59.999+09:00',
    ]) {
      expect(parseIsoInstant(value)).toBe(new Date(value).getTime());
    }
  });

  it('resolves offsets rather than ignoring them', () => {
    const utc = parseIsoInstant('2026-01-31T12:00:00Z');
    expect(parseIsoInstant('2026-01-31T07:00:00-05:00')).toBe(utc);
    expect(parseIsoInstant('2026-01-31T21:00:00+09:00')).toBe(utc);
    // The equal-instant case the inverted-window guard depends on.
    expect(parseIsoInstant('2026-01-31T12:00:00+00:00')).toBe(utc);
  });

  it('reads sub-millisecond precision left-aligned', () => {
    // `.5` is 500ms, not 5ms. Callers still hand Postgres the original string,
    // so the microseconds themselves are never lost — only the comparison
    // works at millisecond resolution.
    expect(parseIsoInstant('2026-01-31T00:00:00.5Z')).toBe(
      Date.UTC(2026, 0, 31, 0, 0, 0, 500),
    );
    expect(parseIsoInstant('2026-01-31T00:00:00.123456Z')).toBe(
      Date.UTC(2026, 0, 31, 0, 0, 0, 123),
    );
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(parseIsoInstant('2028-02-29T00:00:00Z')).not.toBeNull();
    // `new Date('2026-02-29T00:00:00Z')` rolls forward to March 1 instead of
    // failing, which is how an impossible day used to reach Postgres and raise
    // 22008 — a 500 on what is a client error.
    expect(new Date('2026-02-29T00:00:00Z').getTime()).not.toBeNaN();
    expect(parseIsoInstant('2026-02-29T00:00:00Z')).toBeNull();
  });

  // Rejected by SHAPE, so the regex catches them too — which matters because
  // the regex is what the DTO enforces and what `openapi.json` advertises as
  // the parameter's `pattern`. These are the cases a client can see coming.
  it.each([
    ['a bare date — would mean midnight on a timestamptz', '2026-01-31'],
    [
      'no offset — JS and Postgres resolve it in different zones',
      '2026-01-31T12:00:00',
    ],
    [
      'an hour-only offset — legal ISO 8601, Invalid Date in JS',
      '2026-01-31T12:00:00+05',
    ],
    ['an ordinal date', '2026-045T12:00:00Z'],
    ['a week date', '2026-W05-3T12:00:00Z'],
    ['basic format', '20260131T120000Z'],
    ['gibberish', 'not-a-date'],
    ['empty', ''],
  ])('rejects %s, by shape', (_why, value) => {
    expect(parseIsoInstant(value)).toBeNull();
    expect(ISO_INSTANT_REGEX.test(value)).toBe(false);
  });

  // Rejected by VALUE. A regex can match two digits but cannot say they are
  // under 24, so the parser is the authority and the regex is a coarse gate in
  // front of it. The split is deliberate — it keeps the pattern in the
  // contract readable — and it costs nothing, because the service calls the
  // parser, never the regex, so every one of these still ends as a 400.
  it.each([
    ['an out-of-range hour', '2026-01-31T24:00:00Z'],
    ['an out-of-range minute', '2026-01-31T12:60:00Z'],
    ['an out-of-range second', '2026-01-31T12:00:60Z'],
    ['an absurd offset', '2026-01-31T12:00:00+20:00'],
    ['a day that does not exist', '2026-02-30T00:00:00Z'],
    ['a month that does not exist', '2026-13-01T00:00:00Z'],
  ])('rejects %s, by value — the regex alone would admit it', (_why, value) => {
    expect(ISO_INSTANT_REGEX.test(value)).toBe(true);
    expect(parseIsoInstant(value)).toBeNull();
  });

  it('does not depend on the process time zone', () => {
    const original = process.env.TZ;
    try {
      const utc = parseIsoInstant('2026-01-31T12:00:00Z');
      for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        expect(parseIsoInstant('2026-01-31T12:00:00Z')).toBe(utc);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
