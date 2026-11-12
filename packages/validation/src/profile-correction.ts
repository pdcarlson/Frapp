import { GRADUATION_YEAR_MAX, GRADUATION_YEAR_MIN } from "./field-limits";

/**
 * An officer's fix to another member's name or graduation year (#4367,
 * `PATCH /v1/members/{id}/profile`): the draft web's dialog and mobile's sheet
 * both type into, and the body it becomes. One copy, so the two refuse the
 * same things in the same words.
 */
export type ProfileCorrectionDraft = { name: string; graduationYear: string };

export type ProfileCorrectionPatch = {
  display_name?: string;
  graduation_year?: number | null;
};

export type ProfileCorrectionResult =
  | { ok: true; patch: ProfileCorrectionPatch }
  | {
      ok: false;
      field: keyof ProfileCorrectionDraft;
      message: string;
    };

/** The profile `⋯` row that opens the editor, on web and mobile alike. */
export const CORRECTION_MENU_LABEL = "Edit name and graduation year";

export const CORRECTION_NAME_REQUIRED_MESSAGE = "Enter their name.";
/** The refusal for a graduation year the API won't take, on every form that sets one. */
export const GRADUATION_YEAR_MESSAGE = `Use a year between ${GRADUATION_YEAR_MIN} and ${GRADUATION_YEAR_MAX}, like 2027.`;

/**
 * A typed graduation year as the API takes it: `null` for blank (it clears
 * the year), the year for four digits in `GRADUATION_YEAR_MIN`–`MAX`, and
 * `undefined` for anything it would refuse. The member's own edit and an
 * officer's correction both read it, so they refuse the same input.
 */
export function parseGraduationYear(text: string): number | null | undefined {
  const year = text.trim();
  if (year.length === 0) return null;
  const parsed = /^\d{4}$/.test(year) ? Number(year) : NaN;
  return Number.isInteger(parsed) &&
    parsed >= GRADUATION_YEAR_MIN &&
    parsed <= GRADUATION_YEAR_MAX
    ? parsed
    : undefined;
}

/** The editor's opening draft: the profile as it stands, blank for unset. */
export function correctionDraft(profile: {
  displayName: string | null | undefined;
  graduationYear: number | null | undefined;
}): ProfileCorrectionDraft {
  return {
    name: profile.displayName ?? "",
    graduationYear:
      typeof profile.graduationYear === "number"
        ? String(profile.graduationYear)
        : "",
  };
}

/**
 * The body to send, holding only what changed, or the first field that can't
 * be sent. The name is trimmed and can't be blank; a blank year clears it, and
 * any other year is four digits in the range the API takes.
 */
export function correctionPatch(
  original: ProfileCorrectionDraft,
  draft: ProfileCorrectionDraft,
): ProfileCorrectionResult {
  const patch: ProfileCorrectionPatch = {};
  const name = draft.name.trim();
  if (name.length === 0) {
    return {
      ok: false,
      field: "name",
      message: CORRECTION_NAME_REQUIRED_MESSAGE,
    };
  }
  if (name !== original.name.trim()) patch.display_name = name;

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
  return { ok: true, patch };
}
