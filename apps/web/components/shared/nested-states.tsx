"use client";

import { AlertTriangle, FolderOpen, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonText, StateTile } from "@/components/shared/async-states";

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
 * `sole` — "this nested state is the whole page's async state".
 *
 * Two of this module's compromises exist because a nested state is normally
 * *one of several*: the live region is left to the top-level `LoadingState`
 * that owns the screen, and the title is a `<p>` rather than an `<h2>` because
 * `/billing` renders two of these from one query and produced two identical
 * headings back to back. Both are right for `/points`, `/billing` and the
 * attendance sheet, which was every consumer when this module was written.
 *
 * Neither holds on a page whose nested state is its *only* state. The
 * Resources & Reporting slice moved `/documents` and `/backwork` onto this
 * family to fix the 1.00:1 fill collision and, in doing so, took away the one
 * announcement each page had *and* the only heading its error and empty states
 * had — `CardTitle` renders a `<div>`, so nothing else nearby is a heading.
 * Two changes each correct on their own.
 *
 * One prop rather than two, because it is one distinction. It turns on the
 * live region where the state is a spinner and promotes the title to a heading
 * where the state has one. Defaulting off keeps every pre-existing consumer,
 * and the tests asserting no live region while settled, exactly as they were.
 */

/**
 * `role="status"` is **opt-in**, and defaults off.
 *
 * `aria-busy` alone is not announced by assistive tech without an
 * accompanying role, so a page whose only state is this one is silent without
 * `sole`. See the note above.
 */
export function NestedLoading({
  message,
  lines = 3,
  sole = false,
}: {
  message: string;
  lines?: number;
  /** This is the page's only async state — see the note above. */
  sole?: boolean;
}) {
  return (
    <div
      aria-busy="true"
      role={sole ? "status" : undefined}
      aria-live={sole ? "polite" : undefined}
      className="flex min-h-40 flex-col gap-4 rounded-lg border border-border p-4"
    >
      <SkeletonText lines={lines} />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function NestedEmpty({
  sole = false,
  title,
  description,
  actionLabel,
  onAction,
  actionProps,
}: {
  /** This is the page's only async state — see the note above `NestedLoading`. */
  sole?: boolean;
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
      {sole ? (
        <h2 className="text-base font-bold">{title}</h2>
      ) : (
        <p className="text-base font-bold">{title}</p>
      )}
      <p className="max-w-[220px] text-sm text-muted-foreground">
        {description}
      </p>
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
  sole = false,
  title,
  description,
  onRetry,
  retryProps,
}: {
  /** This is the page's only async state — see the note above `NestedLoading`. */
  sole?: boolean;
  title: string;
  description: string;
  onRetry?: () => void;
  /**
   * Passed through to the Retry button, mirroring `NestedEmpty`'s
   * `actionProps` — so a surface whose retry re-enters a mutation that is
   * already in flight can disable it rather than hide it (§5 rule 4). Hiding
   * would also drop the row a keyboard user may already be on.
   */
  retryProps?: { disabled?: boolean; "aria-describedby"?: string };
}) {
  return (
    <div className={`${NESTED_BOX} border-destructive/[.28]`}>
      <StateTile tone="destructive">
        <AlertTriangle className="h-6 w-6" />
      </StateTile>
      {sole ? (
        <h2 className="text-base font-bold">{title}</h2>
      ) : (
        <p className="text-base font-bold">{title}</p>
      )}
      <p className="max-w-[220px] text-sm text-muted-foreground">
        {description}
      </p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} {...retryProps}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The fourth member, which this family did not have until `/documents` and
 * `/backwork` needed one.
 *
 * `async-states.tsx` has drawn a distinct `OfflineState` since the shell
 * slice — same box as the error, but a `WifiOff` glyph rather than the
 * danger triangle — and every offline surface in the app shows it. The nested
 * family stopped at three, so the first two screens to render an offline state
 * *inside* a card reached for `NestedError` and told a member with a dropped
 * connection that something had failed.
 *
 * Same tone as the error deliberately: `resilience.md` treats a lost
 * connection as a degraded read, and §10 requires this family to differ in
 * colour rather than in shape. The glyph is what separates them, exactly as it
 * does at the top level.
 */
export function NestedOffline({
  sole = false,
  title,
  description,
  onRetry,
}: {
  /** This is the page's only async state — see the note above `NestedLoading`. */
  sole?: boolean;
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className={`${NESTED_BOX} border-destructive/[.28]`}>
      <StateTile tone="destructive">
        <WifiOff className="h-6 w-6" />
      </StateTile>
      {sole ? (
        <h2 className="text-base font-bold">{title}</h2>
      ) : (
        <p className="text-base font-bold">{title}</p>
      )}
      <p className="max-w-[220px] text-sm text-muted-foreground">
        {description}
      </p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
