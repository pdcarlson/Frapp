import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { MAX_CHECK_IN_OPENS_MINUTES } from '@repo/validation';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { CreateEventDto, UpdateEventDto } from './event.dto';
import {
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_NOTES_MAX_LENGTH,
  EVENT_ROLE_IDS_MAX,
} from '#domain/constants/field-limits';

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

/**
 * The free-text fields and role lists (`spec/behavior/events.md` § Event
 * Creation, length limits). A repeating event copies its description and notes
 * onto every meeting, so each is bounded at the request.
 */
describe('Event DTOs — text lengths and role lists', () => {
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
  const roleId = '7d0f5a52-4c1f-4a4e-9a51-0e6a3c1f2b11';
  const roleFields = [
    'required_role_ids',
    'optional_role_ids',
    'excluded_role_ids',
  ] as const;

  const cases = [
    ['create', CreateEventDto, create],
    ['update', UpdateEventDto, {}],
  ] as const;

  it.each(cases)(
    '%s takes each text field at its limit',
    async (_, dto, base) => {
      const body = {
        ...base,
        description: 'd'.repeat(EVENT_DESCRIPTION_MAX_LENGTH),
        location: 'l'.repeat(EVENT_LOCATION_MAX_LENGTH),
        notes: 'n'.repeat(EVENT_NOTES_MAX_LENGTH),
      };
      await expect(transform(dto, body)).resolves.toEqual(
        expect.objectContaining({
          description: body.description,
          location: body.location,
          notes: body.notes,
        }),
      );
    },
  );

  it.each(cases)(
    '%s refuses each text field one past its limit, saying the limit',
    async (_, dto, base) => {
      for (const [field, max] of [
        ['description', EVENT_DESCRIPTION_MAX_LENGTH],
        ['location', EVENT_LOCATION_MAX_LENGTH],
        ['notes', EVENT_NOTES_MAX_LENGTH],
      ] as const) {
        const error: unknown = await transform(dto, {
          ...base,
          [field]: 'x'.repeat(max + 1),
        }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect(
          JSON.stringify((error as BadRequestException).getResponse()),
        ).toContain(`Keep the ${field} to`);
      }
    },
  );

  it.each(cases)('%s takes role ids up to the cap', async (_, dto, base) => {
    const ids = Array.from({ length: EVENT_ROLE_IDS_MAX }, () => roleId);
    for (const field of roleFields) {
      await expect(transform(dto, { ...base, [field]: ids })).resolves.toEqual(
        expect.objectContaining({ [field]: ids }),
      );
    }
  });

  it.each(cases)(
    '%s refuses a role id that is not an id, and a list past the cap',
    async (_, dto, base) => {
      const tooMany = Array.from(
        { length: EVENT_ROLE_IDS_MAX + 1 },
        () => roleId,
      );
      for (const field of roleFields) {
        await expect(
          transform(dto, { ...base, [field]: ['officers'] }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          transform(dto, { ...base, [field]: tooMany }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );
});
