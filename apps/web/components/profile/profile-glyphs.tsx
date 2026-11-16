/**
 * Signet duotone glyphs for the Profile & pre-auth family — the onboarding
 * wizard and the pre-auth routes.
 *
 * `LinkGlyph` keeps the stroke recipe in `components/ui/duotone.tsx` (§1),
 * because a filled silhouette breaks a chain link, and so do the re-exported
 * `SearchGlyph` and `LockGlyph` until #3491. The intent → glyph map lives in
 * `iconography.md` §6.2.7 and MUST be updated in the same PR as any change
 * here (§6.3).
 *
 * One file for three directories, as Chapter Ops does for five: `profile/`,
 * `onboarding/` and `auth/` share their intents rather than partitioning them,
 * and §6.2.3 records that a cross-directory import is fine: "§1 rule 1 is
 * about not redrawing, not about where an import points."
 *
 * `ProfileGlyph` and the Chat, Events, Backwork, Study hours and Points
 * re-exports went with the first-run slideshow that was their one consumer
 * (#5080): the spotlight tour lights the real controls and draws no glyph.
 *
 * **Control furniture stays Lucide** (§6.2.2): `Loader2`, `ArrowLeft`,
 * `ArrowRight`, `Check`, `CheckCircle2`, `Copy` and `PencilLine` — every one a
 * verb on a button or a spinner, never the thing a row is *about*. So does the
 * §10 state family's `FolderOpen` / `AlertTriangle` / `WifiOff`, which §6.2.3
 * records is `components/shared/**`'s to move and not a screen family's.
 *
 * **`SignetMark` is deliberately not here.** Locked emblem B is a brand
 * composition governed by `brand-identity.md` §2, not an icon drawn to the
 * duotone recipe — the same carve-out §6.2.2 makes for the ✦ text glyph and
 * s04's `#` channel sigil. It lives in `components/auth/signet-mark.tsx`.
 *
 * **The ✦ leaves this family without a replacement.** `chapter-wizard.tsx`
 * and the first-run slideshow (replaced by the spotlight tour, #5080) each
 * marked a non-Ask surface with Lucide's `Sparkles`, which `components.md` §11
 * reserves for the Ask entry point. The wizard's eyebrow now carries no glyph
 * at all — its label already names the intent, which is how
 * `points-adjustment-dialog` resolved the same question (§6.2.3).
 */

import { Svg, detail } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export { SearchGlyph } from "@/components/layout/nav-glyphs";
export { LockGlyph } from "@/components/chat/chat-glyphs";

export type ProfileGlyphProps = DuotoneGlyphProps;

/**
 * An invite link.
 *
 * Transcribed from the s02 hint card, which draws a chain link in `#F4CB63`
 * beside "Got an invite link? It opens here and fills the code for you." The
 * reference settling the geometry is why this is drawn rather than borrowed
 * from `InviteGlyph`: that one is the officer *issuing* a token, this is the
 * member *arriving* with one, and `spec/ui/README.md`'s precedence rule puts
 * the drawing above a convenient reuse.
 *
 * Legitimately stroke-only, the exception `AttachGlyph` documents: SVG closes
 * an open path implicitly when it fills one, so a fill here paints a lens-shaped
 * wedge across the break that makes the two halves read as links.
 *
 * Path is s02's 20-grid geometry rescaled ×1.2 onto the 24 grid the recipe
 * fixes, and the 1.7 stroke it draws normalised to the recipe's 1.6.
 */
export function LinkGlyph({ className }: ProfileGlyphProps) {
  return (
    <Svg className={className}>
      <path d="M9.6 14.4l4.8-4.8" {...detail} />
      <path
        d="M10.8 7.8l1.44-1.44a3.6 3.6 0 015.04 5.04l-1.44 1.44M13.2 16.2l-1.44 1.44a3.6 3.6 0 01-5.04-5.04l1.44-1.44"
        {...detail}
      />
    </Svg>
  );
}
