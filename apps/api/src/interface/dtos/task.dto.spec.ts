import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import {
  CreateTaskDto,
  DeleteTaskQueryDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from './task.dto';

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

/**
 * A repeating task's `recurrence_rule` and `scope` (#5119) through the real
 * global pipe, as `bootstrap.ts` registers it. The service specs build their
 * inputs directly, so without this nothing would notice the DTO falling back
 * to the event rule, which refuses a rule with no end: the headline case.
 */
describe('Task DTOs — repeating tasks (#5119)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (
    metatype: ArgumentMetadata['metatype'],
    payload: unknown,
    type: ArgumentMetadata['type'] = 'body',
  ) => pipe.transform(payload, { type, metatype });

  const create = {
    title: 'Kitchen duty',
    assignee_id: '0a000000-0000-4000-8000-000000000001',
    due_date: '2026-11-16',
  };

  it.each([
    ['create', CreateTaskDto, create],
    ['update', UpdateTaskDto, { scope: 'series' }],
  ] as const)(
    '%s accepts a rule with no end, COUNT or UNTIL',
    async (_, dto, base) => {
      for (const rule of [
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York',
        'FREQ=DAILY;INTERVAL=2;COUNT=10;TZID=UTC',
        'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;UNTIL=20270601;TZID=UTC',
      ]) {
        await expect(
          transform(dto, { ...base, recurrence_rule: rule }),
        ).resolves.toEqual(expect.objectContaining({ recurrence_rule: rule }));
      }
    },
  );

  it.each([
    ['create', CreateTaskDto, create],
    ['update', UpdateTaskDto, { scope: 'series' }],
  ] as const)('%s refuses legacy tokens and junk', async (_, dto, base) => {
    for (const rule of [
      'WEEKLY',
      'FREQ=WEEKLY;BYDAY=MO',
      'FREQ=DAILY;COUNT=3;UNTIL=20270101;TZID=UTC',
      'x'.repeat(201),
      12,
    ]) {
      await expect(
        transform(dto, { ...base, recurrence_rule: rule }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('takes only the two scopes, on an edit and a delete', async () => {
    await expect(
      transform(UpdateTaskDto, { scope: 'series' }),
    ).resolves.toEqual(expect.objectContaining({ scope: 'series' }));
    await expect(
      transform(DeleteTaskQueryDto, { scope: 'instance' }, 'query'),
    ).resolves.toEqual(expect.objectContaining({ scope: 'instance' }));
    await expect(transform(UpdateTaskDto, { scope: 'all' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      transform(DeleteTaskQueryDto, { scope: 'following' }, 'query'),
    ).rejects.toThrow(BadRequestException);
  });
});

/** `POST /v1/tasks` for everyone (#4295 step 3): one person or a group. */
describe('CreateTaskDto audience', () => {
  const ASSIGNEE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const invalid = async (payload: Record<string, unknown>) =>
    (
      await validate(
        plainToInstance(CreateTaskDto, {
          title: 'Fill out the form',
          due_date: '2026-11-20',
          ...payload,
        }),
      )
    ).map((e) => e.property);

  it('takes a person, or everyone in place of one', async () => {
    expect(await invalid({ assignee_id: ASSIGNEE })).toEqual([]);
    expect(await invalid({ audience: 'everyone' })).toEqual([]);
  });

  it('needs an assignee when no audience is sent', async () => {
    expect(await invalid({})).toEqual(['assignee_id']);
  });

  it('refuses an audience it does not know', async () => {
    expect(await invalid({ audience: 'actives' })).toEqual(['audience']);
  });

  it("takes the group scope on an edit and a delete", async () => {
    expect(
      (await validate(plainToInstance(UpdateTaskDto, { scope: 'group' }))).length,
    ).toBe(0);
    expect(
      (await validate(plainToInstance(DeleteTaskQueryDto, { scope: 'group' })))
        .length,
    ).toBe(0);
  });
});
