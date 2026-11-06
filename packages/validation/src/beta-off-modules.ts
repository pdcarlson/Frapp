/**
 * Modules switched off for **every** chapter during the beta, whatever the
 * chapter's own `enabled_modules` says (`spec/product/modules.md` § Beta-off
 * modules). Dues is here because the beta chapter does not collect dues in
 * Frapp (Paul, 2026-11-06).
 *
 * It works through `isModuleEnabled`, so every surface that already reads the
 * module gate hides the module and `ChapterGuard` refuses its writes, with no
 * per-surface list. Settings → Modules leaves these out rather than offering a
 * switch that cannot turn on. Nothing is deleted: removing a key here turns
 * the module back on with the chapter's own setting and data as they were.
 */
export const BETA_OFF_MODULES: readonly string[] = Object.freeze(["dues"]);

/** Whether `key` is switched off for every chapter during the beta. */
export function isBetaOffModule(key: string): boolean {
  return BETA_OFF_MODULES.includes(key);
}
