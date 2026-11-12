import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isRepeatRule } from '@repo/validation';

/**
 * An event's `recurrence_rule`: a legacy token or a structured rule the series
 * generator can step (`packages/validation/src/recurrence.ts` owns the
 * format). Whether the rule fits its first meeting (an `UNTIL` before the
 * second, or too many meetings) needs the start time, so `EventService` checks
 * that after this.
 */
export function IsRepeatRule(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isRepeatRule',
      validator: {
        validate: (value: unknown) => isRepeatRule(value),
        defaultMessage: () =>
          'recurrence_rule must be WEEKLY, BIWEEKLY, MONTHLY, or a repeat rule such as FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=20;TZID=America/New_York',
      },
    },
    validationOptions,
  );
}
