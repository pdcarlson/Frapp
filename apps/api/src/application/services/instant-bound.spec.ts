import { BadRequestException } from '@nestjs/common';
import { ISO_INSTANT_MESSAGE } from '#domain/constants/iso-instant';
import { instantOrThrow } from './instant-bound';

describe('instantOrThrow', () => {
  it('returns undefined for an omitted bound', () => {
    expect(instantOrThrow('before', undefined)).toBeUndefined();
  });

  it('returns epoch milliseconds for a valid UTC instant', () => {
    expect(instantOrThrow('before', '2026-01-31T23:59:59.999Z')).toBe(
      Date.UTC(2026, 0, 31, 23, 59, 59, 999),
    );
  });

  it('applies the offset rather than reading it as UTC', () => {
    expect(instantOrThrow('start_date', '2026-01-31T12:00:00-05:00')).toBe(
      Date.UTC(2026, 0, 31, 17, 0, 0, 0),
    );
  });

  // The first five rows are what `@IsISO8601()` lets through and a
  // `timestamptz` bound must not — verified against validator.js, not assumed:
  // a bare date, an offset-less time, basic format, an hour-only offset, and a
  // calendar-invalid day that reaches Postgres as `22008`, a 500 on what is a
  // 400. The last two are rejected by both validators and are here to cover the
  // regex itself; do not read the table as an inventory of what gets past a pipe.
  it.each([
    ['a bare date', '2026-01-31'],
    ['an offset-less time', '2026-01-31T12:00:00'],
    ['a basic-format instant', '20260101T120000Z'],
    ['an hour-only offset', '2026-01-31T12:00:00+05'],
    ['a day that does not exist', '2026-02-30T12:00:00Z'],
    ['a non-instant string', 'yesterday'],
    ['an empty string', ''],
  ])('rejects %s with a 400', (_label, value) => {
    expect(() => instantOrThrow('before', value)).toThrow(BadRequestException);
  });

  it('names the offending parameter in the message, verbatim', () => {
    // The label is the wire name, so the three call sites read
    // `before …`, `start_date …`, `end_date …` — not a camelCased field name.
    expect(() => instantOrThrow('end_date', 'nope')).toThrow(
      `end_date ${ISO_INSTANT_MESSAGE}`,
    );
  });
});
