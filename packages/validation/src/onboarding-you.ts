/**
 * The "You" screen: the first of the two screens a member sees after joining
 * (#5627, epic #5624; Paul's pick 2026-11-19, "Two: name, then
 * notifications"). The same screen on web and the phone (s03): the name,
 * pre-filled when sign-in carried a real one, and an optional photo.
 *
 * Every message a member sends carries their name and photo, so a member
 * with no real name looks like a stranger in every channel. "No real name"
 * is the API's `Member` stand-in, or the part of the email before the `@`,
 * which is what an email sign-up is stored as (`displayNameForSync` in the
 * API's `auth.service.ts`): `pdcarlson06` is not a name, so the field starts
 * empty instead.
 */

/** The API's stand-in when sign-in carried no name at all. */
const PLACEHOLDER_DISPLAY_NAME = "Member";

export const ONBOARDING_YOU_COPY = {
  title: "How the chapter sees you",
  lede: "Your photo and name go on every message you send.",
  nameLabel: "Your name",
  namePlaceholder: "First and last name",
  nameRequired: "Add your name so the chapter knows who's talking.",
  saveFailed: "Couldn't save your name. Check your connection and try again.",
  /** When the notifications screen follows (phone only). */
  continue: "Continue",
  /** When chat is next. */
  goToChat: "Go to chat",
} as const;

/**
 * No real name: none at all, the API's `Member`, or the email's local part
 * the API stored for an email sign-up.
 */
export function needsName(
  displayName: string | null | undefined,
  email?: string | null,
): boolean {
  const trimmed = (displayName ?? "").trim();
  if (trimmed.length === 0 || trimmed === PLACEHOLDER_DISPLAY_NAME) return true;
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  return local.length > 0 && trimmed.toLowerCase() === local.toLowerCase();
}

/** The name field's first value: the real name, or empty. */
export function initialNameField(
  displayName: string | null | undefined,
  email?: string | null,
): string {
  return needsName(displayName, email) ? "" : (displayName ?? "").trim();
}

/**
 * The screen's one client event (`spec/behavior/observability.md`
 * § Member Onboarding Funnel), sent once when the member moves on from it.
 * Shape only: whether a photo and a name came out of it, never the name.
 */
export const ONBOARDING_PROFILE_ANSWERED_EVENT = "onboarding-profile-answered";

/**
 * - `photo`: `had` (one before the screen), `added` (chosen on it), `none`.
 * - `name_step`: `added` (there was no real name), `edited` (a real one was
 *   changed), `kept`.
 */
export function onboardingProfileAnsweredProperties(input: {
  hadPhoto: boolean;
  hasPhoto: boolean;
  hadName: boolean;
  nameChanged: boolean;
}): {
  photo: "had" | "added" | "none";
  name_step: "added" | "edited" | "kept";
} {
  return {
    photo: input.hadPhoto ? "had" : input.hasPhoto ? "added" : "none",
    name_step: !input.hadName ? "added" : input.nameChanged ? "edited" : "kept",
  };
}
