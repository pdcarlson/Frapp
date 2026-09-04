"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  useAccessibleChapters,
  useCurrentChapter,
  useUpdateOnboarding,
} from "@repo/hooks";
import { SignetMark } from "@/components/auth/signet-mark";
import {
  BackworkGlyph,
  ChatGlyph,
  EventsGlyph,
  PointsGlyph,
  ProfileGlyph,
  StudyGlyph,
} from "@/components/profile/profile-glyphs";
import { StepDots } from "@/components/onboarding/step-dots";
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

/**
 * A slide's glyph is a pre-sized node rather than a component reference, so a
 * slide can carry something that is not a duotone glyph — which the welcome
 * slide does. The alternative, a `ComponentType` plus a `className` the call
 * site supplies, cannot express a fixed-size brand mark without the two
 * fighting over the same class.
 */
type Step = {
  id: string;
  title: string;
  description: string;
  glyph: React.ReactNode;
};

/** §2's inline size, matching what the shared state family draws. */
const GLYPH = "h-5 w-5 text-accent-text";

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to Signet",
    description:
      "A quick three-minute tour of the surfaces you'll use most. You can revisit this anytime from your profile.",
    glyph: <SignetMark size="sm" />,
  },
  {
    id: "chat",
    title: "Chat",
    description:
      "Chapter channels, DMs, and announcements live here. Realtime updates — no refresh needed.",
    glyph: <ChatGlyph className={GLYPH} />,
  },
  {
    id: "events",
    title: "Events",
    description:
      "Check in during the event window to earn attendance points. Admins can mark excuses and auto-absences.",
    glyph: <EventsGlyph className={GLYPH} />,
  },
  {
    id: "backwork",
    title: "Backwork",
    description:
      "The chapter's academic library. Rich filters and signed-URL downloads — duplicates rejected automatically.",
    glyph: <BackworkGlyph className={GLYPH} />,
  },
  {
    id: "study",
    title: "Study hours",
    description:
      "Tracked study sessions earn points while you're inside a study zone. On the web, closing the tab ends the session — use mobile for longer blocks.",
    glyph: <StudyGlyph className={GLYPH} />,
  },
  {
    id: "points",
    title: "Points",
    description:
      "See your balance, the chapter leaderboard, and a full transaction log. Admins can adjust with a required reason.",
    glyph: <PointsGlyph className={GLYPH} />,
  },
  {
    id: "profile",
    title: "Your profile",
    description:
      "Set your display name, bio, and quiet hours. Sign out from here when you're done.",
    glyph: <ProfileGlyph className={GLYPH} />,
  },
  {
    id: "done",
    title: "You're all set",
    description:
      "Dive into your home dashboard. We'll mark onboarding complete so this tour doesn't reappear.",
    glyph: <CheckCircle2 className={GLYPH} />,
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

  if (!shouldShow) return null;

  return (
    <OnboardingTutorialDialog
      chapterName={chapterName}
      onComplete={() => void completeOnboarding()}
    />
  );
}

function OnboardingTutorialDialog({
  chapterName,
  onComplete,
}: {
  chapterName: string;
  onComplete: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex] ?? STEPS[0]!;
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onComplete();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {step.glyph}
            {step.title}
          </DialogTitle>
          <DialogDescription>
            {stepIndex === 0
              ? `Welcome to ${chapterName} on Signet. ${step.description}`
              : step.description}
          </DialogDescription>
        </DialogHeader>

        {/*
          The fill is dropped, not recoloured. `--secondary` holds `--card`'s
          value and a `DialogContent` is `--popover`, so `bg-secondary/60`
          composited to 1.050:1 — a strip that was not there.

          The obvious repair is the second defect: `bg-accent-subtle` on
          `--popover` measures 1.001:1, which is `meter.ts`'s finding met in a
          new place. §10's rule is that a state which cannot rise above its
          container drops its fill and lets the hairline carry the edge, and
          over `--popover` that hairline separates better (1.275:1) than the
          card's own ever did. Pinned in `profile-contrast.spec.ts`.
        */}
        <StepDots
          current={stepIndex}
          total={STEPS.length}
          className="rounded-md border border-border px-3 py-2"
        />

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onComplete}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </Button>
            {isLast ? (
              <Button onClick={onComplete}>Finish</Button>
            ) : (
              <Button onClick={() => setStepIndex((i) => i + 1)}>Next</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
