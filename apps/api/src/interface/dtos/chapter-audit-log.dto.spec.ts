import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListChapterAuditLogQueryDto } from './chapter-audit-log.dto';

// `dto-constraint-coverage.spec.ts` proves the hostile values are REJECTED.
// This is the other half, and it is the half a validator swap would break
// silently: a DTO that rejects everything passes every negative test.
// `@IsUUID()` with no version argument, in particular, would be easy to
// mis-set to a version the app never mints.
describe('ListChapterAuditLogQueryDto', () => {
  const valid = async (payload: Record<string, unknown>) =>
    (await validate(plainToInstance(ListChapterAuditLogQueryDto, payload))).map(
      (e) => e.property,
    );

  it('accepts every filter at once, with real values', async () => {
    expect(
      await valid({
        actor_user_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        action: 'member_removed',
        start_date: '2026-01-01T00:00:00.000Z',
        end_date: '2026-02-01T00:00:00.000Z',
        before: '2026-03-01T00:00:00.000Z',
        limit: 25,
      }),
    ).toEqual([]);
  });

  it('accepts an empty query — every filter is optional', async () => {
    expect(await valid({})).toEqual([]);
  });

  // The window carries `timestamptz` values, so it must accept the precision
  // and the offset spellings Postgres emits — not just the `…Z` millisecond
  // form. `chapter-audit-log.service.ts` passes these through byte-for-byte;
  // a validator that rejected them would make that passthrough unreachable.
  it.each([
    [
      'microsecond precision with a numeric offset',
      '2026-01-01T00:00:00.123456+00:00',
    ],
    ['millisecond precision, Zulu', '2026-01-01T00:00:00.000Z'],
    ['whole seconds, Zulu', '2026-01-01T00:00:00Z'],
    ['a non-UTC offset', '2026-01-01T00:00:00-05:00'],
    ['no seconds', '2026-01-01T00:00Z'],
  ])('accepts %s as a window bound', async (_why, timestamp) => {
    expect(
      await valid({
        start_date: timestamp,
        end_date: timestamp,
        before: timestamp,
      }),
    ).toEqual([]);
  });

  // The contract is narrower than "ISO 8601", and every one of these is why.
  // Each is a value a looser validator accepts and the query layer then
  // mishandles — silently, in every case but the last.
  it.each([
    ['a bare date, which would mean midnight on a timestamptz', '2026-01-31'],
    [
      'a time with no offset, which JS and Postgres resolve differently',
      '2026-01-31T12:00:00',
    ],
    [
      'an hour-only offset, legal ISO 8601 but Invalid Date in JS',
      '2026-01-31T12:00:00+05',
    ],
    ['an ordinal date', '2026-045T12:00:00Z'],
    ['a week date', '2026-W05-3T12:00:00Z'],
    ['basic format', '20260131T120000Z'],
  ])('rejects %s on every timestamp param', async (_why, timestamp) => {
    expect(await valid({ start_date: timestamp })).toContain('start_date');
    expect(await valid({ end_date: timestamp })).toContain('end_date');
    expect(await valid({ before: timestamp })).toContain('before');
  });

  it('accepts the longest action verb the writers actually emit', async () => {
    // `chapter_custom_field_created` is 28 chars; the cap is 64. If a future
    // verb outgrows the cap this fails here rather than as an unfilterable
    // row in production.
    expect(await valid({ action: 'chapter_custom_field_created' })).toEqual([]);
  });

  it.each([
    ['a non-uuid actor', { actor_user_id: 'not-a-uuid' }, 'actor_user_id'],
    ['an over-long action', { action: 'x'.repeat(65) }, 'action'],
    ['a non-ISO8601 lower bound', { start_date: '01/01/2026' }, 'start_date'],
    ['a non-ISO8601 upper bound', { end_date: 'yesterday' }, 'end_date'],
    ['a malformed cursor', { before: 'not-a-date' }, 'before'],
  ])('rejects %s', async (_why, payload, property) => {
    expect(await valid(payload)).toContain(property);
  });
});
