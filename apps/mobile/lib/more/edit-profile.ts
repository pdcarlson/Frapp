import type { components } from "@repo/api-sdk";
import {
  birthdayDraftProblem,
  type BirthdayDraftProblem,
  GRADUATION_YEAR_MESSAGE,
  isPhoneNumber,
  parseBirthdayVisibility,
  MAJOR_MAX_LENGTH,
  parseGraduationYear,
  PHONE_INVALID_MESSAGE,
} from "@repo/validation";
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
  phone: string;
  major: string;
  graduationYear: string;
  bio: string;
  city: string;
  company: string;
  /** The birthday (#4959), typed as digits: month, day, optional year. */
  birthdayMonth: string;
  birthdayDay: string;
  birthdayYear: string;
  /** `chapter` or `nobody`, set by the sheet's segmented control. */
  birthdayVisibility: string;
};

/**
 * The `PATCH /v1/users/me` body, the generated `UpdateUserDto`, so a renamed
 * field fails to compile here rather than going quietly unsent.
 */
export type ProfilePatch = components["schemas"]["UpdateUserDto"];

export type ProfileDraftField = keyof ProfileDraft;

export type ProfilePatchResult =
  | { ok: true; patch: ProfilePatch }
  | { ok: false; field: ProfileDraftField; message: string };

export const NAME_REQUIRED_MESSAGE = "Your name can't be empty.";
// The year refusal is `@repo/validation`'s, shared with an officer's correction.
export { GRADUATION_YEAR_MESSAGE };
const MAJOR_TOO_LONG_MESSAGE = `Keep your major under ${MAJOR_MAX_LENGTH} characters.`;

/** What the sheet opens on: the profile as it stands, blanks for unset. */
export function draftFromProfile(profile: ViewerProfile | null): ProfileDraft {
  return {
    displayName: profile?.displayName ?? "",
    phone: profile?.phone ?? "",
    major: profile?.major ?? "",
    bio: profile?.bio ?? "",
    graduationYear:
      profile?.graduationYear === null || profile?.graduationYear === undefined
        ? ""
        : String(profile.graduationYear),
    city: profile?.currentCity ?? "",
    company: profile?.currentCompany ?? "",
    birthdayMonth: digits(profile?.birthdayMonth),
    birthdayDay: digits(profile?.birthdayDay),
    birthdayYear: digits(profile?.birthdayYear),
    birthdayVisibility: profile?.birthdayVisibility ?? "nobody",
  };
}

/** The draft field each part of a birthday refusal lands on. */
const BIRTHDAY_DRAFT_FIELD: Record<
  BirthdayDraftProblem["field"],
  ProfileDraftField
> = {
  month: "birthdayMonth",
  day: "birthdayDay",
  year: "birthdayYear",
};

function digits(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A typed whole number, `null` for blank, and `NaN` for anything else, which
 * `birthdayDraftProblem` refuses on that field.
 */
function typedNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
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
 * - The phone (#3711) may be cleared (`null`); anything else must read as a
 *   phone number (`isPhoneNumber`), the rule the API applies.
 * - Major, bio, city and company may be cleared; an empty string reads back as "Not
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

  const phone = draft.phone.trim();
  if (phone !== original.phone.trim()) {
    if (phone.length > 0 && !isPhoneNumber(phone)) {
      return { ok: false, field: "phone", message: PHONE_INVALID_MESSAGE };
    }
    patch.phone = phone.length > 0 ? phone : null;
  }

  if (draft.graduationYear.trim() !== original.graduationYear.trim()) {
    const year = parseGraduationYear(draft.graduationYear);
    if (year === undefined) {
      return {
        ok: false,
        field: "graduationYear",
        message: GRADUATION_YEAR_MESSAGE,
      };
    }
    patch.graduation_year = year;
  }

  const major = draft.major.trim();
  if (major !== original.major.trim()) {
    // The field stops at the cap (`maxLength`); this covers a paste that
    // somehow lands past it, which the API would refuse with a 400.
    if (major.length > MAJOR_MAX_LENGTH) {
      return { ok: false, field: "major", message: MAJOR_TOO_LONG_MESSAGE };
    }
    patch.major = major;
  }

  // The birthday (#4959): month and day together, or both blank to clear
  // it (and its year). Sent whole whenever any part changed, so the API checks
  // the day against the month and year as one.
  const birthdayChanged = (
    ["birthdayMonth", "birthdayDay", "birthdayYear"] as const
  ).some((key) => draft[key].trim() !== original[key].trim());
  if (birthdayChanged) {
    // Non-digit text is a part that isn't a number: NaN fails its check.
    const month = typedNumber(draft.birthdayMonth);
    const day = typedNumber(draft.birthdayDay);
    const year = typedNumber(draft.birthdayYear);
    const problem = birthdayDraftProblem(month, day, year);
    if (problem) {
      // On the part that is wrong, so it shows when the member leaves it.
      return {
        ok: false,
        field: BIRTHDAY_DRAFT_FIELD[problem.field],
        message: problem.message,
      };
    }
    const cleared = month === null && day === null && year === null;
    patch.birthday_month = cleared ? null : month;
    patch.birthday_day = cleared ? null : day;
    patch.birthday_year = cleared ? null : year;
  }
  if (draft.birthdayVisibility !== original.birthdayVisibility) {
    patch.birthday_visibility = parseBirthdayVisibility(
      draft.birthdayVisibility,
    );
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
 * The fields a member has typed into, as typed. The sheet shows them over the
 * live profile (`{ ...original, ...edits }`), so every field the member left
 * alone shows the profile as it stands.
 */
export type ProfileEdits = Partial<ProfileDraft>;

/**
 * `edits` with `field` typed to `value`. A field typed to the profile's value
 * leaves `edits`, so it follows the profile again.
 */
export function applyEdit(
  edits: ProfileEdits | null,
  original: ProfileDraft,
  field: ProfileDraftField,
  value: string,
): ProfileEdits {
  const next: ProfileEdits = { ...edits };
  if (value === original[field]) delete next[field];
  else next[field] = value;
  return next;
}

/**
 * `edits` carried over a profile that moved from `previous` to `next` (a
 * refetch of `/v1/users/me`, such as a return to the app once the cached
 * profile is five minutes stale): a field whose profile value moved stays
 * typed only while it changes `previous`, the value it was typed against, so
 * one that held no change follows `next`.
 *
 * "No change" is `profilePatch`'s: trimmed. So a stray trailing space doesn't
 * pin the old value for a later save to write back over the newer one. The
 * web form's `seededFrom` merge
 * (`apps/web/components/profile/profile-panel.tsx`) is the same rule, except
 * that it compares untrimmed (#3392).
 */
export function rebaseEdits(
  edits: ProfileEdits | null,
  previous: ProfileDraft,
  next: ProfileDraft,
): ProfileEdits | null {
  if (edits === null) return null;
  const kept: ProfileEdits = {};
  for (const [field, value] of Object.entries(edits) as [
    ProfileDraftField,
    string,
  ][]) {
    // A field whose own profile value didn't move keeps what was typed, spaces
    // and all: only a moved field re-bases, or a trailing space the member is
    // about to type past would vanish under their cursor.
    const moved = previous[field] !== next[field];
    const changes = value.trim() !== previous[field].trim();
    if ((changes || !moved) && value !== next[field]) {
      kept[field] = value;
    }
  }
  return kept;
}

/** Whether two drafts hold the same values, field by field. */
export function sameDraft(a: ProfileDraft, b: ProfileDraft): boolean {
  return (Object.keys(a) as ProfileDraftField[]).every(
    (field) => a[field] === b[field],
  );
}
