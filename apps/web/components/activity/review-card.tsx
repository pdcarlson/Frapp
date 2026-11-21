"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import {
  ACTIVITY_GLYPH_NAV,
  ACTIVITY_REVIEW_OPEN_LIMIT,
  ACTIVITY_REVIEW_ROW_LIMIT,
  activityCouldNotLoad,
  type ActivityReview,
  type ActivityRow,
} from "@repo/hooks";
import { NavGlyph } from "@/components/layout/nav-glyphs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * "To review" on `/activity` (#4766): what waits on an officer's sign-off
 * (finished tasks to confirm, service hours to approve) as one card with one
 * count, where two count tiles and a run of rows mixed into the member's own
 * list were. The phone's card
 * (`apps/mobile/components/activity/review-card.tsx`) on web, from the same
 * model (`activityReview`). Google Classroom gives a teacher one "To review"
 * apart from their own to-dos; so does this. The week ring never counts
 * these: reviewing is the officer's queue, not their week.
 *
 * Closed, it is one row: the count and what it is made of. Pressed, it opens
 * in place to the rows, longest waiting first, each with its one-press
 * Confirm or Approve (#4402) and its panel behind the rest of the row. A
 * queue of three or fewer starts open, so a chair's two confirmations are
 * still one press each; the president's fourteen wait behind the count. The
 * page draws it only when something waits or a part behind it failed to load
 * (`activityReview` returns `null` otherwise), so a member, and an officer
 * with an empty queue, sees no card and no zero.
 */
export function ReviewCard({
  review,
  renderRow,
}: {
  review: ActivityReview;
  /** The page's row for one of the queue, as a list item. */
  renderRow: (row: ActivityRow) => ReactNode;
}) {
  // A short queue is open from the start, so its one-press Confirm stays
  // one press; a long one waits behind its count. Decided once, when the
  // card first has rows: a queue that grows past the limit on a re-read must
  // not close under the officer mid-way through it (and take the focus the
  // one-press Confirm hands to the next row), nor a long one open itself as
  // it shrinks. Only a press changes it after that.
  const [decided, setDecided] = useState<boolean | null>(null);
  // Adjusted while rendering, as React documents for state that follows a
  // prop: no frame is drawn before the choice.
  if (decided === null && review.rows.length > 0) {
    setDecided(review.rows.length <= ACTIVITY_REVIEW_OPEN_LIMIT);
  }
  const open = decided ?? true;
  const [all, setAll] = useState(false);
  const cappable = review.rows.length > ACTIVITY_REVIEW_ROW_LIMIT;
  const rows =
    cappable && !all
      ? review.rows.slice(0, ACTIVITY_REVIEW_ROW_LIMIT)
      : review.rows;
  const failed =
    review.unavailable.length > 0
      ? `${activityCouldNotLoad(review.unavailable)} Try again in a moment.`
      : null;
  const hasRows = review.rows.length > 0;
  const head = (
    <>
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-1 text-muted-foreground"
      >
        <NavGlyph
          paths={NAV_GLYPHS[ACTIVITY_GLYPH_NAV.confirm]}
          className="h-5 w-5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          To review
        </span>
        {review.detail ? (
          <span className="block truncate text-caption text-muted-foreground">
            {review.detail}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <Card data-testid="activity-review-card">
      <section aria-labelledby="activity-review">
        <h2 id="activity-review" className="sr-only">
          To review
        </h2>
        {hasRows ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? "activity-review-rows" : undefined}
            aria-label={`To review, ${review.count}${
              review.detail ? `: ${review.detail}` : ""
            }`}
            onClick={() => setDecided(!open)}
            data-testid="activity-review-toggle"
            className={cn(
              "flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2 text-left transition-colors hover:bg-card-hover",
              FOCUS_RING,
            )}
          >
            {head}
            <Badge variant="default" className="shrink-0 tabular-nums">
              {review.count}
            </Badge>
            {open ? (
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </button>
        ) : (
          // Nothing to open: only the part that failed is named below.
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            {head}
          </div>
        )}
        {failed ? (
          <p className="px-4 pb-3 text-caption text-warning">{failed}</p>
        ) : null}
        {open && hasRows ? (
          <div id="activity-review-rows" className="px-2 pb-2">
            <ul className="divide-y divide-border border-t border-border">
              {rows.map((row) => renderRow(row))}
            </ul>
            {cappable ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="px-2"
                aria-expanded={all}
                onClick={() => setAll((shown) => !shown)}
              >
                {all ? "Show fewer" : `Show all ${review.count}`}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
