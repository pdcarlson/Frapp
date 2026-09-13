"use client";

import { SegmentError } from "@/components/shared/segment-error";

/**
 * The `(dashboard)` segment's error boundary — #2175.
 *
 * ## What it is for
 *
 * #2145 added the first `next/dynamic` splits to `apps/web`. `next/dynamic` is
 * `React.lazy` + Suspense, and Suspense catches suspension, not rejection, so a
 * chunk that is no longer on the CDN after a build hash rotates throws to the
 * nearest error boundary. Before this file the nearest one was `app/error.tsx`
 * at the root segment, which paints a full-viewport 500 crest: clicking the
 * emoji button in `/chat` replaced the entire app over a failure confined to
 * one popover.
 *
 * Sitting here instead, the boundary replaces the shell's content column and
 * nothing else. The nav and the top bar are rendered by
 * `(dashboard)/layout.tsx`, which is *above* this boundary, so they survive and
 * a member can navigate straight out of the broken segment. That is the whole
 * point of the file, and it is the reason it is at the group root rather than
 * on `/chat`: the exposure is the standard cost of code splitting rather than
 * anything specific to chat, so it wants one general answer.
 *
 * **What it does not save, stated so nobody reads more into it.** The content
 * column is where the composer lives, so a rejection on `/chat` still unmounts
 * it, and `pending` — the staged-attachment array — is plain `useState` with no
 * Dexie behind it, so staged files are still lost. The draft text survives
 * because the composer persists that itself. What this file buys is the shell
 * and the route, not the composer's in-memory state; saving that is a boundary
 * nearer the picker, which is a separate change and a larger one.
 *
 * ## What it deliberately does not catch, and where that is handled
 *
 * Next's own reference is explicit: `error.js` "wraps `loading.js`,
 * `not-found.js`, `page.js`, and nested `layout.js` files ... It does **not**
 * wrap the `layout.js` or `template.js` above it in the same segment"
 * (`next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`). So
 * this file cannot see anything thrown by `(dashboard)/layout.tsx` — including
 * `DashboardShell`, and therefore including `<ChapterWizardGate />`, which is
 * the third of #2145's splits and the only one on the shell path.
 *
 * That is not an oversight to be fixed by moving this file; no placement of a
 * route `error.tsx` can cover a component its own layout renders. The gate
 * carries its own `catchError` boundary instead, in
 * `components/onboarding/chapter-wizard-gate.tsx`, rendering the same
 * `SegmentError` surface. Two boundaries, one spelling of the failure.
 *
 * ## The recovery prop is `retry`, not `reset`
 *
 * The same trap `app/error.tsx` documents: Next 16 renamed it and both still
 * exist, so reaching for `reset` from memory type-checks and ships the wrong
 * behaviour rather than an error. `retry()` "will try to re-fetch and re-render
 * the error boundary's children"; `reset()` re-renders "without re-fetching"
 * and the reference names it the exception ("In most cases, you should use
 * `retry()` instead").
 *
 * ## The wrapper is not decoration
 *
 * The first draft rendered the state bare, for parity with
 * `(dashboard)/loading.tsx` in the same slot. That parity argument only holds
 * on the padded routes. `<main>` drops its gutter entirely on a full-bleed
 * route (`dashboard-shell.tsx`: `fullBleed ? "overflow-hidden" : "... px-4 py-4
 * sm:px-6"`), so on `/chat` — the route this whole change is motivated by — the
 * card painted flush against the nav rail, the top bar and the viewport edge,
 * full width and pinned to the top. `p-4` here is inert where `<main>` already
 * pads and is the whole gutter where it does not; `max-w-md` stops a 208px card
 * stretching the width of a 1440px display, which is the other half of what
 * `CrestPage` was doing for free before.
 *
 * ## It renders the `h1`
 *
 * Not a detail: this boundary renders *instead of* the page, and the page's
 * `PageHeader` is what owns the route's only `h1` now that the shell's was
 * deleted. Left at `ErrorState`'s default `h2`, a member navigating by heading
 * would land on an orphan with no page title — and `page-header.tsx` names that
 * exact failure ("a page that mounts this only on its success path loses its
 * heading exactly when the member is most lost"). `app/error.tsx`, which used
 * to catch these, renders an `h1` through `CrestPage`; this keeps it.
 */
export default function DashboardSegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="w-full max-w-md p-4">
      <SegmentError error={error} retry={retry} headingLevel="h1" />
    </div>
  );
}
