"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorState } from "@/components/shared/async-states";
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
 * Because for one class of failure the ordinary Retry cannot succeed — see
 * `lib/chunk-load-error.ts`, which carries the evidence. A stale chunk needs
 * the document reloaded; everything else wants Next's `retry()`, which
 * re-fetches and re-renders. Offering "Retry" for a rejected chunk would be
 * `writing.md` §1's banned shape in the worst way: not vague, but actively
 * false about what the button does.
 *
 * Both strings are `writing.md` §3's three parts — what failed, why, what to do
 * next. The chunk description hedges with "usually" on purpose: a
 * `ChunkLoadError` is *typically* a rotated build hash but can equally be a
 * flaky network, and §3 asks for the reason only "if known". Stating the deploy
 * as fact would be inventing one.
 *
 * ## Reporting
 *
 * Both cases report. #2175's predecessor note on `app/error.tsx` is the rule
 * here too: catching an error lower in the tree without `captureException`
 * would leave the product looking better and reporting less, which is the worst
 * trade available on an error surface. `useEffect` rather than a call during
 * render, because React may render a component more than once for a single
 * error and reporting in the body would duplicate the event.
 *
 * The chunk case is tagged rather than dropped. It is genuinely lower-signal
 * than a logic bug — a handful are expected after every deploy, from tabs that
 * were open across it — but "expected" is not "uninteresting": a *sustained*
 * rate is how a broken CDN or a botched asset upload announces itself, and that
 * is invisible if these never arrive. The tag is what lets Sentry separate the
 * two without this file deciding which is which.
 */
export function SegmentError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const isChunkError = isChunkLoadError(error);

  useEffect(() => {
    Sentry.captureException(error, {
      tags: { chunk_load_error: isChunkError },
    });
  }, [error, isChunkError]);

  if (isChunkError) {
    return (
      <ErrorState
        title="Couldn't load this page"
        description="This usually means a new version shipped while the tab was open. Reload to pick it up."
        actionLabel="Reload"
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <ErrorState
      title="Couldn't load this page"
      description="The error has been reported. Retrying usually clears it."
      actionLabel="Retry"
      onRetry={retry}
    />
  );
}
