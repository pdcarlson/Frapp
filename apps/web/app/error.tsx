"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { CrestPage } from "@/components/shared/crest-page";
import { Button } from "@/components/ui/button";
import { isChunkLoadError } from "@/lib/chunk-load-error";
import { useNetwork } from "@/lib/providers/network-provider";

/**
 * The route error boundary — board `1k`'s note: *"Error page uses the same
 * layout with the code swapped (500), 'Something broke on our side.' and a
 * Retry primary."*
 *
 * ## This boundary did not exist, and adding it would have silently cut error
 * reporting
 *
 * With no `error.tsx`, every render error below the root layout bubbled all the
 * way to `global-error.tsx`, which reports to Sentry. Catching those here
 * without `captureException` would have left the product looking better and
 * reporting less, which is the worst possible trade on an error surface. So the
 * reporting moves with the boundary, in a `useEffect` for `global-error`'s
 * reason: React may render a component more than once for a single error, and
 * reporting during render would duplicate the event.
 *
 * ## Why this one may use `Button` where `global-error` may not
 *
 * `global-error.tsx`'s docstring bans importing the component tree, because it
 * replaces the root layout and is the last thing standing. That argument does
 * not reach here, and the reason is the layering: this boundary renders *inside*
 * a root layout that already succeeded, and if `Button` itself were the thing
 * that broke, this component throws and `global-error` catches it and paints its
 * dependency-free screen. `global-error` is what makes using the design system
 * here safe; do not "consolidate" the two.
 *
 * The description completes `writing.md` §3's three parts, which the board's
 * one-line note does not state — the title is what failed, and a reader still
 * needs to know it was reported and what to do next.
 *
 * ## The recovery prop is `retry`, not `reset`
 *
 * Next 16 renamed it, and both still exist, so reaching for `reset` from memory
 * type-checks and ships the wrong behaviour rather than an error.
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`:
 * `retry()` "will try to re-fetch and re-render the error boundary's children",
 * while `reset()` re-renders them "without re-fetching the contents" and is
 * documented as the exception ("In most cases, you should use `retry()`
 * instead"). A button labelled Retry that does not re-fetch would replay the
 * same failed render against the same stale cache, which is a Retry that cannot
 * succeed — so this takes `retry`.
 *
 * `global-error.tsx` one boundary down still takes `reset`. That is pre-existing
 * and left alone here rather than widened into: it is a different file with its
 * own constraints, and its button says "Reload the dashboard", which is a claim
 * neither function actually makes.
 *
 * ## Retry is Secondary, and it is the only action
 *
 * Board `1k`'s note says "a Retry primary", and `components.md` §10's Error row
 * says "Retry | Secondary button, 44px, radius 12" under the rule "Error
 * surfaces MUST NOT use the chapter accent". They are reconcilable: the board
 * means Retry is *the* action, not that it takes the Primary variant, and the
 * board cannot see the distinction anyway because its demo tenant makes the
 * chapter accent and the house gold the same hex. §10 can, so §10 decides the
 * paint and `tone="error"` holds the eyebrow at house gold.
 *
 * It is also alone deliberately. A second "Back to chat" is a dead end for
 * exactly the people most likely to land here: this boundary sits at the root
 * segment, so it catches `/sign-in`, `/sign-up` and `/no-access` too, and
 * `proxy.ts` bounces a signed-out visitor off `/chat` straight back to
 * `/sign-in` — while a member on `/no-access` would be offered the one route
 * they are being redirected away from.
 *
 * ## A stale chunk gets Reload, not Retry (#2200)
 *
 * A `ChunkLoadError` reaches this boundary from `(dashboard)/layout.tsx` (a
 * route `error.tsx` does not wrap the layout above it) and from the pre-auth
 * routes, which sit above the `(dashboard)` group. `React.lazy` memoises the
 * rejection for the life of the document, so Retry re-renders into the same
 * failure; only a reload fetches the new build. `lib/chunk-load-error.ts` has
 * the mechanism and what not to overstate about it.
 *
 * Offline keeps Retry, as `segment-error.tsx` does and for its reason:
 * `apps/web` registers no service worker, so a reload with no link replaces
 * the tab with the browser's offline page. That loses nothing on a pre-auth
 * route, but this boundary also catches the dashboard layout, where it would
 * throw away a working session. It reads `linkOnline`, not `isOffline`, for
 * `segment-error.tsx`'s reason too: an API outage on a working link is not a
 * case where a reload cannot fetch the document.
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { linkOnline } = useNetwork();
  const isChunkError = isChunkLoadError(error);
  const shouldReload = isChunkError && linkOnline;

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <CrestPage
      code="500"
      tone="error"
      title="Something broke on our side."
      description={
        shouldReload
          ? "This usually means a new version shipped while the tab was open. Reload to pick it up."
          : isChunkError
            ? "You're offline, so this page couldn't load. Retry once you're back."
            : "The error has been reported. Retrying usually clears it."
      }
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={() => (shouldReload ? window.location.reload() : retry())}
      >
        {shouldReload ? "Reload" : "Retry"}
      </Button>
    </CrestPage>
  );
}
