/**
 * The Signet mark — locked emblem B (gold crest on charcoal, neck break).
 *
 * `spec/ui/brand-identity.md` §2: shipping mark is the abstract crest, never
 * chapter accent. Both reference boards still draw a placeholder "S" tile;
 * the committed asset is the crest. `aria-hidden`, and the screens pair it
 * with their own `<h1>`: the tile is a decorative restatement of a wordmark
 * the page already renders as text.
 */

import { useId } from "react";
import { cn } from "@/lib/utils";

const FIELD = "#1A1A1A";
const GOLD = "#DDB844";
const CREST =
  "M22.2 32.4c.2-8.2 7.8-15.2 18.2-14.2 6.6.7 12.4 5.6 13.8 12.2 1 4.8-.6 9.2-4.8 12.2-2.2 1.6-4.8 2.5-7.6 2.6l-1.2 7.4c-.4 2.2 1.2 4.2 3.4 4.4l.6-4.2c2.8.1 5.6-.6 8-2.2 5.8-4.2 8.2-11.2 6.8-18.2C57.2 19.4 48.2 12.2 38.2 11.2 24.4 9.8 14.8 19.4 14.6 31.4c-.1 5.4 2.6 10.2 7.2 13.2l2.2-3.4c-2.8-2.2-4.6-5.6-4.4-8.8z";

/**
 * Two sizes, both drawn: s01's 52px entry-screen tile and `components.md` §7's
 * 30px app-bar chip. The chip is drawn at radius 9, which is off
 * `foundations.md` §8's locked map, so it rounds onto the adjacent `sm` step
 * (10) — the same treatment §8 gets for s01's 50px fields against the 48px
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
  const maskId = `signet-neck-${useId().replace(/:/g, "")}`;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "signet-mark flex shrink-0 items-center justify-center overflow-hidden",
        SIZES[size],
        className,
      )}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
      >
        <defs>
          <mask id={maskId}>
            <rect width="64" height="64" fill="white" />
            <rect
              x="24.5"
              y="45.2"
              width="12.5"
              height="2.6"
              rx="1.1"
              fill="black"
              transform="rotate(-32 31 46.5)"
            />
          </mask>
        </defs>
        <rect width="64" height="64" rx="16" fill={FIELD} />
        <path fill={GOLD} mask={`url(#${maskId})`} d={CREST} />
      </svg>
    </span>
  );
}
