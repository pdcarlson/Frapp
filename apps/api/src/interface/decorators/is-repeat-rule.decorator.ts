import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isRepeatRule, isTaskRepeatRule } from '@repo/validation';

/**
 * An event's `recurrence_rule`: a legacy token or a structured rule the series
 * generator can step (`packages/validation/src/recurrence.ts` owns the
 * format). Whether the rule fits its first meeting (an `UNTIL` before the
 * second, or too many meetings) needs the start time, so `EventService` checks
 * that after this.
 */
export function IsRepeatRule(
  validationOptions?: ValidationOptions & {
    /**
     * A repeating task's rule (#5119): structured only, and it may have no
     * end (neither `COUNT` nor `UNTIL`), since a task series makes one copy
     * at a time.
     */
    task?: boolean;
  },
): PropertyDecorator {
  const { task, ...options } = validationOptions ?? {};
  return ValidateBy(
    {
      name: 'isRepeatRule',
      validator: {
        validate: (value: unknown) =>
          task ? isTaskRepeatRule(value) : isRepeatRule(value),
        defaultMessage: () =>
          task
            ? 'recurrence_rule must be a repeat rule such as FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York, with COUNT, UNTIL or no end'
            : 'recurrence_rule must be WEEKLY, BIWEEKLY, MONTHLY, or a repeat rule such as FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=20;TZID=America/New_York',
      },
    },
    options,
  );
}
