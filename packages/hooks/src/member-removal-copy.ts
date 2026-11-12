/**
 * Remove from chapter's words, on the member profile's `⋯` on web and mobile
 * s13 (2026-11-11), held once so the two surfaces can't describe one removal
 * two ways. `spec/ui/design-system/writing.md` § Members (dashboard) owns them.
 */

/** The `⋯` menu row, and the confirmation's destructive button. */
export const REMOVE_FROM_CHAPTER_LABEL = "Remove from chapter";

/** The `⋯` button's accessible name. */
export function memberMenuButtonLabel(name: string): string {
  return `More for ${name}`;
}

export function removeConfirmTitle(name: string): string {
  return `Remove ${name} from the chapter?`;
}

export const REMOVE_CONFIRM_BODY =
  "They lose chat, events and the member list right away, and can come back only with a new invite.";

export function removeFailedTitle(name: string): string {
  return `Couldn't remove ${name}`;
}
