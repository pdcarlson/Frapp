import type { BadgeKind } from "@/components/ui/badge";

/** `ModuleCatalogEntry["tier"]`, restated so the mapper does not import the catalog. */
export type ModuleTier = "free" | "paid";

/**
 * A module's pricing tier → the §5 badge kind that states it.
 *
 * `settings-modules-tab.tsx` rendered this as a ternary between
 * `border-primary/40 text-primary` and `border-success/50 text-success` — the
 * chapter accent on one chip and a hand-spelled tint on the other, neither of
 * them a §5 kind. The accent half is #1202's defect reached by an inline
 * ternary, and this family had no mapper at all, so
 * `../shared/status-kind.test.ts` had never looked at it. The measurement is in
 * `../billing/status-contrast.test.ts`: under a green seed an accent badge
 * sits 1.08:1 from the success badge and under `#CC0000`/`#8B0000`/`#BF0A30`
 * 1.13:1 from danger, so a red-branded chapter read `Chapter Pro` as a
 * failure.
 *
 * **Both tiers take §5's Hairline, and that is the finding rather than a
 * compromise.** A tier is not a status. It is a fixed property of the module
 * in `MODULE_CATALOG` — the same for every chapter, unchanged by anything a
 * member does — which is precisely §5's "quiet metadata that must not read as
 * a status". The module's actual *state* is the Switch beside it, and painting
 * its price tag in a semantic hue put two different facts in one visual
 * channel: a green `Free` next to an off switch said the module was on.
 *
 * `success` was the more tempting half and is the more clearly wrong one.
 * foundations §5 gives `--success` to "Paid, confirmed, checked-in,
 * inside-zone" — outcomes in good standing. A module being free is not an
 * outcome. The distinction the row actually needs is carried by the word, which
 * is §5's own division of labour between hue and word, and the same resolution
 * `study-status.ts` reached for `ACTIVE` and `COMPLETED` sharing a hue.
 *
 * The `default:` arm keeps Hairline rather than the accent, so a third tier
 * added to the catalog renders as quiet metadata instead of silently claiming
 * the chapter's colour.
 */
export function moduleTierKind(tier: ModuleTier | string): BadgeKind {
  switch (tier) {
    case "free":
    case "paid":
      return "outline";
    default:
      return "outline";
  }
}

/**
 * The tier as a person should read it.
 *
 * `writing.md` §5 fixes the vocabulary for the six states it names and none of
 * these is among them, so `invoice-status.ts`'s disposition for Stripe's
 * tokens applies: a vocabulary with no §5 row maps to plain language **once**,
 * here, rather than being re-cased at each call site. These are the two strings
 * the modules tab already shipped from its ternary; a repaint must not quietly
 * change user-visible copy.
 *
 * `paid` reads as "Chapter Pro" rather than "Paid" deliberately — `PAID` is one
 * of the six tokens §5 *does* fix, and it means a settled invoice. The same
 * word on a module would state the opposite of what it states on `/billing`.
 */
export function moduleTierLabel(tier: ModuleTier | string): string {
  return tier === "paid" ? "Chapter Pro" : "Free";
}
