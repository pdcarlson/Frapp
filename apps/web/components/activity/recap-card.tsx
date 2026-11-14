"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  activityRecapCard,
  recapDismissalKey,
  recapDismissed,
  useActiveChapterId,
  withRecapDismissal,
  type ActivityRecap,
} from "@repo/hooks";
import { SectionLabel } from "@/components/shared/section-label";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * The recaps this browser dismissed, by chapter and week
 * (`recapDismissalKey`). Per browser, like the Get the app card
 * (`lib/get-the-app.ts`): a few keys, so next week's recap, and another
 * chapter's, still show.
 */
export const RECAP_DISMISSED_STORAGE_KEY = "frapp.web.activity-recap-dismissed";

const listeners = new Set<() => void>();
/** Dismissed in this page, so blocked storage still hides it until reload. */
let dismissedHere = "";

function notify() {
  for (const listener of listeners) listener();
}

function readDismissed(): string {
  try {
    const stored = window.localStorage.getItem(RECAP_DISMISSED_STORAGE_KEY);
    return stored ?? dismissedHere;
  } catch {
    return dismissedHere;
  }
}

function dismissRecap(key: string): void {
  const next = withRecapDismissal(readDismissed(), key);
  dismissedHere = next;
  try {
    window.localStorage.setItem(RECAP_DISMISSED_STORAGE_KEY, next);
  } catch {
    // Hidden for this page load only.
  }
  notify();
}

/** A dismissal in another tab (the page often sits beside chat in two). */
function onStorage(event: StorageEvent) {
  if (event.key === RECAP_DISMISSED_STORAGE_KEY || event.key === null) {
    notify();
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Test seam: back to a fresh page. */
export function resetRecapDismissalForTests(): void {
  dismissedHere = "";
  listeners.clear();
  window.removeEventListener("storage", onStorage);
}

/**
 * Last week, under the week card on Activity on Sunday to Tuesday (#4983):
 * what the member did in their last finished week, as Slack's and Linear's
 * weekly digests sum one up, from `GET /v1/activity/recap`. The week card
 * says this week in progress; this says the week that just closed, once,
 * and then gets out of the way: dismissed, it stays gone until next week's.
 *
 * Only what the member did is drawn (`activityRecapCard`): a module that is
 * off, a part that couldn't be read and a zero are left out, a week with
 * nothing to show draws no card at all, and neither does a day after
 * Tuesday, whatever the cache still holds.
 */
export function RecapCard({ recap, now }: { recap: ActivityRecap; now: Date }) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => "");
  const chapterId = useActiveChapterId();
  const card = activityRecapCard(recap, now);
  if (!card || !chapterId) return null;
  const key = recapDismissalKey(chapterId, card);
  if (recapDismissed(dismissed, key)) return null;
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
          onClick={() => dismissRecap(key)}
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
