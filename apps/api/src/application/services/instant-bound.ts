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
 *
 * **How much of a backstop this is depends on the route.** The chapter-audit-log
 * and chat DTOs pin their bounds with `@Matches(ISO_INSTANT_REGEX)`
 * (`chapter-audit-log.dto.ts`, `chat.dto.ts`), so there this is the guard for a
 * direct, non-HTTP call. `points.dto.ts`'s `before` carries the looser
 * `@IsISO8601()`, which accepts all five shapes this function exists to reject:
 * a bare date, an offset-less time, basic format, an hour-only offset, and the
 * calendar-invalid `2026-02-30`. On those five this is the FIRST rejector, not
 * a second one — do not delete a call here on the reasoning that the pipe
 * already ran. (The pipe is still first for a non-date and for an out-of-range
 * component — month 13, day 32, hour 25, an offset past ±23:59 — which
 * validator.js bounds by regex. The two reject-sets overlap; neither contains
 * the other.) #2168 proposes closing the five-shape gap at the DTO.
 *
 * Lives in `application/` rather than beside `parseIsoInstant`: the parse rule
 * is domain code and returns `null`, and turning that into an HTTP status is
 * the boundary's job — `domain/` must not import the NestJS framework.
 *
 * Scope: this is the one translation of the **instant** rule — an ISO 8601
 * date-time with an explicit UTC offset. It is not the only date bound the API
 * takes: `ServiceEntryService.assertValidDateRange` translates a bare
 * `YYYY-MM-DD` range with its own message, because those columns are dates and
 * a time on them is wrong. Do not fold the two together.
 *
 * The returned epoch is for COMPARING bounds only — see `parseIsoInstant` for
 * why the value handed to the repository is always the caller's original
 * string.
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
