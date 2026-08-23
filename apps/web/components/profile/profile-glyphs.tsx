/**
 * Signet duotone glyphs for the Profile & pre-auth family — `/profile`, the
 * onboarding wizard and tutorial, and the four pre-auth routes.
 *
 * Recipe and the shared `Svg` / `stroke` / `detail` / `fillProps` primitives:
 * `components/ui/duotone.tsx` (`spec/ui/design-system/iconography.md` §1). The
 * intent → glyph map lives in `iconography.md` §6.2.7 and MUST be updated in
 * the same PR as any change here (§6.3).
 *
 * One file for three directories, as Chapter Ops does for five: `profile/`,
 * `onboarding/` and `auth/` share their intents rather than partitioning them.
 * It is homed here because `ProfileGlyph` — the one glyph both `profile/` and
 * `onboarding/` consume — is a profile intent, and §6.2.3 already records that
 * a cross-directory import is fine: "§1 rule 1 is about not redrawing, not
 * about where an import points."
 *
 * **Two drawn, the rest re-exported**, which is the bar §6.2.6 sets for
 * shipping a family file at all. Five of the tutorial's eight slides name
 * intents the sidebar already draws, so migrating those five and leaving the
 * sixth on Lucide would be one intent in two glyph sets — the drift §1 rule 1
 * bans. The `LockGlyph` re-export crosses from chat for the same reason.
 *
 * **Control furniture stays Lucide** (§6.2.2): `Loader2`, `ArrowLeft`,
 * `ArrowRight`, `Check`, `CheckCircle2`, `Copy` and `PencilLine` — every one a
 * verb on a button or a spinner, never the thing a row is *about*. So does the
 * §10 state family's `FolderOpen` / `AlertTriangle` / `WifiOff`, which §6.2.3
 * records is `components/shared/**`'s to move and not a screen family's.
 *
 * **`SignetMark` is deliberately not here.** The gold "S" tile is a brand
 * composition governed by `brand-identity.md` §2, not an icon drawn to the
 * duotone recipe — the same carve-out §6.2.2 makes for the ✦ text glyph and
 * s04's `#` channel sigil. It lives in `components/auth/signet-mark.tsx`.
 *
 * **The ✦ leaves this family without a replacement.** `chapter-wizard.tsx` and
 * `onboarding-tutorial.tsx` each marked a non-Ask surface with Lucide's
 * `Sparkles`, which `components.md` §11 reserves for the Ask entry point. The
 * wizard's eyebrow now carries no glyph at all — its label already names the
 * intent, which is how `points-adjustment-dialog` resolved the same question
 * (§6.2.3) — and the tutorial's welcome slide takes the mark, because the slide
 * is literally a welcome to Signet.
 */

import { Svg, detail, fillProps, stroke } from "@/components/ui/duotone";
import type { DuotoneGlyphProps } from "@/components/ui/duotone";

export {
  BackworkGlyph,
  ChatGlyph,
  EventsGlyph,
  PointsGlyph,
  SearchGlyph,
  StudyGlyph,
} from "@/components/layout/nav-glyphs";
export { LockGlyph } from "@/components/chat/chat-glyphs";

export type ProfileGlyphProps = DuotoneGlyphProps;

/**
 * You — the viewer's own account.
 *
 * Genuinely undrawn before this family, which is why `account-menu.tsx` and the
 * tutorial's profile slide both reached for Lucide. The shell has no profile
 * nav intent to re-export because Profile left the sidebar for the account menu
 * in the Wave 0 restructure (`spec/ui/web-dashboard/README.md`), and neither
 * neighbour is this intent: `DirectoryGlyph` is **two** people (the chapter's
 * roster) and `InviteGlyph` is a person **plus a mark** (the act of inviting).
 * One person, no mark, is the third thing.
 *
 * The head shares `DirectoryGlyph`'s radius and the shoulder arc its curvature,
 * so a member reads the directory and their own row as the same person drawn
 * once and counted differently — the same relationship `InviteGlyph` already
 * keeps with it. Head is the silhouette, shoulders are detail.
 */
export function ProfileGlyph({ className, active }: ProfileGlyphProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8.8" r="3.4" {...stroke} {...fillProps(active)} />
      <path d="M5.4 19.2c.9-3.2 3.4-4.8 6.6-4.8s5.7 1.6 6.6 4.8" {...detail} />
    </Svg>
  );
}

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
