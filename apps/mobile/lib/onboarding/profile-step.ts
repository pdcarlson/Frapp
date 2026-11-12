/**
 * s03's "How the chapter sees you" beat: who sees it, and what it asks.
 *
 * Every message a member sends carries their name and photo, so a new member
 * with no photo, or with no real name, looks like a stranger in every channel
 * they post in. In production on 2026-11-07, 33 of 34 accounts had no photo,
 * and one Apple sign-up that hid its email was stored as `Member`, the API's
 * fallback when it has no name at all (`displayNameForSync`).
 *
 * The beat shows when either is missing. The photo stays optional, since
 * plenty of people won't have one to hand; the name is required only when
 * there isn't a real one yet, and a real one comes pre-filled.
 */

/** The API's stand-in when sign-in carried no name (`auth.service.ts`). */
const PLACEHOLDER_DISPLAY_NAME = "Member";

export const PROFILE_STEP_TITLE = "How the chapter sees you";
export const PROFILE_STEP_SUBTITLE =
  "Your photo and name go on every message you send.";
export const PROFILE_NAME_REQUIRED =
  "Add your name so the chapter knows who's talking.";
export const PROFILE_NAME_SAVE_FAILED =
  "Couldn't save your name. Check your connection and try again.";

/** No name at all, or only the API's stand-in for one. */
export function needsName(displayName: string | null | undefined): boolean {
  const trimmed = (displayName ?? "").trim();
  return trimmed.length === 0 || trimmed === PLACEHOLDER_DISPLAY_NAME;
}

/**
 * Whether s03 offers the beat. `false` until the profile has loaded: a slow
 * read never holds a member on the welcome screen, it only skips the beat
 * (Profile in More still has both).
 */
export function shouldOfferProfileStep(
  profile: { displayName: string | null; photoUrl: string | null } | null,
): boolean {
  if (!profile) return false;
  return needsName(profile.displayName) || !profile.photoUrl;
}

/** The field's first value: the real name, or empty in place of the stand-in. */
export function initialNameField(displayName: string | null): string {
  return needsName(displayName) ? "" : (displayName ?? "").trim();
}

/**
 * The profile beat's one client event (`spec/behavior/observability.md`
 * § Member Onboarding Funnel), sent once when the member moves on from it.
 * Shape only: whether a photo and a name came out of the beat, never the name.
 */
export const ONBOARDING_PROFILE_ANSWERED_EVENT = "onboarding-profile-answered";

/**
 * - `photo`: `had` (one before the beat), `added` (chosen on it), `none`.
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
