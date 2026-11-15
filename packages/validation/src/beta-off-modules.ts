/**
 * Modules switched off for **every** chapter during the beta, whatever the
 * chapter's own `enabled_modules` says (`spec/product/modules.md` § Beta-off
 * modules). Dues is here because the beta chapter does not collect dues in
 * Frapp (Paul, 2026-11-06).
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
export const BETA_OFF_MODULES: readonly string[] = Object.freeze(["dues"]);

/** Whether `key` is switched off for every chapter during the beta. */
export function isBetaOffModule(key: string): boolean {
  return BETA_OFF_MODULES.includes(key);
}

/**
 * Chapter billing (Chapter Pro checkout) is off for the beta (Paul,
 * 2026-11-15), so a new chapter starts `active` instead of `incomplete`.
 *
 * Without this, a chapter the wizard just made sits at the schema default
 * `incomplete`, where every screen loads and every paid-ops write (events,
 * tasks, points, …) is refused until checkout, which nobody is asked to do
 * during the beta. `ChapterService.create` reads this one switch, the same in
 * every environment, and the web wizard reads it to end on chat rather than
 * Plan and billing.
 *
 * A chapter made this way has no Stripe customer, which is the state Plan and
 * billing already draws as complimentary (no checkout, no Portal button).
 * Setting this to `false` brings checkout back for chapters created after
 * that; the beta's chapters stay complimentary until someone decides
 * otherwise, and they are the ones with `subscription_status = 'active'` and
 * no `stripe_customer_id`.
 */
export const CHAPTER_BILLING_BETA_OFF: boolean = true;
