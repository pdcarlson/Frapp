import { isBetaOffModule } from "@repo/validation";

/**
 * The personal Settings page's sections (`/preferences`, #3856).
 *
 * Two groups, by what a setting belongs to (epic #4068's scopes). "My account"
 * is stored on the person and follows them into every chapter. "In <chapter>"
 * is stored per chapter, so it changes with the chapter switcher: alerts
 * (`notification_preferences` is keyed by chapter), the block list
 * (`GET /v1/chat/blocks` is the active chapter's) and the Discord link (one
 * per chapter's import), and My invoices (a member's dues are the chapter's
 * invoices; #3827 moved them here from `/billing`).
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
  // The member's answer on the AI sheet (#4308). Shown only while the server
  // has AI: the page passes `aiAvailable`.
  { value: "ai", label: "AI", group: "account" },
  { value: "alerts", label: "Chapter alerts", group: "chapter" },
  { value: "blocked", label: "Blocked members", group: "chapter" },
  { value: "invoices", label: "My invoices", group: "chapter" },
  { value: "discord", label: "Discord history", group: "chapter" },
] as const;

export type PersonalSettingsSection =
  (typeof PERSONAL_SETTINGS_SECTIONS)[number]["value"];

/**
 * Sections that belong to one module, and leave while it is off for every
 * chapter in the beta (`BETA_OFF_MODULES`). Dues is off for the beta, so My
 * invoices has nothing to list and no row.
 */
const SECTION_MODULES: Partial<Record<PersonalSettingsSection, string>> = {
  invoices: "dues",
};

/**
 * Whether a section is in the product right now. `aiAvailable` is whether the
 * server has AI (`aiAvailableFrom(useAiConsent())`): the AI section shows
 * only on `true`, so with `AI_ENABLED` off, or before the server answers,
 * Settings is what it was.
 */
export function isPersonalSettingsSectionShown(
  section: PersonalSettingsSection,
  aiAvailable?: boolean,
): boolean {
  if (section === "ai") return aiAvailable === true;
  const moduleKey = SECTION_MODULES[section];
  return !(moduleKey && isBetaOffModule(moduleKey));
}

/** The section the page opens on, and falls back to for an unknown `?section=`. */
const DEFAULT_PERSONAL_SETTINGS_SECTION: PersonalSettingsSection =
  "notifications";

export function personalSettingsHref(section: PersonalSettingsSection): string {
  return section === DEFAULT_PERSONAL_SETTINGS_SECTION
    ? PERSONAL_SETTINGS_PATH
    : `${PERSONAL_SETTINGS_PATH}?section=${section}`;
}

export function resolvePersonalSettingsSection(
  param: string | null | undefined,
  aiAvailable?: boolean,
): PersonalSettingsSection {
  const match = PERSONAL_SETTINGS_SECTIONS.find((s) => s.value === param);
  return match && isPersonalSettingsSectionShown(match.value, aiAvailable)
    ? match.value
    : DEFAULT_PERSONAL_SETTINGS_SECTION;
}
