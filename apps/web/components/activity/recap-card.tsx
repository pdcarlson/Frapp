"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { activityRecapCard, type ActivityRecap } from "@repo/hooks";
import { SectionLabel } from "@/components/shared/section-label";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The last week this browser dismissed the recap for, by the recap's
 * `dismissKey` (the end of the week it sums up). Per browser, like the Get
 * the app card (`lib/get-the-app.ts`): one value, so next week's recap,
 * with its own key, shows again.
 */
export const RECAP_DISMISSED_STORAGE_KEY = "frapp.web.activity-recap-dismissed";

const listeners = new Set<() => void>();
/** Set once dismissed in this page, so blocked storage still hides it until reload. */
let dismissedHere: string | null = null;

function readDismissed(): string | null {
  if (dismissedHere) return dismissedHere;
  try {
    return window.localStorage.getItem(RECAP_DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

function dismissRecap(key: string): void {
  dismissedHere = key;
  try {
    window.localStorage.setItem(RECAP_DISMISSED_STORAGE_KEY, key);
  } catch {
    // Hidden for this page load only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget a dismissal made in this module. */
export function resetRecapDismissalForTests(): void {
  dismissedHere = null;
}

/**
 * Last week, at the top of Activity on Sunday to Tuesday (#4983): what the
 * member did in their last finished week, as Slack's and Linear's weekly
 * digests sum one up, from `GET /v1/activity/recap`. The week card says this
 * week in progress; this says the week that just closed, once, and then
 * gets out of the way: dismissed, it stays gone until next week's.
 *
 * Only what the member did is drawn (`activityRecapCard`): a module that is
 * off, a part that couldn't be read and a zero are left out, and a week with
 * nothing to show draws no card at all.
 */
export function RecapCard({ recap }: { recap: ActivityRecap }) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => null);
  const card = activityRecapCard(recap);
  if (!card || dismissed === card.dismissKey) return null;
  return (
    <section
      aria-labelledby="activity-recap"
      className="space-y-2"
      data-testid="activity-recap"
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel id="activity-recap" count={card.range}>
          Last week
        </SectionLabel>
        <button
          type="button"
          onClick={() => dismissRecap(card.dismissKey)}
          aria-label="Dismiss last week's recap"
          className={cn(
            "-my-2 inline-flex h-9 w-9 items-center justify-center rounded-md pointer-coarse:h-11 pointer-coarse:w-11",
            "text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-4 py-3">
        {card.figures.map((figure) => (
          <li
            key={figure.id}
            aria-label={figure.spokenLabel}
            data-testid={`activity-recap-${figure.id}`}
            className="flex items-baseline gap-1.5"
          >
            <span
              aria-hidden="true"
              className="text-label tabular-nums text-foreground"
            >
              {figure.figure}
            </span>
            <span
              aria-hidden="true"
              className="text-caption text-muted-foreground"
            >
              {figure.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
