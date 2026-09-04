/**
 * Signet duotone glyphs for the points family.
 *
 * Recipe and the shared primitives: `components/ui/duotone.tsx`
 * (`spec/ui/design-system/iconography.md` §1). Intent → glyph map:
 * `iconography.md` §6.2.3, which §6.3 requires be updated in the same PR.
 *
 * Billing has no file of its own in this slice. Its one in-screen intent —
 * the payment method on the checkout card — is already the shell's Billing nav
 * intent, so `subscription-checkout-card.tsx` imports `BillingGlyph` from
 * `components/layout/nav-glyphs.tsx` directly. A module whose entire body is a
 * re-export is ceremony, and §1 rule 1 is about not redrawing, not about where
 * the import statement points.
 *
 * **Control furniture stays Lucide** (§6.2.2): `Loader2`, `RefreshCw`, `Plus`,
 * `CheckCircle2`. The §10 state family's `AlertTriangle` / `AlertCircle` also
 * stay, but on a different warrant — they belong to the shared state family
 * rather than to any screen, and §6.2.3 now lists them so that warrant is
 * written down rather than assumed.
 *
 * `WandSparkles` is deliberately absent rather than replaced. It sat on the
 * adjustment dialog's submit button; components.md §11 claims ✦ for the Ask/AI
 * affordance alone, which is why the chat slice deleted `Sparkles` from its
 * slash-command trigger. The button carries no glyph now — its label already
 * names the verb.
 */

import { Svg, detail, fillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export { SearchGlyph } from "@/components/layout/nav-glyphs";

export type PointsGlyphProps = DuotoneGlyphProps;

/**
 * Adjust points.
 *
 * Two slider tracks with their knobs — knobs are the silhouette, rails are
 * detail. Replaces Lucide's `Scale` on the trigger and in the dialog header.
 * It is an intent rather than furniture: the control is *about* a manual
 * adjustment, and the same drawing names it in two places.
 *
 * The first cut drew a balance beam, on the reasoning that `Scale` meant
 * weighing. Rendered, it read as a triangle with a line through it — a shape,
 * not a meaning. Sliders are the conventional "adjust" affordance and share no
 * silhouette with anything else in this set or the shell's.
 */
export function AdjustGlyph({ className, active }: PointsGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M3.6 8.6h16.8M3.6 15.4h16.8" {...detail} />
      <circle cx="9" cy="8.6" r="2.7" {...stroke} {...fillProps(active)} />
      <circle cx="15.4" cy="15.4" r="2.7" {...stroke} {...fillProps(active)} />
    </Svg>
  );
}

/**
 * Flagged transaction.
 *
 * The pennant is the silhouette, the staff is detail. Distinct from chat's
 * `AuditGlyph`, which means "the `#chapter-audit` channel" — this one means
 * "this row tripped the anomaly threshold". Two intents that happen to live
 * near each other are still two intents, and importing chat's into a finance
 * screen would be an edge worth nothing.
 */
export function FlaggedGlyph({ className, active }: PointsGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M6.4 4.4h11l-2.6 3.9 2.6 3.9h-11z" {...stroke} {...fillProps(active)} />
      <path d="M6.4 3.4v17.2" {...detail} />
    </Svg>
  );
}
