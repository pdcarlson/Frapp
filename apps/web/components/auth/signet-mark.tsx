/**
 * The Signet mark: locked emblem B (gold crest on charcoal).
 *
 * `spec/ui/brand-identity.md` §2: shipping mark is the abstract crest, never
 * chapter accent. Both reference boards still draw a placeholder "S" tile;
 * the committed asset is Design's raster. `aria-hidden`, and the screens
 * pair it with their own `<h1>`: the tile is a decorative restatement of a
 * wordmark the page already renders as text.
 */

import { cn } from "@/lib/utils";

const FIELD = "#1A1A1A";
const GOLD = "#DDB844";

/**
 * Two sizes, both drawn: s01's 52px entry-screen tile and `components.md` §7's
 * 30px app-bar chip. The chip is drawn at radius 9, which is off
 * `foundations.md` §8's locked map, so it rounds onto the adjacent `sm` step
 * (10), the same treatment §8 gets for s01's 50px fields against the 48px
 * control height.
 */
const SIZES = {
  lg: "h-[52px] w-[52px] rounded-lg",
  sm: "h-[30px] w-[30px] rounded-sm",
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
        "signet-mark flex shrink-0 items-center justify-center overflow-hidden",
        SIZES[size],
        className,
      )}
      data-field={FIELD}
      data-gold={GOLD}
      style={{ backgroundColor: FIELD, color: GOLD }}
    >
      <img
        // Public raster of Design's lock. next/image is unnecessary for a
        // 52px decorative tile already served from /brand.
        // eslint-disable-next-line @next/next/no-img-element
        src="/brand/signet-emblem-B.png"
        alt=""
        className="h-full w-full object-cover"
      />
    </span>
  );
}
