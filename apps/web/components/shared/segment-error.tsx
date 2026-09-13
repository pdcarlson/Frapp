"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorState } from "@/components/shared/async-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { isChunkLoadError } from "@/lib/chunk-load-error";

/**
 * The degraded-segment surface: what a member sees when one part of the
 * dashboard fails to render and the rest of the app is still fine.
 *
 * ## Why this is not `CrestPage`
 *
 * `app/error.tsx` paints the 500 crest, and that is right for what it catches —
 * it sits at the root segment, so the thing that failed is the page. This
 * boundary catches *below* the dashboard layout, with the nav and the top bar
 * still rendered and still working, and `CrestPage` is `min-h-screen` with a
 * 260px raster: dropped into the shell's content column it would paint a second
 * full-viewport takeover inside a viewport that is not gone. `components.md`
 * §10's Error variant is the surface for a region that failed, and
 * `(dashboard)/loading.tsx` already reaches for its sibling `LoadingState` for
 * the same slot. So this renders §10's card and `app/error.tsx` keeps the
 * crest; the two are different objects because they stand in for different
 * amounts of missing product.
 *
 * ## Why the copy and the button change with the error
 *
 * A `ChunkLoadError` means this tab is running a build whose assets are no
 * longer being served. Only loading the document again picks up the current
 * one, so that is what the button offers.
 *
 * **The tempting stronger claim is wrong, and is worth writing down because the
 * first draft of this file shipped it.** It is not true that Retry "provably
 * cannot succeed" here. `retry()` re-renders the *segment*, and the two splits
 * this boundary covers — the emoji picker's popover and the composer's slash
 * palette — are opened by state the remount discards, so the page comes back
 * with the lazy component never rendered and `/chat` returns intact. What is
 * true is narrower: `React.lazy` has memoised the rejection for the life of the
 * document (`lib/chunk-load-error.ts` carries that evidence), so the *control*
 * that failed will fail again the moment it is touched. Retry restores the
 * page around a button that is still dead; Reload clears the condition. That is
 * the reason to prefer it, and it is a weaker reason than the one this file
 * used to give.
 *
 * Both strings are `writing.md` §3's three parts — what failed, why, what to do
 * next. The chunk description hedges with "usually" on purpose: a
 * `ChunkLoadError` is *typically* a rotated build hash but can equally be a
 * flaky network, and §3 asks for the reason only "if known". Stating the deploy
 * as fact would be inventing one.
 *
 * ## Offline is a third case, not the chunk case
 *
 * A member who is offline gets a `ChunkLoadError` too, for a chunk that was
 * simply never fetched — and reloading is then the worst thing this surface
 * could offer. `apps/web` registers no service worker, so a reload cannot fetch
 * the document at all: it would replace a working, cache-backed dashboard with
 * the browser's own offline page, and there would be no way back until the
 * connection returned. So when `useNetwork()` says offline, the surface says
 * so and offers Retry, which costs nothing and works the moment the connection
 * does.
 *
 * ## Reporting
 *
 * Both cases report. #2175's predecessor note on `app/error.tsx` is the rule
 * here too: catching an error lower in the tree without `captureException`
 * would leave the product looking better and reporting less, which is the worst
 * trade available on an error surface.
 *
 * **Reporting is keyed on the error, not on the mount**, and the distinction is
 * one this file originally got wrong. `useEffect` alone dedupes only within a
 * single mount, and this fallback remounts often: React tears the subtree down
 * and rebuilds it on every boundary reset, so each press of Retry re-reported
 * the identical error, and the gate's copy re-reported on every dashboard
 * navigation, unbounded in session length. The `WeakSet` makes one error one
 * event however many times it is re-thrown, and being weak it holds nothing
 * alive.
 */
const REPORTED = new WeakSet<object>();
/**
 * The one spelling of the title, written once.
 *
 * `writing.md` §7 pins it as the part that does **not** vary between the two
 * rows, so two literals would be a fork the tests could not see: each branch's
 * assertion would pass against its own copy while the table stopped being true.
 */
const SEGMENT_ERROR_TITLE = "Couldn't load this page";

/**
 * The copy and the remedy for one error, resolved in one place.
 *
 * Exported because a call site that renders this surface inside a dialog needs
 * the title for the dialog's accessible name, and the alternative — retyping it
 * at that call site — is the fork this module exists to avoid.
 */
export function segmentErrorCopy(
  error: unknown,
  isOffline = false,
): {
  title: string;
  description: string;
  actionLabel: string;
  isChunkError: boolean;
  shouldReload: boolean;
} {
  const isChunkError = isChunkLoadError(error);

  if (isChunkError && isOffline) {
    // `writing.md` §7's global offline row states the connection, not a
    // failure: nothing is broken here, and the chunk will fetch when the
    // connection returns.
    return {
      title: SEGMENT_ERROR_TITLE,
      description: "You're offline, so part of this page couldn't load. Retry once you're back.",
      actionLabel: "Retry",
      isChunkError,
      shouldReload: false,
    };
  }

  if (isChunkError) {
    return {
      title: SEGMENT_ERROR_TITLE,
      description:
        "This usually means a new version shipped while the tab was open. Reload to pick it up.",
      actionLabel: "Reload",
      isChunkError,
      shouldReload: true,
    };
  }

  return {
    title: SEGMENT_ERROR_TITLE,
    description: "The error has been reported. Retrying usually clears it.",
    actionLabel: "Retry",
    isChunkError,
    shouldReload: false,
  };
}

export function SegmentError({
  error,
  retry,
  title,
  headingLevel,
}: {
  error: unknown;
  retry: () => void;
  /**
   * Overrides the title for a call site where "this page" is the wrong subject.
   *
   * The chapter wizard gate is the one that needs it: the page behind it loaded
   * perfectly well and only the dialog did not, so the default title would name
   * the wrong failure — which is `writing.md` §3's first part, and the part a
   * member reads first. The description and the remedy are unchanged, because
   * those do not depend on which surface failed.
   */
  title?: string;
  headingLevel?: "h1" | "h2";
}) {
  const { isOffline } = useNetwork();
  const copy = segmentErrorCopy(error, isOffline);
  const { description, actionLabel, isChunkError, shouldReload } = copy;

  useEffect(() => {
    // Keyed on the error rather than the mount — see the docstring. A
    // non-object (a thrown string, which a boundary can be handed) cannot go in
    // a WeakSet, so it is reported unconditionally; those are rare enough that
    // the duplicate is cheaper than the bookkeeping to dedupe them.
    if (typeof error === "object" && error !== null) {
      if (REPORTED.has(error)) return;
      REPORTED.add(error);
    }
    Sentry.captureException(error, {
      tags: { chunk_load_error: isChunkError },
    });
  }, [error, isChunkError]);

  return (
    <ErrorState
      title={title ?? copy.title}
      description={description}
      actionLabel={actionLabel}
      headingLevel={headingLevel}
      onRetry={shouldReload ? () => window.location.reload() : retry}
    />
  );
}
