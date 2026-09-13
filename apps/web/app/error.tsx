"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { CrestPage } from "@/components/shared/crest-page";
import { Button } from "@/components/ui/button";

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
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <CrestPage
      code="500"
      tone="error"
      title="Something broke on our side."
      description="The error has been reported. Retrying usually clears it."
    >
      <Button size="sm" variant="secondary" onClick={() => retry()}>
        Retry
      </Button>
    </CrestPage>
  );
}
