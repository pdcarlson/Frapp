"use client";

import { isCheckoutLandingPath } from "@/components/billing/billing-paths";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  shouldMeetFrappAi,
  useAccessibleChapters,
  useAiConsent,
} from "@repo/hooks";
import { MeetFrappAiDialog } from "@/components/ai/meet-frapp-ai";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * Meet Frapp AI, by itself, once, for an account that never answered it
 * (#4790): a new member right after the first-run tour, and a member who
 * joined before the screen existed on their next visit. Mounted in the
 * dashboard shell beside the tour and What's new.
 *
 * It waits its turn, as What's new does: nothing while the tour is due (the
 * membership's `has_completed_onboarding` is false), never over a checkout
 * landing, and it stands down when another dialog or menu is up, trying again
 * on the next navigation. Continue and Not now are both answers, so neither
 * brings it back; closing it is not, so the next visit asks again.
 */

/** After What's new's own delay, so a landing route's dialogs open first. */
export const MEET_FRAPP_AI_OPEN_DELAY_MS = 1_200;

const BLOCKING_LAYER =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type Membership = { chapter_id: string; has_completed_onboarding: boolean };

export function MeetFrappAiHost() {
  const pathname = usePathname();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chaptersQuery = useAccessibleChapters();
  const consent = useAiConsent();
  const [open, setOpen] = useState(false);
  // Once per page load: a member who closed it is asked on the next visit.
  const shown = useRef(false);

  const membership = useMemo(() => {
    const memberships = Array.isArray(chaptersQuery.data)
      ? (chaptersQuery.data as Membership[])
      : [];
    if (!activeChapterId) return null;
    return memberships.find((m) => m.chapter_id === activeChapterId) ?? null;
  }, [activeChapterId, chaptersQuery.data]);

  const due =
    shouldMeetFrappAi(consent.data) &&
    membership !== null &&
    membership.has_completed_onboarding !== false;

  useEffect(() => {
    if (!due || shown.current) return;
    if (isCheckoutLandingPath(pathname)) return;
    const timer = setTimeout(() => {
      if (document.querySelector(BLOCKING_LAYER)) return;
      shown.current = true;
      setOpen(true);
    }, MEET_FRAPP_AI_OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, pathname]);

  if (!consent.data) return null;
  return (
    <MeetFrappAiDialog
      open={open}
      onAnswered={() => setOpen(false)}
      onDismiss={() => setOpen(false)}
    />
  );
}
