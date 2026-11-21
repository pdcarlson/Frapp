import { isBetaOffModule } from "./beta-off-modules";

// ── Module enablement predicate (issue #264) ─────────────────────────────────

/**
 * Single source of truth for "is this module on for this chapter?".
 *
 * Deliberately shared rather than reimplemented per surface: the web nav, the
 * Cmd+K palette, the chat slash-command palette, and the API's `ChapterGuard`
 * all answer this question, and a disagreement between the client and the
 * server means either a surface the user can see but not use, or a write the
 * UI hides but the API still accepts.
 *
 * A module is enabled unless the chapter explicitly turned it off. Absence is
 * not disablement — a chapter created before a module existed has no key for
 * it, and must not be locked out of something it never disabled. The one
 * exception is a `BETA_OFF_MODULES` key, which is off for every chapter.
 *
 * @param enabledModules the chapter's `enabled_modules` map, if loaded
 * @param key a `MODULE_CATALOG` key, e.g. `"events"`
 */
export function isModuleEnabled(
  enabledModules: Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  if (isBetaOffModule(key)) return false;
  return enabledModules?.[key] !== false;
}
