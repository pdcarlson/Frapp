"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  MapPin,
  MessagesSquare,
  Sparkles,
  Star,
  UserCircle2,
} from "lucide-react";
import {
  useAccessibleChapters,
  useCurrentChapter,
  useUpdateOnboarding,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChapterStore } from "@/lib/stores/chapter-store";

type ChapterMembership = {
  chapter_id: string;
  has_completed_onboarding: boolean;
  chapter?: { name?: string | null };
};

type Step = {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to Frapp",
    description:
      "A quick three-minute tour of the surfaces you'll use most. You can revisit this anytime from your profile.",
    icon: Sparkles,
  },
  {
    id: "chat",
    title: "Chat",
    description:
      "Chapter channels, DMs, and announcements live here. Realtime updates — no refresh needed.",
    icon: MessagesSquare,
  },
  {
    id: "events",
    title: "Events",
    description:
      "Check in during the event window to earn attendance points. Admins can mark excuses and auto-absences.",
    icon: CalendarDays,
  },
  {
    id: "backwork",
    title: "Backwork",
    description:
      "The chapter's academic library. Rich filters and signed-URL downloads — duplicates rejected automatically.",
    icon: BookOpen,
  },
  {
    id: "study",
    title: "Study hours",
    description:
      "Tracked study sessions earn points while you're inside a study zone. On the web, closing the tab ends the session — use mobile for longer blocks.",
    icon: MapPin,
  },
  {
    id: "points",
    title: "Points",
    description:
      "See your balance, the chapter leaderboard, and a full transaction log. Admins can adjust with a required reason.",
    icon: Star,
  },
  {
    id: "profile",
    title: "Your profile",
    description:
      "Set your display name, bio, quiet hours, and theme. Sign out from here when you're done.",
    icon: UserCircle2,
  },
  {
    id: "done",
    title: "You're all set",
    description:
      "Dive into your home dashboard. We'll mark onboarding complete so this tour doesn't reappear.",
    icon: CheckCircle2,
  },
];

/**
 * Shows a skippable slideshow the first time a member lands in the web
 * dashboard. The `has_completed_onboarding` flag lives on the member row
 * and comes back from `/v1/chapters`; updating it via PATCH
 * `/v1/members/me/onboarding` both dismisses the modal and mirrors the
 * mobile onboarding flag so the two surfaces stay consistent.
 */
export function OnboardingTutorial() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chaptersQuery = useAccessibleChapters();
  const currentChapter = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: Boolean(activeChapterId),
  });
  const updateOnboarding = useUpdateOnboarding();

  const [stepIndex, setStepIndex] = useState(0);
  const [manuallyDismissed, setManuallyDismissed] = useState(false);

  const activeMembership = useMemo(() => {
    const memberships = Array.isArray(chaptersQuery.data)
      ? (chaptersQuery.data as ChapterMembership[])
      : [];
    if (!activeChapterId) return null;
    return (
      memberships.find((m) => m.chapter_id === activeChapterId) ??
      memberships[0] ??
      null
    );
  }, [activeChapterId, chaptersQuery.data]);

  const chapterName =
    (currentChapter.data as { name?: string } | undefined)?.name ??
    activeMembership?.chapter?.name ??
    "your chapter";

  const shouldShow =
    Boolean(activeMembership) &&
    activeMembership?.has_completed_onboarding === false &&
    !manuallyDismissed;

  useEffect(() => {
    if (shouldShow) setStepIndex(0);
  }, [shouldShow]);

  if (!shouldShow) return null;

  const step = STEPS[stepIndex] ?? STEPS[0]!;
  const isLast = stepIndex === STEPS.length - 1;

  async function completeOnboarding() {
    setManuallyDismissed(true);
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
    } catch {
      // Failure is non-fatal — the tutorial is already dismissed in-session.
      // The next authenticated session will re-fetch and re-offer the tour
      // if the mutation never succeeded.
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void completeOnboarding();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <step.icon className="h-5 w-5 text-primary" />
            {step.title}
          </DialogTitle>
          <DialogDescription>
            {stepIndex === 0
              ? `Welcome to ${chapterName}'s Frapp. ${step.description}`
              : step.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Step {stepIndex + 1} of {STEPS.length}
          </span>
          <div className="flex gap-1">
            {STEPS.map((_, idx) => (
              <span
                key={idx}
                aria-hidden="true"
                className={`h-1.5 w-4 rounded-full ${
                  idx <= stepIndex ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => void completeOnboarding()}
          >
            Skip tour
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </Button>
            {isLast ? (
              <Button onClick={() => void completeOnboarding()}>
                Finish
              </Button>
            ) : (
              <Button onClick={() => setStepIndex((i) => i + 1)}>Next</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
