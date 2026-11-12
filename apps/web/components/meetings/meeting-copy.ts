/**
 * The minutes screens' shared words and date labels live in
 * `@repo/validation` (`meeting-copy.ts`), so mobile says the same things.
 * This module keeps the names web's components already import, and the one
 * thing that is web's own: where the minutes' page is.
 */
export {
  guessMeetingType,
  meetingDayLabel,
  meetingDueLabel,
  meetingSectionLabel as sectionLabel,
  meetingTitleLine,
  meetingVoteLine as voteLine,
  meetingWhenLabel,
} from "@repo/validation";

/** The minutes' own page. */
export function meetingHref(id: string): string {
  return `/meetings/${id}`;
}
