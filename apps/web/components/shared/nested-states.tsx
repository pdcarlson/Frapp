"use client";

import { AlertTriangle, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SkeletonText,
  StateTile,
} from "@/components/shared/async-states";

/**
 * The §10 state family for a state that renders **inside** a `<CardContent>`.
 *
 * `async-states.tsx` is correct for a state that replaces a whole screen: it
 * paints `--card`, which is the step a top-level panel should occupy. Six call
 * sites across the Directory & Finance family rendered one of those *inside* a
 * card instead — `bg-card` on `bg-card`, i.e. **1.00:1**, the same defect the
 * chat slice found when a `--card` bubble was asked to sit on a `--card` pane.
 * A nested state was therefore a card-shaped region whose only edge was its
 * hairline, wrapped in another card whose edge was the same hairline.
 *
 * The fix is to drop the *fill*, not the border. Signet carries elevation on
 * luminance and one step is ~1.12:1, so the hairline is the load-bearing edge
 * (components.md §2) — take it away and the region has no boundary at all. What
 * collides is the fill, and inside a card the fill is already there.
 *
 * Shape is deliberately unchanged from the top-level family. §10 requires
 * skeleton, empty and error to "read as one family … differing in colour rather
 * than in shape", so these keep the tile, the title, the body and the CTA in the
 * same arrangement, and the error keeps §10's one sanctioned semantic border.
 * The alternative — dropping the border on some variants and not others — would
 * have made them differ by shape, and would have invented a dashed placeholder
 * idiom that neither reference board draws.
 *
 * `min-h-40` rather than `min-h-52`: the containing card supplies its own
 * padding, and a nested state that reserves the full top-level height pushes
 * the card taller than the content it is standing in for.
 *
 * The title is a `<p>`, not the `<h2>` the top-level family uses. A state that
 * replaces a screen is that screen's section; a state standing in for a card's
 * *contents* is not a document section, and `/billing` proved the difference —
 * it renders two of these from the same query, so two `<h2>No invoices yet</h2>`
 * landed back to back and a reader navigating by heading got two identical
 * landmarks with nothing to tell them apart. The text is styled identically and
 * still read in order; it just no longer claims to be an outline entry.
 */

const NESTED_BOX =
  "flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border p-4 text-center";

/**
 * `role="status"` is deliberately absent. The top-level `LoadingState` owns the
 * announcement for the screen; a nested block inside an already-announced card
 * would either double it or, on the surfaces whose tests assert no live region
 * is present while settled, introduce one where none belongs.
 */
export function NestedLoading({
  message,
  lines = 3,
}: {
  message: string;
  lines?: number;
}) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-40 flex-col gap-4 rounded-lg border border-border p-4"
    >
      <SkeletonText lines={lines} />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function NestedEmpty({
  title,
  description,
  actionLabel,
  onAction,
  actionProps,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionProps?: {
    disabled?: boolean;
    "aria-describedby"?: string;
  };
}) {
  return (
    <div className={`${NESTED_BOX} border-border`}>
      <StateTile tone="accent">
        <FolderOpen className="h-6 w-6" />
      </StateTile>
      <p className="text-base font-bold">{title}</p>
      <p className="max-w-[220px] text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <Button variant="tinted" size="sm" onClick={onAction} {...actionProps}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * `title` and `description` are required rather than defaulted. The top-level
 * `ErrorState` defaults to "Unable to load data" / "Please retry in a moment.",
 * and the second is the shape `writing.md` §1 bans by name — vague copy that
 * states no failure, no reason and no next step. Every caller here supplies
 * §7's own strings; requiring them means the next caller cannot ship the banned
 * copy by forgetting a prop.
 */
export function NestedError({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className={`${NESTED_BOX} border-destructive/[.28]`}>
      <StateTile tone="destructive">
        <AlertTriangle className="h-6 w-6" />
      </StateTile>
      <p className="text-base font-bold">{title}</p>
      <p className="max-w-[220px] text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
