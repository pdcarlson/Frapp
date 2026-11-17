/** Settings → Organization → Chapter profile, as stored and as typed. */
export type ChapterProfileFields = {
  name: string;
  university: string;
  donation_url: string;
};

/** The `PATCH /v1/chapters/current` body the profile card sends. */
export type ChapterProfileSaveBody = {
  name?: string;
  university?: string;
  donation_url?: string;
};

/**
 * What the chapter profile card's Save sends: only the fields the officer
 * changed, trimmed, so a name or university stored before the API's rule
 * (`ChapterNameRules`, the onboarding wizard's 3 to 200 characters) never
 * refuses an edit of the donation link.
 *
 * A cleared name or university is sent as typed, so the API's refusal names
 * the minimum; it used to be dropped, and the toast said "saved" while the old
 * name stayed. A cleared donation link is still left out, because the API
 * reads an empty one as an invalid URL and has no way to clear it.
 */
export function chapterProfileSaveBody(
  stored: ChapterProfileFields,
  draft: ChapterProfileFields,
): ChapterProfileSaveBody {
  const body: ChapterProfileSaveBody = {};
  const name = draft.name.trim();
  if (name !== stored.name.trim()) body.name = name;
  const university = draft.university.trim();
  if (university !== stored.university.trim()) body.university = university;
  const donation = draft.donation_url.trim();
  if (donation && donation !== stored.donation_url.trim()) {
    body.donation_url = donation;
  }
  return body;
}
