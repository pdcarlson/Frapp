import {
  activityNeedsYouHeadline,
  activityNextUpLine,
  type ActivityFilter,
  type ActivitySummary as Summary,
} from "@repo/hooks";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The top of `/activity` (#4173): how much is waiting on the member, the next
 * event, and a count tile per kind of ask (Apple Reminders' tiles). A tile
 * sets the chip of its kind, and pressing the lit one again clears it, as a
 * chip does. A tile at zero dims rather than hides, so the row never jumps as
 * the member clears their list; a tile whose section could not be read shows
 * a dash, never 0, and the headline never says "caught up" then either.
 */
export function ActivitySummary({
  summary,
  filter,
  onFilter,
}: {
  summary: Summary;
  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
}) {
  const nextLine = activityNextUpLine(summary);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-title text-foreground">
          {activityNeedsYouHeadline(summary)}
        </p>
        {nextLine ? (
          <p className="text-caption text-muted-foreground">{nextLine}</p>
        ) : null}
      </div>
      {summary.tiles.length > 0 ? (
        <div
          role="group"
          aria-label="Needs you by kind"
          className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2"
        >
          {summary.tiles.map((tile) => {
            const pressed = filter === tile.filter;
            return (
              <button
                key={tile.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => onFilter(pressed ? "all" : tile.filter)}
                className={cn(
                  "flex min-h-16 flex-col items-start justify-between gap-1 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-card-hover",
                  pressed ? "border-accent-border" : "border-border",
                  FOCUS_RING,
                )}
              >
                {/* A zero tile steps down the text ladder rather than fading
                    the whole button (#3826): `opacity-60` took the count to
                    about 6:1 and the label under 5:1 on a still-working
                    control, off any token. */}
                <span
                  className={cn(
                    "text-headline tabular-nums",
                    tile.zero && !pressed ? "text-muted" : "text-foreground",
                  )}
                >
                  {tile.count ?? (
                    // A section that could not be read is unknown, never 0.
                    <>
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">Couldn&apos;t load</span>
                    </>
                  )}
                </span>
                <span className="text-caption font-semibold text-muted-foreground">
                  {tile.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
