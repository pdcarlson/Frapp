import { BadRequestException } from '@nestjs/common';

/** How far ahead a reminder may be set: a chat message's or a minutes date's. */
export const REMINDER_MAX_AHEAD_DAYS = 365;
/**
 * How far in the past a new time may be and still count as "now": a client's
 * clock running a little fast, or a preset picked as the minute turns, sets a
 * reminder the next sweep sends rather than an error.
 */
const REMINDER_PAST_GRACE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The one window every personal reminder's time must fall in (#4957, #5672):
 * a real time, from now to {@link REMINDER_MAX_AHEAD_DAYS} days ahead.
 */
export function assertReminderWindow(remindAt: Date, now: Date): void {
  const at = remindAt.getTime();
  if (Number.isNaN(at)) {
    throw new BadRequestException('remind_at must be a date and time');
  }
  if (at < now.getTime() - REMINDER_PAST_GRACE_MS) {
    throw new BadRequestException('remind_at must not be in the past');
  }
  if (at > now.getTime() + REMINDER_MAX_AHEAD_DAYS * DAY_MS) {
    throw new BadRequestException(
      `remind_at must be within ${REMINDER_MAX_AHEAD_DAYS} days`,
    );
  }
}
