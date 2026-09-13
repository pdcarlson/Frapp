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
 * emoji button in `/chat` replaced the nav, the top bar and the composer — and
 * with them a half-typed message and any staged attachment — over a failure
 * confined to one popover.
 *
 * Sitting here instead, the boundary replaces the shell's content column and
 * nothing else. The nav and the top bar are rendered by
 * `(dashboard)/layout.tsx`, which is *above* this boundary, so they survive and
 * a member can navigate straight out of the broken segment. That is the whole
 * point of the file, and it is the reason it is at the group root rather than
 * on `/chat`: the exposure is the standard cost of code splitting rather than
 * anything specific to chat, so it wants one general answer.
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
 * ## No wrapper around the state
 *
 * `(dashboard)/loading.tsx` renders its `LoadingState` bare into the same slot,
 * and these two files stand in for each other across one route transition. A
 * padding wrapper on only one of them would make the error state sit a gutter
 * in from where the skeleton it replaces was.
 */
export default function DashboardSegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError error={error} retry={retry} />;
}
