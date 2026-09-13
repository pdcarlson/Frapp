"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { catchError } from "next/error";
import { useAccessibleChapters } from "@repo/hooks";
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
 * named above. #2145's 51.6 KB win keeps ~89% of its gzipped value, and the
 * alternative is recorded here so the trade can be re-opened with numbers
 * rather than re-derived.
 *
 * ## Why the fallback is visible rather than `null`
 *
 * Degrading to nothing is the cheaper option and it is wrong here. This gate
 * renders for members with no chapter at all, and the wizard is the only route
 * out of that state — it *is* the onboarding. Swallowing the failure would hand
 * a brand-new member an empty dashboard, no dialog, and no reason given, which
 * is a worse outcome than the full-page error this change is replacing rather
 * than a better one. So the failure is stated, with the button that can
 * actually clear it.
 *
 * The overlay is what makes it visible: the gate is mounted in the shell's
 * chrome rather than in its content column, so an unpositioned card would paint
 * somewhere arbitrary in the layout. Fixed and centred, it stands where the
 * dialog it replaces would have stood.
 *
 * `fixed inset-0 z-50 bg-black/55` is `DialogOverlay`'s own scrim, copied
 * rather than approximated — this stands in for a dialog, so it belongs on the
 * dialog layer at the dialog's weight. The raw `black` is the reason it is not
 * an opacity wash over a token: `family-call-sites.spec.ts` bans diluting a
 * design token (`bg-background/80` fires it), and `dialog.tsx` and `sheet.tsx`
 * both paint this exact scrim for that reason.
 */
const ChapterWizardBoundary = catchError<{ children?: React.ReactNode }>(
  (_props, { error, retry }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
      <div className="w-full max-w-[400px]">
        <SegmentError error={error} retry={retry} />
      </div>
    </div>
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

  const memberships = asArray<unknown>(chaptersQuery.data);
  // Trigger: the user has zero chapter memberships. Once opened, the wizard
  // owns its own lifecycle (the membership count flips to 1 mid-flow after the
  // chapter is created), so we never auto-close it from here.
  const hasNoChapters = chaptersQuery.isSuccess && memberships.length === 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch the wizard open; auto-close on membership flip would unmount an in-progress create
    if (hasNoChapters) setOpen(true);
  }, [hasNoChapters]);

  if (!open) return null;
  return (
    <ChapterWizardBoundary>
      <ChapterWizard onComplete={() => setOpen(false)} />
    </ChapterWizardBoundary>
  );
}
