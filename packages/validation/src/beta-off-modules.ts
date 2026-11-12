/**
 * Modules switched off for **every** chapter during the beta, whatever the
 * chapter's own `enabled_modules` says (`spec/product/modules.md` § Beta-off
 * modules). Dues is here because the beta chapter does not collect dues in
 * Frapp (Paul, 2026-11-06). Meetings is here until the AI build-out lands.
 *
 * It works through `isModuleEnabled`, so every surface that already reads the
 * module gate hides the module, and any `@RequireModule` route or
 * `assertModuleEnabled` write for it is refused. Dues has no such route: the
 * member-invoice routes are deliberately ungated, so its own surfaces
 * (`/billing`'s invoice list, mobile Dues) check `isBetaOffModule` directly.
 * Settings → Modules leaves these out rather than offering a switch that
 * cannot turn on. Nothing is deleted: removing a key here turns the module
 * back on with the chapter's own setting and data as they were.
 */
export const BETA_OFF_MODULES: readonly string[] = Object.freeze([
  "dues",
  // Meeting minutes (#4312) are built on the AI integration branch and stay
  // off until that work ships as a whole (ADR-28; the AI build-out's
  // checklist for Paul says when to remove this key).
  "meetings",
]);

/** Whether `key` is switched off for every chapter during the beta. */
export function isBetaOffModule(key: string): boolean {
  return BETA_OFF_MODULES.includes(key);
}
