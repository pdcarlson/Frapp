"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { catchError } from "next/error";
import { useAccessibleChapters } from "@repo/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SegmentError } from "@/components/shared/segment-error";
import { asArray } from "@/lib/utils";

/**
 * The wizard itself, fetched only once a member turns out to have no chapter.
 *
 * This split is worth more than its one call site suggests, and the reason is
 * where the gate is mounted: `dashboard-shell.tsx` renders it on **every**
 * dashboard route. So `chapter-wizard.tsx` — 1,000 lines, and the only thing on
 * the shell path that reaches `components/ui/command.tsx` now that #2161 killed
 * the ⌘K palette — was landing in the shared shell chunk of `/chat`,
 * `/members`, `/events` and the rest, dragging `cmdk` in behind it. Every member
 * paid that on every cold load of every route, for a wizard that renders `null`
 * for all but the handful who have not joined a chapter yet.
 *
 * Measured with `scripts/measure-web-route-bundles.mjs` against a production
 * build, this split alone takes the shell floor — the chunks *every* dashboard
 * route loads — from 949.9 KB to 898.3 KB (257.6 KB to 242.2 KB gzipped). It is
 * the only change in #2145 that moves that number, because it is the only one on
 * the shell path; the chat-extras splits move `/chat` alone. `1s` budgets the
 * shell at 200ms and names exactly this as the remedy: "shell chunk: layout,
 * nav, top bar, find" — and nothing else.
 *
 * `ssr: false` because the branch that mounts it is client-only anyway: the
 * decision needs `useAccessibleChapters`, which cannot resolve on the server.
 * There is no `loading` fallback for the same reason the gate returns `null`
 * before it opens — a member with a chapter must never see a flash of one, and
 * a member without one is about to be handed a full-screen dialog. Reserving
 * geometry for it would be reserving geometry for a modal.
 */
const ChapterWizard = dynamic(
  () => import("./chapter-wizard").then((m) => m.ChapterWizard),
  { ssr: false },
);

/**
 * The gate's own error boundary, and the reason it cannot be a route one.
 *
 * #2175 puts a `(dashboard)/error.tsx` under the shell so a rejected chunk
 * degrades one segment instead of the app. It cannot cover this call site:
 * `dashboard-shell.tsx` renders `<ChapterWizardGate />`, the shell is rendered
 * by `(dashboard)/layout.tsx`, and a route `error.tsx` "does not wrap the
 * `layout.js` ... above it in the same segment"
 * (`next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`). A
 * rejection here would bubble past it to `app/error.tsx` and take the whole
 * dashboard down — which is exactly the outcome #2175 exists to stop, on the
 * one split of the three that loads on *every* dashboard route.
 *
 * `catchError` is Next 16's sanctioned answer for this, named by that same
 * reference for "component-level error recovery that aren't tied to route
 * segments". It hands the fallback the same `retry` the route boundary gets
 * (a `router.refresh()` plus a boundary reset) and clears itself on navigation,
 * so a member who routes away is not stuck looking at a stale failure.
 *
 * ## What this costs on the shell path, measured
 *
 * This file is the one place in #2175 where that matters, because everything it
 * imports lands in the shell chunk of every dashboard route — the number the
 * split above exists to move. Measured the same way, with
 * `scripts/measure-web-route-bundles.mjs` against a production build:
 *
 * - #2145 left the shell floor at 898.3 KB (242.2 KB gzipped).
 * - A hand-rolled `getDerivedStateFromError` class here: 904.3 KB (245.1 KB).
 * - `catchError`, as written: 909.1 KB (246.8 KB).
 *
 * So ~6 KB of it is the error surface itself and is paid either way; the choice
 * between the two boundaries is 4.8 KB raw, 1.7 KB gzipped. That is spent here
 * deliberately rather than saved: `catchError` is the documented API for this
 * exact case, and the hand-rolled version silently loses both of the behaviours
 * named above.
 *
 * Stated against #2145 rather than against this file's own delta, because that
 * is the comparison someone re-opening this will want: of its 51.6 KB raw win
 * 40.8 KB survives (79%), and of its 15.4 KB gzipped win 10.8 KB survives
 * (70%). The gzipped share is the worse of the two and is the one to quote. The
 * hand-rolled alternative is recorded above so that trade can be re-opened with
 * numbers rather than re-derived.
 *
 * ## Why the fallback is visible rather than `null`
 *
 * Degrading to nothing is the cheaper option and it is wrong here. This gate
 * renders for members with no chapter at all, and the wizard is the only route
 * out of that state — it *is* the onboarding. Swallowing the failure would hand
 * a brand-new member an empty dashboard, no dialog, and no reason given.
 *
 * ## Why it is a real `Dialog` and must stay dismissible
 *
 * The first draft was a hand-rolled `fixed inset-0 z-50 bg-black/55` div
 * copying `DialogOverlay`'s paint. That was a lockout, and the path is worth
 * recording because it is not obvious: on a **non-chunk** error the only
 * control was Retry, `catchError` implements Retry as a refresh plus a boundary
 * reset, the wizard re-renders, throws identically, and the scrim returns.
 * Navigating away is no escape either — `CatchError.getDerivedStateFromProps`
 * clears the error on a pathname change, the shell re-renders the gate on the
 * new route, and it throws again. A scrim with no dismiss, over every route,
 * for a member who cannot get past it: strictly worse than the full-page error
 * this change replaces, which at least had a working Reload.
 *
 * Reusing the primitive fixes that and more. `DialogContent`'s close control is
 * the escape hatch — dismissing to a chapterless dashboard is a poor place to
 * be, but it is navigable, and being able to reach the account menu and sign
 * out is the difference between degraded and trapped. It also brings the focus
 * trap, focus restore, `Escape`, `role="dialog"` and the `aria-modal` the
 * hand-rolled version had none of: that version moved focus nowhere and
 * announced nothing, so a screen-reader user got a silent scrim.
 *
 * It costs nothing on the shell path this file spends twenty lines budgeting:
 * `dashboard-shell.tsx` already imports `components/ui/sheet.tsx`, which pulls
 * `@radix-ui/react-dialog`, so the primitives are in the shell chunk either
 * way.
 *
 * **The dismissal is owned by the gate, not by this fallback**, and the second
 * draft got that wrong in a way worth recording. Held as `useState` in here it
 * reset on every navigation — `CatchError` clears its error on a pathname
 * change, the wizard re-throws on the new route, and the fallback remounts
 * with the flag back to its initial value. The dialog therefore came back over
 * every route and had to be dismissed again each time, which is better than the
 * lockout it replaced but is not the "navigable" this paragraph claimed. Lifted
 * above the boundary, in `ChapterWizardGate`, it survives that cycle.
 *
 * The title is overridden because the default names the wrong subject. The page
 * behind this dialog rendered perfectly well; what failed is the wizard.
 */
const WIZARD_FAILURE_TITLE = "Couldn't open chapter setup";
/**
 * Deliberately generic: the card below states the *specific* remedy, which
 * varies with the error, and duplicating that branch here would be a second
 * place for it to drift. This names the surface so the announcement is not
 * bare; `SegmentError` owns what to do about it.
 */
const WIZARD_FAILURE_DESCRIPTION =
  "Chapter setup could not be opened. The card below says what to do next.";

function ChapterWizardFailure({
  error,
  retry,
  onDismiss,
}: {
  error: unknown;
  retry: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent className="max-w-md border-none bg-transparent p-0 shadow-none">
        {/*
          Radix derives the dialog's accessible name from `DialogTitle` and
          warns without one. It is `sr-only` because the card below already
          shows this string as its heading — one spelling, rendered twice for
          two different consumers rather than written twice.
        */}
        <DialogTitle className="sr-only">{WIZARD_FAILURE_TITLE}</DialogTitle>
        {/*
          Radix wires `aria-describedby` only when a description is present and
          omits it silently otherwise, so without this the dialog announces its
          title and nothing about the remedy — on a surface whose whole point is
          telling a member what to do next. `sr-only` because the card renders
          the same sentence visibly; `slash-palette.tsx` does this for the same
          reason.
        */}
        <DialogDescription className="sr-only">
          {WIZARD_FAILURE_DESCRIPTION}
        </DialogDescription>
        <SegmentError error={error} retry={retry} title={WIZARD_FAILURE_TITLE} />
      </DialogContent>
    </Dialog>
  );
}

// `catchError<P>`'s `P` is the *fallback's* props, which is exactly what
// `onDismiss` is — `catch-error.js` strips `children` off and forwards the rest
// to the fallback, so this is the sanctioned channel for handing the boundary
// something from above it. Do not add `children` to `P`: the returned component
// already accepts it from its own return type, and declaring it here would type
// a later `props.children` as `ReactNode` while handing it `undefined`.
const ChapterWizardBoundary = catchError<{ onDismiss: () => void }>(
  ({ onDismiss }, { error, retry }) => (
    <ChapterWizardFailure error={error} retry={retry} onDismiss={onDismiss} />
  ),
);

/**
 * First-officer onboarding wizard (Chunk 03). Fires when a signed-in user has
 * no chapters. Turns "I just signed up" into "I'm in #general with my chapter
 * set up": directory autofill → archetype → identity → invite, then routes to
 * /chat?channel=general. All writes go through the cold-path onboarding
 * endpoint — never the chat Edge Functions.
 */
export function ChapterWizardGate() {
  const chaptersQuery = useAccessibleChapters();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const memberships = asArray<unknown>(chaptersQuery.data);
  // Trigger: the user has zero chapter memberships. Once opened, the wizard
  // owns its own lifecycle (the membership count flips to 1 mid-flow after the
  // chapter is created), so we never auto-close it from here.
  const hasNoChapters = chaptersQuery.isSuccess && memberships.length === 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch the wizard open; auto-close on membership flip would unmount an in-progress create
    if (hasNoChapters) setOpen(true);
  }, [hasNoChapters]);

  // `dismissed` lives here, above the boundary, and that placement is the whole
  // point of it. Held inside the fallback it reset on every navigation, because
  // `CatchError` clears its error on a pathname change and the wizard re-throws
  // on the new route — so a member was made to dismiss the same failure once
  // per route for the rest of the session. Above the boundary it survives that
  // cycle and the dismissal means what it says.
  //
  // It is deliberately not `setOpen(false)`: `open` is the gate's trigger, and
  // spending it here would make "I dismissed an error" indistinguishable from
  // "I finished onboarding" if the wizard later recovers.
  if (!open || dismissed) return null;
  return (
    <ChapterWizardBoundary onDismiss={() => setDismissed(true)}>
      <ChapterWizard onComplete={() => setOpen(false)} />
    </ChapterWizardBoundary>
  );
}
