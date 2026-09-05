"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  useAccessibleChapters,
  useDismissOpsNudge,
  useMyPermissions,
  useOrgConfig,
} from "@repo/hooks";
import {
  can,
  selectOpsNudge,
  type OpsNudgeModule,
  type OpsNudgeModuleKey,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { cn } from "@/lib/utils";

/** Shape this reads off `GET /v1/chapters`; narrower than the hook's own type. */
type Membership = {
  chapter_id: string;
  dismissed_ops_nudges?: string[];
};

/**
 * The ops-module setup nudge on chat home (#492).
 *
 * `spec/product/modules.md` § "Ops-setup nudges": enabling paid ops modules is
 * never a gate, it is a dismissible inline nudge in chat — **one at a time**, in
 * the fixed priority Dues > Events > Tasks > Points, dismissed **per user per
 * chapter**, clicking through to Settings → Modules on the module it names.
 *
 * Self-contained rather than driven by props from `chat-shell`: the shell is
 * already past 1,100 lines and holds none of these four reads, so wiring them
 * through it would grow the file that most needs not to grow, for a card that
 * renders `null` in the common case.
 *
 * The order of the guards below is deliberate — permission first, then config,
 * then selection — so a member without `chapter-config:manage` never causes the
 * chapter-config query to be the thing that decides whether they see a card.
 */
export function OpsSetupNudge() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const chaptersQuery = useAccessibleChapters();
  const orgConfig = useOrgConfig();
  // No `chapterId` argument: the hook reads the active chapter itself and
  // already disables the query until one resolves.
  const { data: permissionsPayload } = useMyPermissions();
  const dismissOpsNudge = useDismissOpsNudge();

  /**
   * Dismissed in this session, ahead of the server round trip. Without it the
   * card sits under the member's cursor until `GET /v1/chapters` refetches —
   * the same reason `onboarding-tutorial.tsx` keeps its own `manuallyDismissed`
   * beside the flag it writes.
   */
  const [dismissedHere, setDismissedHere] = useState<readonly string[]>([]);

  const activeMembership = useMemo<Membership | null>(() => {
    const memberships = Array.isArray(chaptersQuery.data)
      ? (chaptersQuery.data as Membership[])
      : [];
    if (!activeChapterId) return null;
    return memberships.find((m) => m.chapter_id === activeChapterId) ?? null;
  }, [activeChapterId, chaptersQuery.data]);

  /*
    Only an officer who can actually act on the nudge is offered it. Settings →
    Modules gates its switches on this same permission, so nudging anyone else
    would be a card whose only working control is Dismiss.
  */
  const canManage = can("chapter-config:manage", permissionsPayload?.permissions);

  const nudge = useMemo(() => {
    if (!canManage || !activeMembership) return null;
    return selectOpsNudge(orgConfig.data?.enabled_modules, [
      ...(activeMembership.dismissed_ops_nudges ?? []),
      ...dismissedHere,
    ]);
  }, [
    canManage,
    activeMembership,
    orgConfig.data?.enabled_modules,
    dismissedHere,
  ]);

  if (!nudge) return null;

  function dismiss(moduleKey: string) {
    setDismissedHere((prev) => [...prev, moduleKey]);
    dismissOpsNudge.mutate(
      { module_key: moduleKey as OpsNudgeModuleKey },
      {
        onError: () => {
          // Non-fatal, and deliberately NOT rolled back in-session: re-showing
          // a card the member just closed is worse than a dismissal that has
          // to be repeated next session. The next `GET /v1/chapters` is the
          // source of truth, and it will re-offer the nudge if the write never
          // landed — matching how the onboarding tutorial treats its own flag.
        },
      },
    );
  }

  return <OpsSetupNudgeCard module={nudge} onDismiss={dismiss} />;
}

/**
 * The drawn card. Split out with no hooks of its own so a test can render one
 * nudge directly without standing up four queries and a store.
 */
export function OpsSetupNudgeCard({
  module,
  onDismiss,
}: {
  module: OpsNudgeModule;
  onDismiss: (moduleKey: string) => void;
}) {
  const headingId = `ops-nudge-${module.key}`;

  return (
    <div
      /*
        `region`, not `alert` or `status`. The nudge is not news — it is
        standing suggestion that is equally true on the member's tenth visit,
        and a live region would announce it over whatever the member came to
        chat to read. `offline-banner.tsx` is the contrasting case: that one IS
        an event, and takes `role="alert"`.
      */
      role="region"
      aria-labelledby={headingId}
      /*
        §5's Accent recipe (`accent-subtle` fill, `accent-border`, `accent-text`)
        — the same three tokens `CHIP.accent` and the `tinted` button take. Not
        a semantic colour: warning and destructive state a *fact* about the
        system, and this states an opportunity. Border-bottom only, so the card
        reads as part of the conversation column's chrome rather than a floating
        slab inside it.
      */
      className="flex items-start gap-3 border-b border-accent-border bg-accent-subtle px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p
          id={headingId}
          className="text-sm font-bold text-accent-text"
        >
          {module.headline}
        </p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {module.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button asChild variant="tinted" size="sm">
          {/*
            `?module=` alongside `?tab=` so the destination can focus the row
            this card names, rather than dropping the officer at the top of a
            fourteen-row list to find it themselves — `settings-page.tsx` reads
            both and hands the key to `SettingsModulesTab`.
          */}
          <Link href={`/settings?tab=modules&module=${module.key}`}>
            Enable {module.label}
          </Link>
        </Button>
        <button
          type="button"
          onClick={() => onDismiss(module.key)}
          /*
            An explicit label, not the bare "Dismiss" the icon would imply:
            with up to four of these across a chapter's life, a screen-reader
            user hearing "Dismiss, button" twice has no way to tell which
            suggestion they just closed.
          */
          aria-label={`Dismiss the ${module.label} suggestion`}
          className={cn(
            // 44px square: §2's touch floor applies to the one control on this
            // card that destroys something, and it sits beside a 44px button.
            "inline-flex h-11 w-11 items-center justify-center rounded-md",
            "text-accent-text transition-colors hover:bg-accent-subtle-hover",
            FOCUS_RING,
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
