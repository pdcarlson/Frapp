import { BadRequestException } from '@nestjs/common';
import {
  ISO_INSTANT_MESSAGE,
  parseIsoInstant,
} from '#domain/constants/iso-instant';

/**
 * Epoch milliseconds for a caller-supplied bound, or `undefined` when the
 * caller omitted it. A value that is present but not a valid instant is a
 * 400 — never a silent drop.
 *
 * Silently dropping is what the `before` cursor used to do, and it is the
 * wrong answer for any of these: a dropped bound WIDENS the result set, so
 * the caller gets rows outside the window they asked for, behind a `200`,
 * with no way to tell. A dropped cursor re-serves the page they already had.
 * The DTO rejects these shapes first; this is the guard for a direct call.
 *
 * Lives in `application/` rather than beside `parseIsoInstant`: the parse rule
 * is domain code and returns `null`, and turning that into an HTTP status is
 * the boundary's job — `domain/` must not import the NestJS framework. This is
 * the one place that translation is written, so every list route that takes an
 * instant bound rejects the same shapes with the same message.
 *
 * The returned epoch is for COMPARING bounds only. The value handed to the
 * repository is always the caller's original string: re-serializing it would
 * truncate a `timestamptz`'s microseconds to milliseconds and drop
 * same-millisecond rows off a `created_at` cursor (#1832).
 *
 * @param label the wire name of the parameter, used verbatim in the 400 message
 */
export function instantOrThrow(
  label: string,
  value?: string,
): number | undefined {
  if (value === undefined) return undefined;
  const epoch = parseIsoInstant(value);
  if (epoch === null) {
    throw new BadRequestException(`${label} ${ISO_INSTANT_MESSAGE}`);
  }
  return epoch;
}
