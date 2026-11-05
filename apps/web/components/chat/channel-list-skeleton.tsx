import { Skeleton } from "@/components/shared/async-states";
import { cn } from "@/lib/utils";

/**
 * Reserved geometry for the channels column while `useChannels()` is in flight.
 *
 * The board's first-paint contract (`1s`) puts the channel column's chrome at
 * 0ms and fills it from cache on the first chunk; what it never does is replace
 * the route with a loading card. These blocks are the row geometry above — 32px
 * tall at radius 8, the same 2px gaps, an indent for the mark — so the real rows
 * land in the space the placeholders already held rather than pushing anything.
 *
 * **Since the first-chunk cache shipped this is the cold-cache path, not the
 * usual one.** A warm load seeds `["channels"]` from IndexedDB before the rail
 * renders, so `channelsPaneState` never reaches `"loading"` and neither this
 * nor the `sr-only` announcer below is reached. It is still the path for a
 * first-ever visit, a wiped or expired cache, and a browser where IndexedDB
 * throws — which is why it stays, and why its geometry still has to match.
 *
 * Deliberately not a count derived from anything. A cached count is available
 * now, but the skeleton renders precisely when it is *not* — and a number that
 * changes between renders makes the column jump.
 * `aria-hidden` because eight anonymous rectangles are no use to a screen
 * reader. **That means this is not the whole loading affordance**: the spoken
 * half is a separate `sr-only` live region in `chat-shell.tsx`, kept outside
 * this column because `narrowPane` hides the column entirely below `lg`. Do not
 * conclude from the `aria-hidden` here that an announcement is supplied by
 * whatever renders this — the shared `LoadingState` that used to carry one was
 * deleted with the whole-route loading card (#2142).
 */
export function ChannelListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-0.5">
      {SKELETON_ROW_WIDTHS.map((width, index) => (
        <div key={index} className="flex h-8 items-center gap-2 px-2">
          <Skeleton className="h-4 w-4 shrink-0 rounded-xs" />
          <Skeleton className={cn("h-[13px]", width)} />
        </div>
      ))}
    </div>
  );
}

/**
 * Cycled rather than randomised: a skeleton that reshuffles on every render
 * flickers, and under Strict Mode it would differ between the two passes.
 */
const SKELETON_ROW_WIDTHS = [
  "w-[62%]",
  "w-[45%]",
  "w-[70%]",
  "w-[52%]",
  "w-[58%]",
  "w-[40%]",
  "w-[66%]",
  "w-[48%]",
] as const;
