import type { ViewerProfile } from "@/lib/more/profile";

/**
 * s15's Edit sheet (#3387): the draft a member types into, and the
 * `PATCH /v1/users/me` body it becomes. Pure, so the rules are tested here and
 * the sheet only wires them up.
 *
 * Every field is a string while it is being typed, the graduation year
 * included: a half-typed "20" is a draft, not a number.
 */
export type ProfileDraft = {
  displayName: string;
  bio: string;
  graduationYear: string;
  city: string;
  company: string;
};

/** The fields `UpdateUserDto` accepts, as `useUpdateUser` takes them. */
export type ProfilePatch = {
  display_name?: string;
  bio?: string;
  graduation_year?: number | null;
  current_city?: string;
  current_company?: string;
};

export type ProfileDraftField = keyof ProfileDraft;

export type ProfilePatchResult =
  | { ok: true; patch: ProfilePatch }
  | { ok: false; field: ProfileDraftField; message: string };

/** `UpdateUserDto`'s `@Min(1900)` / `@Max(2100)` on `graduation_year`. */
export const GRADUATION_YEAR_MIN = 1900;
export const GRADUATION_YEAR_MAX = 2100;

export const NAME_REQUIRED_MESSAGE = "Your name can't be empty.";
export const GRADUATION_YEAR_MESSAGE = `Graduation year is a year between ${GRADUATION_YEAR_MIN} and ${GRADUATION_YEAR_MAX}, like 2027.`;

/** What the sheet opens on: the profile as it stands, blanks for unset. */
export function draftFromProfile(profile: ViewerProfile | null): ProfileDraft {
  return {
    displayName: profile?.displayName ?? "",
    bio: profile?.bio ?? "",
    graduationYear:
      profile?.graduationYear === null || profile?.graduationYear === undefined
        ? ""
        : String(profile.graduationYear),
    city: profile?.currentCity ?? "",
    company: profile?.currentCompany ?? "",
  };
}

/**
 * The body to send, holding only the fields the member changed, or the first
 * field that can't be sent and why.
 *
 * Only changes are sent so a save from the phone can't write back a value
 * another device changed after this sheet opened. Values are trimmed, and a
 * field compares as unchanged when only its surrounding spaces differ.
 *
 * - The name can't be cleared. The column is `NOT NULL DEFAULT ''` and the API
 *   takes an empty string, but every surface that names a member (the
 *   directory, chat, the roster) would fall back to an id-shaped label.
 * - A blank graduation year clears it (`null`); anything else must be a whole
 *   year the API will take, so the refusal comes before a round trip that
 *   would only end in a 400.
 * - Bio, city and company may be cleared; an empty string reads back as "Not
 *   set" (`lib/more/narrow.ts` `str`).
 */
export function profilePatch(
  original: ProfileDraft,
  draft: ProfileDraft,
): ProfilePatchResult {
  const patch: ProfilePatch = {};

  const name = draft.displayName.trim();
  if (name.length === 0) {
    return { ok: false, field: "displayName", message: NAME_REQUIRED_MESSAGE };
  }
  if (name !== original.displayName.trim()) patch.display_name = name;

  const year = draft.graduationYear.trim();
  if (year !== original.graduationYear.trim()) {
    if (year.length === 0) {
      patch.graduation_year = null;
    } else {
      const parsed = /^\d{4}$/.test(year) ? Number(year) : NaN;
      if (
        !Number.isInteger(parsed) ||
        parsed < GRADUATION_YEAR_MIN ||
        parsed > GRADUATION_YEAR_MAX
      ) {
        return {
          ok: false,
          field: "graduationYear",
          message: GRADUATION_YEAR_MESSAGE,
        };
      }
      patch.graduation_year = parsed;
    }
  }

  const bio = draft.bio.trim();
  if (bio !== original.bio.trim()) patch.bio = bio;
  const city = draft.city.trim();
  if (city !== original.city.trim()) patch.current_city = city;
  const company = draft.company.trim();
  if (company !== original.company.trim()) patch.current_company = company;

  return { ok: true, patch };
}

/** Whether a patch would change anything, which is what enables Save. */
export function hasChanges(patch: ProfilePatch): boolean {
  return Object.keys(patch).length > 0;
}

/**
 * The fields a member has typed into, each with the profile value it was
 * typed over (`base`). The sheet shows these over the live profile, so a
 * refetch mid-edit (a return to the app refetches `/v1/users/me`) moves every
 * field the member left alone.
 */
export type ProfileEdits = Partial<
  Record<ProfileDraftField, { value: string; base: string }>
>;

/**
 * `edits` with `field` typed to `value` over `original`. A field typed back to
 * the value it was typed over leaves `edits`, so it follows the profile again.
 */
export function applyEdit(
  edits: ProfileEdits | null,
  original: ProfileDraft,
  field: ProfileDraftField,
  value: string,
): ProfileEdits {
  const next: ProfileEdits = { ...edits };
  const base = next[field]?.base ?? original[field];
  if (value === base) delete next[field];
  else next[field] = { value, base };
  return next;
}

/**
 * What the fields show: the profile, with each typed field over it.
 *
 * A typed field that differs from its `base` only in surrounding spaces is no
 * change (`profilePatch` trims), so once the profile moves under it, it shows
 * the profile instead. Without that, a stray trailing space would pin the old
 * value and a later save would write it back over the newer one.
 */
export function shownDraft(
  original: ProfileDraft,
  edits: ProfileEdits | null,
): ProfileDraft {
  const shown = { ...original };
  for (const [field, edit] of Object.entries(edits ?? {}) as [
    ProfileDraftField,
    { value: string; base: string },
  ][]) {
    const changed = edit.value.trim() !== edit.base.trim();
    if (changed || original[field] === edit.base) shown[field] = edit.value;
  }
  return shown;
}
