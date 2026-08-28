/**
 * The Signet mark — the gold rounded-square "S" tile.
 *
 * `spec/ui/brand-identity.md` §2: "The shipping mark is a **placeholder**: a
 * rounded-square tile in house gold carrying a bold 'S' glyph", with the final
 * logo blocked on a trademark search. Both reference boards draw it — s01 at
 * 52px with radius 14, and `components.md` §7's app-bar chip at 30px with
 * radius 9.
 *
 * **Composed inline rather than taken from `@repo/brand-assets`.**
 * `spec/ui/assets.md` §1 says the committed `app-icon.svg` and
 * `frapp-lockup.svg` still draw the legacy "F" and that teams "MUST NOT restyle
 * the legacy assets toward Signet piecemeal — the whole set regenerates
 * together from the final mark". This draws nothing legacy: it composes the
 * placeholder the brand spec already specifies and the boards already draw, and
 * it touches neither committed file nor the synced `app/icon.svg` favicon.
 *
 * **House gold, explicitly, never `--primary`.** `brand-identity.md` §2: "The
 * mark and logo MUST NOT take the chapter accent — ever." On the pre-auth
 * routes `--primary` happens to hold the baked default seed, because
 * `useChapterTheme()` mounts inside `DashboardShell` and these routes render
 * outside it — so the two look identical today and would diverge the moment
 * anything mounted the accent bridge higher. `--gold-house` states the rule
 * rather than relying on that coincidence.
 *
 * `aria-hidden`, and the screens pair it with their own `<h1>`: the tile is a
 * decorative restatement of a wordmark the page already renders as text.
 */

import { cn } from "@/lib/utils";

/**
 * Two sizes, both drawn: s01's 52px entry-screen tile and `components.md` §7's
 * 30px app-bar chip. The chip is drawn at radius 9, which is off
 * `foundations.md` §8's locked map, so it rounds onto the adjacent `sm` step
 * (10) — the same treatment §8 gets for s01's 50px fields against the 48px
 * control height.
 *
 * The glyph is sized off the tile rather than off the type scale: it is a drawn
 * mark, not a run of text, so §7's ladder does not bind it.
 */
const SIZES = {
  lg: "h-[52px] w-[52px] rounded-lg text-[27px]",
  sm: "h-[30px] w-[30px] rounded-sm text-[16px]",
} as const;

export function SignetMark({
  size = "lg",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center",
        "bg-gold-house font-extrabold leading-none text-gold-on-house",
        SIZES[size],
        className,
      )}
    >
      S
    </span>
  );
}
