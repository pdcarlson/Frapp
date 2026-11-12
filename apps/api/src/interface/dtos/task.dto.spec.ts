import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTasksQueryDto } from './task.dto';

/**
 * `GET /v1/tasks` (#4037). The cursor's two halves gate each other through
 * `@ValidateIf`, so the cases that matter most are the ones every client
 * sends: nothing at all (shipped mobile builds) and a first page (`limit`
 * alone). A gate set wrong would refuse those with a 400.
 */
describe('ListTasksQueryDto', () => {
  const CURSOR_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const invalid = async (payload: Record<string, unknown>) =>
    (await validate(plainToInstance(ListTasksQueryDto, payload))).map(
      (e) => e.property,
    );

  it('accepts no parameters, what shipped mobile builds send', async () => {
    expect(await invalid({})).toEqual([]);
  });

  it('accepts a first page: a limit alone', async () => {
    expect(await invalid({ limit: '200' })).toEqual([]);
  });

  it('accepts a later page, with the cursor as Postgres spells created_at', async () => {
    expect(
      await invalid({
        limit: '200',
        before: '2026-01-01T00:00:00.123456+00:00',
        before_id: CURSOR_ID,
      }),
    ).toEqual([]);
  });

  it('refuses half a cursor, either half', async () => {
    expect(await invalid({ before: '2026-01-01T00:00:00Z' })).toEqual([
      'before_id',
    ]);
    expect(await invalid({ before_id: CURSOR_ID })).toEqual(['before']);
  });

  it.each([
    ['a limit past 200', { limit: '201' }, 'limit'],
    ['a zero limit', { limit: '0' }, 'limit'],
    [
      'a date without a time',
      { before: '2026-01-01', before_id: CURSOR_ID },
      'before',
    ],
    [
      'a cursor id that is not a uuid',
      { before: '2026-01-01T00:00:00Z', before_id: 'task-9' },
      'before_id',
    ],
  ])('refuses %s', async (_name, payload, property) => {
    expect(await invalid(payload)).toEqual([property]);
  });
});
