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
 * ## The wrapper adds no padding
 *
 * Every route this boundary stands in for is a tool page, which the shell pads
 * (`dashboard-shell.tsx`), so a gutter here would double the inset and step
 * the card in from where the skeleton it replaces sat (CSS padding is
 * additive). Until #3779 `/chat` was a full-bleed route with no padding and
 * this added `p-4` there only; chat is a shell panel now, with its own
 * boundary (`chat-panel-boundary.tsx`), and `/chat`'s page renders nothing.
 *
 * `max-w-md` is unconditional and does differ from the skeleton, deliberately:
 * a skeleton is content-shaped and belongs at content width (§10: "the skeleton
 * mirrors the layout it becomes"), while this is a short message in a fixed
 * §10 card, and stretching one across a 1440px display is what `CrestPage` was
 * quietly preventing before.
 *
 * ## The heading is an `h2`
 *
 * The route's `h1` is the top bar's page title (`top-bar.tsx`), which the shell
 * renders around this boundary as it does around the page, so the error's own
 * heading sits one level under it. It rendered an `h1` while the title lived
 * inside each page and this boundary replaced it (2026-09 to 2026-11-05).
 */
export default function DashboardSegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="w-full max-w-md">
      <SegmentError error={error} retry={retry} />
    </div>
  );
}
