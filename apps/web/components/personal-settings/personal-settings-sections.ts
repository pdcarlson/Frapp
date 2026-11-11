/**
 * The personal Settings page's sections (`/preferences`, #3856).
 *
 * Two groups, by what a setting belongs to (epic #4068's scopes). "My account"
 * is stored on the person and follows them into every chapter. "In <chapter>"
 * is stored per chapter, so it changes with the chapter switcher: alerts
 * (`notification_preferences` is keyed by chapter), the block list
 * (`GET /v1/chat/blocks` is the active chapter's) and the Discord link (one
 * per chapter's import). My invoices joins the second group when billing moves
 * (#3827).
 *
 * A section's `value` is its `?section=` address. Other screens link to these,
 * and the API's Discord link returns to `discord`
 * (`AUTHOR_LINK_RETURN_PATH`), so renaming one is a sweep.
 */
export const PERSONAL_SETTINGS_PATH = "/preferences";

export const PERSONAL_SETTINGS_SECTIONS = [
  { value: "notifications", label: "Notifications", group: "account" },
  { value: "appearance", label: "Appearance and chat", group: "account" },
  { value: "account", label: "Account", group: "account" },
  { value: "alerts", label: "Chapter alerts", group: "chapter" },
  { value: "blocked", label: "Blocked members", group: "chapter" },
  { value: "discord", label: "Discord history", group: "chapter" },
] as const;

export type PersonalSettingsSection =
  (typeof PERSONAL_SETTINGS_SECTIONS)[number]["value"];

/** The section the page opens on, and falls back to for an unknown `?section=`. */
export const DEFAULT_PERSONAL_SETTINGS_SECTION: PersonalSettingsSection =
  "notifications";

export function personalSettingsHref(section: PersonalSettingsSection): string {
  return section === DEFAULT_PERSONAL_SETTINGS_SECTION
    ? PERSONAL_SETTINGS_PATH
    : `${PERSONAL_SETTINGS_PATH}?section=${section}`;
}

export function resolvePersonalSettingsSection(
  param: string | null | undefined,
): PersonalSettingsSection {
  const match = PERSONAL_SETTINGS_SECTIONS.find((s) => s.value === param);
  return match ? match.value : DEFAULT_PERSONAL_SETTINGS_SECTION;
}
