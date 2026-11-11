import { formatRelativeDayTime } from "@repo/formatting";
import {
  activityNeedsYouHeadline,
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
 * the member clears their list.
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
  const next = summary.nextEvent;
  const when = next ? formatRelativeDayTime(next.start_time) : null;
  const nextLine = next
    ? ["Next up:", next.name, when ? `· ${when}` : null]
        .filter(Boolean)
        .join(" ")
    : null;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-title text-foreground">
          {summary.needsYou === 0
            ? "You're all caught up"
            : activityNeedsYouHeadline(summary.needsYou)}
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
                  tile.count === 0 && !pressed && "opacity-60",
                  FOCUS_RING,
                )}
              >
                <span className="text-headline tabular-nums text-foreground">
                  {tile.count}
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
