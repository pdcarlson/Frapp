"use client";

import { isCheckoutLandingPath } from "@/components/billing/billing-paths";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import {
  useAccessibleChapters,
  useCurrentChapter,
  usePickableRoles,
  useUpdateOnboarding,
  type PickableRole,
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
import { useToast } from "@/lib/hooks/use-toast";
import { ChatDensityControl } from "@/components/profile/chat-density-control";
import {
  DISPLAY_STEP_DESCRIPTION,
  DISPLAY_STEP_TITLE,
} from "@/components/onboarding/display-step";
import { PICK_ROLES_COPY } from "@repo/validation";
import { PickRolesList } from "@/components/roles/pick-roles-section";

/**
 * Where Replay tutorial lives (`account-section.tsx`), named wherever the tour
 * tells a member how to get it back (#5079). It said "your profile" before,
 * which has no such button.
 */
const REPLAY_LOCATION = "Settings → Account";

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
  /** A control the slide carries under its description, such as the display pick. */
  body?: React.ReactNode;
};

/** §2's inline size, matching what the shared state family draws. */
const GLYPH = "h-5 w-5 text-muted-foreground";

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to Frapp",
    description: `A quick three-minute tour of the surfaces you'll use most. You can replay it anytime from ${REPLAY_LOCATION}.`,
    glyph: <SignetMark size="sm" />,
  },
  {
    id: "chat",
    title: "Chat",
    description:
      "Chapter channels, DMs, and announcements live here. Realtime updates, no refresh needed.",
    glyph: <ChatGlyph className={GLYPH} />,
  },
  {
    // The member picks their chat display while setting up (#3787, Winston's
    // decision): the browser's current display is preselected (Cozy on a
    // fresh browser), so Next keeps it.
    id: "chat-display",
    title: DISPLAY_STEP_TITLE,
    description: DISPLAY_STEP_DESCRIPTION,
    glyph: <ChatGlyph className={GLYPH} />,
    body: <ChatDensityControl />,
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
      "The chapter's academic library. Rich filters and signed-URL downloads, with duplicates rejected automatically.",
    glyph: <BackworkGlyph className={GLYPH} />,
  },
  {
    id: "study",
    title: "Study hours",
    description:
      "Tracked study sessions earn points while you're inside a study zone. On the web, closing the tab ends the session. Use mobile for longer blocks.",
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

/** The slide `Pick your roles` follows, so it sits beside the other setup pick. */
const ROLES_STEP_AFTER = "chat-display";
/** Where the slide goes: right after {@link ROLES_STEP_AFTER}. */
const ROLES_STEP_INDEX =
  STEPS.findIndex((step) => step.id === ROLES_STEP_AFTER) + 1;

/**
 * The slides with `Pick your roles` after the display pick, for a member whose
 * chapter has roles they can add themselves (#4958), as
 * Discord's onboarding asks its questions while a member joins. Each flip
 * saves at once, so Next and Skip keep what was picked.
 */
function withRolesStep(roles: readonly PickableRole[]): Step[] {
  const rolesStep: Step = {
    id: "pick-roles",
    title: PICK_ROLES_COPY.title,
    description: PICK_ROLES_COPY.lede,
    glyph: <ProfileGlyph className={GLYPH} />,
    body: <PickRolesList roles={roles} />,
  };
  return [
    ...STEPS.slice(0, ROLES_STEP_INDEX),
    rolesStep,
    ...STEPS.slice(ROLES_STEP_INDEX),
  ];
}

/**
 * The routes this tour must not open over.
 *
 * It is mounted in `dashboard-shell.tsx` and gated only on
 * `has_completed_onboarding`, so it is otherwise route-agnostic: it opens over
 * whatever the member happens to have landed on. Since #2297 Plan and billing
 * (`/billing` until #3827 moved it into Chapter settings) is a landing rather
 * than somewhere only a deliberate visitor arrives, and the tour would cover
 * its "Complete checkout" CTA and then end on "Dive into your home dashboard."
 * The routes are `CHECKOUT_LANDING_PATHNAMES`, shared with What's new.
 *
 * WHO THIS ACTUALLY PROTECTS — not the brand-new founder. `ChapterService`
 * creates the founder's own membership with `has_completed_onboarding: true`
 * (`chapter.service.ts`), so the tour never fires for the person the wizard
 * just redirected. It fires for a member whose flag is false and who reaches
 * Plan and billing: an invited member, or a founder who chose "Replay tutorial" in
 * Profile (`profile-panel.tsx` sets the flag back to false). This guard is
 * therefore defensive rather than a fix for a live first-run bug — worth
 * stating, because a comment claiming the founder case would send the next
 * reader looking for behaviour that cannot occur.
 *
 * Suppressed, not dismissed — the flag is left alone, so the tour still opens
 * the next time that member is anywhere else in the dashboard.
 */

/**
 * Shows a skippable slideshow the first time a member lands in the web
 * dashboard. The `has_completed_onboarding` flag lives on the member row
 * and comes back from `/v1/chapters`; updating it via PATCH
 * `/v1/members/me/onboarding` both dismisses the modal and mirrors the
 * mobile onboarding flag so the two surfaces stay consistent.
 */
export function OnboardingTutorial() {
  const pathname = usePathname();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chaptersQuery = useAccessibleChapters();
  const currentChapter = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: Boolean(activeChapterId),
  });
  const updateOnboarding = useUpdateOnboarding();
  const { toast } = useToast();

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
    currentChapter.data?.name ??
    activeMembership?.chapter?.name ??
    "your chapter";

  const onSuppressedRoute = isCheckoutLandingPath(pathname);

  const shouldShow =
    Boolean(activeMembership) &&
    activeMembership?.has_completed_onboarding === false &&
    !manuallyDismissed &&
    !onSuppressedRoute;

  async function completeOnboarding(early: boolean) {
    setManuallyDismissed(true);
    // Leaving before the last slide says how to come back (#5079), so a
    // Skip or Escape pressed by accident isn't the end of the tour.
    if (early) {
      toast({
        title: "Tour skipped",
        description: `Replay it anytime from ${REPLAY_LOCATION}.`,
      });
    }
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
      onComplete={(early) => void completeOnboarding(early)}
    />
  );
}

function OnboardingTutorialDialog({
  chapterName,
  onComplete,
}: {
  chapterName: string;
  /** `early` is true when the member left before the last slide. */
  onComplete: (early: boolean) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const { roles } = usePickableRoles();
  // Whether the roles slide is in, decided as the member leaves the display
  // slide: until then the slide would land ahead of them, so a slow roles
  // read still gets it in; after, adding it would move them back a slide.
  // The switches still show what the read says now.
  const [offerRoles, setOfferRoles] = useState<boolean | null>(null);
  const withRoles = offerRoles ?? roles.some((role) => role.joinable);
  const steps = withRoles ? withRolesStep(roles) : STEPS;
  const step = steps[stepIndex] ?? steps[0]!;
  const isLast = stepIndex === steps.length - 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onComplete(!isLast);
      }}
    >
      {/*
        A click outside no longer ends the tour (#5079): a stray click past
        the dialog's edge used to mark onboarding complete for good. Skip
        tour, the X and Escape still end it, each on purpose.
      */}
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {step.glyph}
            {step.title}
          </DialogTitle>
          <DialogDescription>
            {stepIndex === 0
              ? `Welcome to ${chapterName} on Frapp. ${step.description}`
              : step.description}
          </DialogDescription>
        </DialogHeader>

        {/*
          The fill is dropped, not recoloured. `--secondary` held `--card`'s
          value (the alias is deleted, #3036) and a `DialogContent` is
          `--popover`, so `bg-secondary/60` composited to 1.050:1 when
          measured (1.064:1 at today's ladder) — a strip that was not there.

          The obvious repair is the second defect: `bg-accent-subtle` on
          `--popover` measures 1.001:1, which is `meter.ts`'s finding met in a
          new place. §10's rule is that a state which cannot rise above its
          container drops its fill and lets the hairline carry the edge, and
          over `--popover` that hairline separates better (1.275:1) than the
          card's own ever did. Pinned in `profile-contrast.spec.ts`.
        */}
        {step.body ?? null}

        <StepDots
          current={stepIndex}
          total={steps.length}
          className="rounded-md border border-border px-3 py-2"
        />

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onComplete(!isLast)}>
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
              <Button onClick={() => onComplete(false)}>Finish</Button>
            ) : (
              <Button
                onClick={() => {
                  if (stepIndex + 1 >= ROLES_STEP_INDEX) {
                    setOfferRoles((latched) => latched ?? withRoles);
                  }
                  setStepIndex((i) => i + 1);
                }}
              >
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
