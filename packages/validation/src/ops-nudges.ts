/**
 * The ops-module setup nudges, shared so the surface that renders them and the
 * endpoint that records their dismissal agree on one closed set of keys.
 *
 * `spec/product/modules.md` § "Ops-setup nudges" fixes both the membership and
 * the order: **one nudge per module, in the fixed priority Dues > Events >
 * Tasks > Points**, so a chapter is never asked two things at once. That is a
 * strict subset of `MODULE_CATALOG` — the other paid modules have no nudge —
 * which is why this is its own list rather than a filter over the catalog.
 *
 * Shared rather than web-local because each `key` is written verbatim into
 * `members.dismissed_ops_nudges` and validated back by the API's
 * `DismissOpsNudgeDto`. Nothing in the database constrains that string (the
 * column is `text[]` with no CHECK — see the migration for why), so one catalog
 * is what makes a typo a compile error instead of a dismissal that silently
 * never suppresses anything.
 *
 * It deliberately does **not** live in `@repo/org-archetypes` beside
 * `MODULE_CATALOG`: that package's dist is ESM-only, and a runtime import of it
 * in a domain service forces every downstream unit spec to mock the package —
 * the reasoning `chapter-points-config.service.ts` records for keeping its own
 * defaults out of there.
 *
 * ## No trial language, deliberately
 *
 * The copy below says what enabling the module does, and nothing about a trial.
 * A 14-day trial does exist, but it is **chapter-level, once per chapter, opened
 * at Stripe checkout** (`spec/behavior/billing.md`) — not per-module. Per-module
 * trial state with a countdown is unbuilt and tracked separately (#485), and
 * `grantTrial` is keyed on ever having held a subscription, so for a chapter
 * that already used its one trial a "14-day trial" nudge would simply be false.
 * The canonical spec line prescribes no trial language; the phrasing suggested
 * in #492's context block predates that and was not adopted.
 */

/** One nudge, as drawn: a headline, a line of body copy, and the module it enables.
 *
 * Deliberately carries **no `label`**. The module's display name belongs to
 * `MODULE_CATALOG` in `@repo/org-archetypes`, and a second copy here would drift
 * the moment that one is relabelled — the nudge would read "Enable Dues" while
 * Settings → Modules, the sidebar and the slash palette all read something else.
 * The rendering surface resolves it through `getModuleCatalogEntry(key)`, which
 * is the accessor `spec/engineering.md` § "Catalog lookups and defaults"
 * mandates. Only the nudge-specific *pitch* lives here, because the catalog has
 * no field for it.
 */
export interface OpsNudgeModule {
  /** A `MODULE_CATALOG` key, written verbatim to `members.dismissed_ops_nudges`. */
  key: string;
  /** Card headline. Sentence case, per `spec/ui/design-system/writing.md`. */
  headline: string;
  /** One line naming what the chapter actually gets. */
  description: string;
}

/**
 * Ordered — index 0 is offered first. The order is the spec's, not a
 * preference: reordering this array changes documented behavior.
 */
export const OPS_NUDGE_MODULES = [
  {
    key: "dues",
    headline: "Collect dues in Frapp",
    description:
      "Invoices, payment plans, and card or ACH payments, tracked against your roster.",
  },
  {
    key: "events",
    headline: "Run your calendar in Frapp",
    description:
      "RSVPs, QR check-in, and attendance that grants points automatically.",
  },
  {
    key: "tasks",
    headline: "Assign chapter tasks",
    description:
      "Hand out work, confirm it is done, and grant points on completion.",
  },
  {
    key: "points",
    headline: "Track participation points",
    description: "An earn-and-spend ledger with a chapter leaderboard.",
  },
] as const satisfies readonly OpsNudgeModule[];

/** The `key` of a module that has a nudge. */
export type OpsNudgeModuleKey = (typeof OPS_NUDGE_MODULES)[number]["key"];

const OPS_NUDGE_KEYS: ReadonlySet<string> = new Set(
  OPS_NUDGE_MODULES.map((module) => module.key),
);

/**
 * Whether `value` is a module this catalog nudges for.
 *
 * The API validates a dismissal against this before writing, so a client
 * cannot grow the array with arbitrary strings.
 */
export function isOpsNudgeModuleKey(
  value: unknown,
): value is OpsNudgeModuleKey {
  return typeof value === "string" && OPS_NUDGE_KEYS.has(value);
}

/**
 * The one nudge to show, or `null` for none.
 *
 * Eligibility is **`enabledModules[key] === false`**, not `!enabledModules[key]`.
 * That is the repo-wide "enabled unless explicitly `false`" contract that
 * `useOrgConfig().isModuleEnabled`, the sidebar gate, and Settings → Modules all
 * read — so a chapter whose `enabled_modules` map has no entry for a module has
 * it *on*, and correctly gets no nudge. Archetype presets do write explicit
 * `false` (e.g. `dues: false` on the newest-chapter preset), which is what makes
 * the nudge reachable at all.
 *
 * `undefined` for `enabledModules` means the chapter config has not resolved
 * yet. It returns `null` rather than guessing, so a nudge never flashes in and
 * out while the config query is in flight.
 */
export function selectOpsNudge(
  enabledModules: Record<string, boolean> | undefined,
  dismissed: readonly string[] = [],
): OpsNudgeModule | null {
  if (!enabledModules) return null;
  const dismissedKeys = new Set(dismissed);
  return (
    OPS_NUDGE_MODULES.find(
      (module) =>
        enabledModules[module.key] === false && !dismissedKeys.has(module.key),
    ) ?? null
  );
}
