import type { components } from "@repo/api-sdk";
import { normalizePhone } from "@repo/formatting";
import {
  BIRTHDAY_VISIBILITY_DEFAULT,
  type BirthdayVisibility,
} from "@repo/validation";

/** The `PATCH /v1/users/me` body, the generated `UpdateUserDto`. */
export type ProfileSaveBody = components["schemas"]["UpdateUserDto"];

/** The profile fields `/profile` edits, as stored and as typed. */
export type ProfileFields = {
  display_name?: string | null;
  phone?: string | null;
  major?: string | null;
  bio?: string | null;
  graduation_year?: number | null;
  current_city?: string | null;
  current_company?: string | null;
  birthday_month?: number | null;
  birthday_day?: number | null;
  birthday_year?: number | null;
  birthday_visibility?: BirthdayVisibility;
};

const TEXT_FIELDS = [
  "display_name",
  "major",
  "bio",
  "current_city",
  "current_company",
] as const;

const BIRTHDAY_FIELDS = [
  "birthday_month",
  "birthday_day",
  "birthday_year",
] as const;

/**
 * What `/profile`'s Save sends: only the fields the member changed from what
 * was loaded, as the phone's Edit sheet does (`profilePatch` in
 * `apps/mobile/lib/more/edit-profile.ts`).
 *
 * Sending every field on every save let a value stored before a limit, such
 * as a long name copied from a sign-in provider or a bio from before the cap,
 * refuse an unrelated edit like a new phone number, and wrote back any field
 * another device changed since the page loaded.
 *
 * Text compares trimmed and is sent trimmed, so a stray space is no change.
 * The birthday goes whole whenever any part of it or who can see it changed,
 * so the API checks the day against the month and year as one (#4959).
 */
export function profileSaveBody(
  saved: ProfileFields,
  draft: ProfileFields,
): ProfileSaveBody {
  const body: ProfileSaveBody = {};

  for (const field of TEXT_FIELDS) {
    const next = (draft[field] ?? "").trim();
    if (next !== (saved[field] ?? "").trim()) body[field] = next;
  }

  // Blank clears it; the API trims and stores null. The field shows the number
  // formatted and the API stores it normalized (#5798), so the two compare
  // normalized: `(518) 555-0142` against a stored `+15185550142` is no change.
  const phone = normalizePhone(draft.phone ?? "");
  if (phone !== normalizePhone(saved.phone ?? "")) body.phone = phone;

  const year = draft.graduation_year ?? null;
  if (year !== (saved.graduation_year ?? null)) body.graduation_year = year;

  const visibility = draft.birthday_visibility ?? BIRTHDAY_VISIBILITY_DEFAULT;
  const birthdayChanged =
    BIRTHDAY_FIELDS.some(
      (field) => (draft[field] ?? null) !== (saved[field] ?? null),
    ) ||
    visibility !== (saved.birthday_visibility ?? BIRTHDAY_VISIBILITY_DEFAULT);
  if (birthdayChanged) {
    const month = draft.birthday_month ?? null;
    body.birthday_month = month;
    body.birthday_day = draft.birthday_day ?? null;
    // The year rides with the month and day: no month, no year.
    body.birthday_year = month === null ? null : (draft.birthday_year ?? null);
    body.birthday_visibility = visibility;
  }

  return body;
}
