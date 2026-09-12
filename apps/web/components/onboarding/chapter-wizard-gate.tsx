"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAccessibleChapters } from "@repo/hooks";
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
  return <ChapterWizard onComplete={() => setOpen(false)} />;
}
