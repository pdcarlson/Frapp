"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccessibleChapters, useLegalAcceptance } from "@repo/hooks";
import { WELCOME_PATH } from "@/lib/auth/join-visit";
import { useChapterStore } from "@/lib/stores/chapter-store";

type Membership = { chapter_id: string; has_completed_onboarding?: boolean };

/**
 * Routes the dashboard leaves alone: Chapter settings (Stripe's checkout and
 * the founder's setup land there) and `/billing` before its redirect runs.
 */
const QUIET_PATHS = ["/settings", "/billing"] as const;

/** Whether `pathname` is a quiet route, or under one. */
export function isWelcomeQuietPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return QUIET_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Sends a member who hasn't finished joining back to "How the chapter sees
 * you" (#5627), the web half of the phone's s03 gate.
 *
 * `/welcome` opens once, straight after a join. A member who closes the tab
 * there, types `/chat`, or whose finish never landed would otherwise keep the
 * email-made name on every message, stay pending in the Directory, and never
 * be announced: the "<name> joined" notices go out when that screen finishes
 * (`PATCH /v1/members/me/onboarding`). The first-run tour used to be this net,
 * reopening while `has_completed_onboarding` was false.
 *
 * A founder's chapter is created with the flag already true, so the wizard's
 * founder never comes here. It waits while the Terms prompt is up.
 */
export function WelcomeGate() {
  const pathname = usePathname();
  const router = useRouter();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chapters = useAccessibleChapters();
  const legal = useLegalAcceptance();

  const memberships = Array.isArray(chapters.data)
    ? (chapters.data as Membership[])
    : [];
  const active = activeChapterId
    ? memberships.find((m) => m.chapter_id === activeChapterId)
    : undefined;
  const due =
    active?.has_completed_onboarding === false &&
    legal.data?.required === false &&
    !isWelcomeQuietPath(pathname);

  useEffect(() => {
    if (due) router.replace(WELCOME_PATH);
  }, [due, router]);

  return null;
}
