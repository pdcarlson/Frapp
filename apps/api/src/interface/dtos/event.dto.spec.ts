import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { MAX_CHECK_IN_OPENS_MINUTES } from '@repo/validation';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { CreateEventDto, UpdateEventDto } from './event.dto';

/**
 * `check_in_opens_minutes` (#3703) through the real global pipe, built from
 * `VALIDATION_PIPE_OPTIONS` as `bootstrap.ts` registers it. The service specs
 * build their inputs directly, so without this nothing would notice a lost
 * bound, and an out-of-range or null lead would reach the database's check or
 * not-null constraint as a 500 rather than a 400.
 */
describe('Event DTOs — check_in_opens_minutes', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (
    metatype: ArgumentMetadata['metatype'],
    payload: unknown,
  ) => pipe.transform(payload, { type: 'body', metatype });

  const create = {
    name: 'Chapter',
    start_time: '2026-11-07T20:00:00.000Z',
    end_time: '2026-11-07T21:00:00.000Z',
  };

  it.each([
    ['create', CreateEventDto, create],
    ['update', UpdateEventDto, {}],
  ] as const)(
    '%s accepts 0 and the maximum, and omission',
    async (_, dto, base) => {
      for (const value of [0, MAX_CHECK_IN_OPENS_MINUTES]) {
        await expect(
          transform(dto, { ...base, check_in_opens_minutes: value }),
        ).resolves.toEqual(
          expect.objectContaining({ check_in_opens_minutes: value }),
        );
      }
      await expect(transform(dto, base)).resolves.not.toHaveProperty(
        'check_in_opens_minutes',
      );
    },
  );

  it.each([
    ['create', CreateEventDto, create],
    ['update', UpdateEventDto, {}],
  ] as const)(
    '%s refuses null, a fraction, a negative and past the maximum',
    async (_, dto, base) => {
      for (const value of [null, 2.5, -1, MAX_CHECK_IN_OPENS_MINUTES + 1]) {
        await expect(
          transform(dto, { ...base, check_in_opens_minutes: value }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );
});

/**
 * `recurrence_rule` (#4488) through the same pipe: the legacy tokens shipped
 * phone builds send must keep passing, a structured rule passes, and anything
 * the series generator can't step is a 400 before a series edit deletes rows.
 */
describe('Event DTOs — recurrence_rule', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const transform = (
    metatype: ArgumentMetadata['metatype'],
    payload: unknown,
  ) => pipe.transform(payload, { type: 'body', metatype });

  const create = {
    name: 'Chapter',
    start_time: '2026-11-07T20:00:00.000Z',
    end_time: '2026-11-07T21:00:00.000Z',
  };

  it.each([
    ['create', CreateEventDto, create],
    ['update', UpdateEventDto, {}],
  ] as const)(
    '%s accepts the legacy tokens and a structured rule',
    async (_, dto, base) => {
      for (const rule of [
        'WEEKLY',
        'BIWEEKLY',
        'MONTHLY',
        'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=20;TZID=America/New_York',
        'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31;UNTIL=20270601;TZID=UTC',
      ]) {
        await expect(
          transform(dto, { ...base, recurrence_rule: rule }),
        ).resolves.toEqual(expect.objectContaining({ recurrence_rule: rule }));
      }
    },
  );

  it.each([
    ['create', CreateEventDto, create],
    ['update', UpdateEventDto, {}],
  ] as const)('%s refuses junk', async (_, dto, base) => {
    for (const rule of [
      'DAILY',
      'weekly',
      'FREQ=WEEKLY;BYDAY=MO;COUNT=3',
      'FREQ=DAILY;COUNT=3;TZID= America/New_York',
      'x'.repeat(201),
      12,
    ]) {
      await expect(
        transform(dto, { ...base, recurrence_rule: rule }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
