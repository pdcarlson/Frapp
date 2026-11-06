/**
 * The member profile form's labels and placeholders, shared by web `/profile`
 * and the mobile Edit profile sheet so the two can't drift apart.
 *
 * The rules they follow are `spec/ui/design-system/writing.md` § Form copy: a
 * placeholder never asks for what another field holds, never repeats its own
 * label, and says nothing a label already said. The bio used to ask for
 * "Major, year, anything brothers should know." right above a graduation year
 * field, before major had a field of its own (2026-11-06).
 */
export const PROFILE_FIELD_COPY = {
  displayName: { label: "Name", placeholder: "First and last name" },
  major: { label: "Major", placeholder: "e.g. Mechanical Engineering" },
  // "Grad year" fits beside Major on a phone; the full name is what a screen
  // reader announces.
  graduationYear: {
    label: "Grad year",
    accessibleLabel: "Graduation year",
    placeholder: "YYYY",
  },
  bio: {
    label: "Bio",
    placeholder: "Hometown, hidden talent, go-to late-night order.",
  },
  city: { label: "City", placeholder: "Where you live now" },
  company: { label: "Company", placeholder: "Where you work" },
} as const;

/** The heading over City and Company, which exist for the alumni directory. */
export const PROFILE_ALUMNI_SECTION = {
  title: "After graduation",
  hint: "Shown in the alumni directory.",
} as const;
