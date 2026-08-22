"use client";

import { AlertTriangle, FolderOpen, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The shared state family — `spec/ui/design-system/README.md` §4 names this
 * file as what web dashboards use, and `components.md` §10 specs the anatomy:
 * skeleton, empty and error read as **one family**, clearly distinct at a
 * glance, differing in colour rather than in shape.
 *
 * The three §10 rules this file previously broke, all of them now fixed:
 *
 * 1. **"No spinner-in-a-box."** `LoadingState` was a spinning `LoaderCircle`
 *    in a dashed box, which is the one loading treatment §10 rules out. It is
 *    now content-shaped by default and takes a `children` skeleton for the
 *    surfaces that can mirror their own layout. The *caption* stays visible:
 *    §10 bans the spinner, not the label, and ~25 call sites pass a specific
 *    one ("Loading chapter polls…"), which is information a sighted user would
 *    otherwise lose to four anonymous grey bars.
 * 2. **Skeletons are neutral only — never accent.** The deleted
 *    `components/ui/skeleton.tsx` filled with `bg-primary/10`, i.e. the chapter
 *    accent. `Skeleton` below is the elevated neutral with §10's shimmer.
 * 3. **Empty is accent + neutral; error is semantic; neither borrows the
 *    other's colour.** `OfflineState` painted itself in `--primary` — the
 *    chapter accent stating a fact about the network. It now takes the
 *    destructive tint, matching `offline-banner.tsx` so the same condition
 *    reads the same whether it is announced in the banner or in the panel.
 */

/**
 * One neutral placeholder block.
 *
 * The shimmer is a CSS class rather than a utility chain so every block on a
 * surface shares one animation phase — that is what makes a multi-block
 * skeleton read as a single sheet of content arriving rather than as N
 * rectangles pulsing out of step. Recipe and its reduced-motion branch live in
 * `packages/theme/src/signet.css`.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-shimmer rounded-[6px]", className)}
    />
  );
}

/**
 * §10's text-line shape: 13px tall, radius 6, widths varied across ~45–70% so
 * the block reads as prose rather than as a bar chart. The widths cycle rather
 * than randomise — a skeleton that reshuffles on every render flickers, and
 * under React Strict Mode it would differ between the two passes.
 */
const SKELETON_LINE_WIDTHS = ["w-[70%]", "w-[55%]", "w-[62%]", "w-[45%]"] as const;

/**
 * A placeholder is never worth a crash or a runaway render, and `lines` is a
 * public prop on a shared primitive — a caller deriving it from an item count
 * can hand us `Infinity` (which makes `Array.from` throw outright) or some
 * unbounded number. Clamped to a range that can still only ever be decoration.
 */
const MAX_SKELETON_LINES = 12;

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const count = Number.isFinite(lines)
    ? Math.min(Math.max(Math.floor(lines), 0), MAX_SKELETON_LINES)
    : MAX_SKELETON_LINES;

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          key={index}
          className={cn(
            "h-[13px]",
            SKELETON_LINE_WIDTHS[index % SKELETON_LINE_WIDTHS.length]
          )}
        />
      ))}
    </div>
  );
}

/**
 * The default loading state: card chrome with skeleton lines in it.
 *
 * `children` is the escape hatch §10 actually wants — a surface that knows its
 * own layout passes a skeleton mirroring it ("same blocks, same radii"). The
 * default is the generic fallback for surfaces that have not been trued up
 * yet, and it is still content-shaped rather than a spinner.
 *
 * `message` stays visible. The default skeleton is generic rather than a mirror
 * of any particular screen, so the caption is doing real work — it is the only
 * thing that says *what* is loading. `role="status"` announces it once to
 * assistive tech; the skeleton blocks themselves are `aria-hidden`.
 */
export function LoadingState({
  message = "Loading data...",
  children,
}: {
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-52 flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      {children ?? <SkeletonText lines={4} />}
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * The 44px icon tile §10 gives empty and error alike, recoloured per state.
 *
 * Exported for `nested-states.tsx`, which composes the same §10 anatomy on a
 * surface that already is a card. Re-declaring it there would put two spellings
 * of one tile in the tree, which is what the cutover rule forbids.
 */
export function StateTile({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "accent" | "destructive";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-lg",
        tone === "accent"
          ? "bg-accent-subtle text-accent-text"
          : "bg-destructive/[.13] text-destructive-text"
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
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
  /**
   * Extra props for the action button — shaped to take `controlProps()` from
   * `useSubscriptionGate` directly, so an empty-state CTA that starts a gated
   * write can be disabled and described rather than hidden (§5 rule 4). An
   * empty state is exactly where hiding reads worst: the screen already has
   * nothing on it, so a vanished CTA looks like a broken page.
   */
  actionProps?: {
    disabled?: boolean;
    "aria-describedby"?: string;
  };
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-4 text-center">
      <StateTile tone="accent">
        <FolderOpen className="h-6 w-6" />
      </StateTile>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="max-w-[220px] text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        // §10: the empty-state CTA is the Tinted button — accent-soft, inviting,
        // never alarming and never semantic.
        <Button variant="tinted" size="sm" onClick={onAction} {...actionProps}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = "Unable to load data",
  description = "Please retry in a moment.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    // The one sanctioned semantic border (§10) — 28% of danger, not a solid.
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/[.28] bg-card p-4 text-center">
      <StateTile tone="destructive">
        <AlertTriangle className="h-6 w-6" />
      </StateTile>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="max-w-[220px] text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        // §10 names Secondary for retry, deliberately: an error surface must not
        // use the chapter accent, which rules out both Primary and Tinted.
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function OfflineState({
  title = "You're offline",
  description = "Reconnect to sync chapter data and retry this workflow.",
  actionLabel = "Retry now",
  onRetry,
}: {
  title?: string;
  description?: string;
  actionLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/[.28] bg-card p-4 text-center">
      <StateTile tone="destructive">
        <WifiOff className="h-6 w-6" />
      </StateTile>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="max-w-[220px] text-sm text-muted-foreground">{description}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The offline state for a **control slot** — the third container variant.
 *
 * `OfflineState` above paints `--card` and reserves `min-h-52`, which is right
 * where the state replaces a screen. `NestedOffline` (`nested-states.tsx`)
 * drops the fill for a state inside a card it cannot rise above. Neither fits
 * the third case #1211 surfaced: `<Can>` standing in for a *single control* —
 * an Upload button in a toolbar, a row action in a table cell — where a 208px
 * card is not a smaller version of the right answer, it is the wrong object.
 * So this is the same family at control scale: same `WifiOff` glyph, same
 * destructive-tinted tone, same Retry, laid out as one inline row.
 *
 * It carries **no fill and no border**. §10's hairline is the load-bearing
 * edge for a *region*; this is not a region, and a bordered chip where a
 * button was reads as a disabled button rather than as a statement about the
 * network. The glyph and the caption carry it, which is what the shell's
 * `offline-banner.tsx` already does for the same condition one layer up.
 *
 * `min-h-11` rather than a height: the row must clear §2's touch floor for the
 * Retry inside it, but it also has to be free to wrap at 375px rather than
 * push its container wide.
 *
 * Copy names the blocker and the next action (`writing.md` §1). It says
 * "access" rather than "permissions" because the member is not the one who
 * holds them — what they can act on is whether to retry.
 */
export function PermissionsOffline({
  onRetry,
  className,
}: {
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
        className
      )}
    >
      <WifiOff aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>Offline &mdash; can&apos;t check your access.</span>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
