"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  useAccessibleChapters,
  useDismissOpsNudge,
  useMyPermissions,
  useOrgConfig,
  type ChapterMembershipSummary,
} from "@repo/hooks";
import { getModuleCatalogEntry } from "@repo/org-archetypes";
import {
  canAll,
  selectOpsNudge,
  type OpsNudgeModule,
  type OpsNudgeModuleKey,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { asArray, cn } from "@/lib/utils";

/**
 * The ops-module setup nudge on chat home (#492).
 *
 * `spec/product/modules.md` § "Ops-setup nudges": enabling paid ops modules is
 * never a gate, it is a dismissible inline nudge in chat — **one at a time**, in
 * the fixed priority Dues > Events > Tasks > Points, dismissed **per user per
 * chapter**, clicking through to Settings → Modules on the module it names.
 *
 * Self-contained rather than driven by props from `chat-shell`. The shell does
 * already hold three of these reads — `useChapterStore` (:147), `useOrgConfig`
 * (:149) and `useMyPermissions` (:397), from which it computes its own `can(...)`
 * — so this is not "the shell has none of them". It is that threading four values
 * through a file already past 1,100 lines, for a card that renders `null` in the
 * common case, grows the file that most needs not to grow. The duplicate reads
 * are free: all three are `useQuery` calls on keys the shell has already warmed,
 * so they resolve from cache rather than refetching.
 *
 * The cost is that the two surfaces could disagree about the viewer if one of
 * them later moves off `useMyPermissions` — see the note on the permission gate
 * below.
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

  const activeMembership = useMemo<ChapterMembershipSummary | null>(() => {
    // Typed as the hook's own contract rather than a local structural shape:
    // a local type with an optional `dismissed_ops_nudges` would still compile
    // if the server stopped sending the field, and every officer's dismissals
    // would silently stop being honoured with no test and no type error.
    const memberships = asArray<ChapterMembershipSummary>(chaptersQuery.data);
    if (!activeChapterId) return null;
    return memberships.find((m) => m.chapter_id === activeChapterId) ?? null;
  }, [activeChapterId, chaptersQuery.data]);

  /*
    Only an officer who can actually act on the nudge is offered it. Settings →
    Modules gates its switches on this same permission, so nudging anyone else
    would be a card whose only working control is Dismiss.

    `members:view` is in the list because it is what the *server* requires:
    `MemberController` carries a class-level `@RequirePermissions(MEMBERS_VIEW)`
    and `PermissionsGuard` unions the class and handler lists, so the dismiss
    route needs it even though the route declares no permission of its own.
    Gating on `chapter-config:manage` alone would let a hand-built custom role —
    a "tech chair" given settings access but deliberately kept out of the roster
    — see a card whose X silently 403s, leaving it undismissable forever. No
    seeded role has that shape (every seeded holder of `chapter-config:manage` is
    President, who holds the wildcard), but custom roles are a shipped feature.
    If the server's requirement ever changes, this list changes with it.

    Otherwise the same call `chat-shell` makes at :397-398 and `settings-page` at
    :204. If permission resolution moves off `useMyPermissions` onto a viewer
    context, this call site has to move with them or the surfaces will disagree.
  */
  const canDismiss = canAll(
    ["chapter-config:manage", "members:view"],
    permissionsPayload?.permissions,
  );

  const nudge = useMemo(() => {
    if (!canDismiss || !activeMembership) return null;
    return selectOpsNudge(orgConfig.data?.enabled_modules, [
      ...(activeMembership.dismissed_ops_nudges ?? []),
      ...dismissedHere,
    ]);
  }, [
    canDismiss,
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

  return (
    <OpsSetupNudgeCard
      module={nudge}
      onDismiss={dismiss}
      isDismissing={dismissOpsNudge.isPending}
    />
  );
}

/**
 * The drawn card. Split out with no hooks of its own so a test can render one
 * nudge directly without standing up four queries and a store.
 */
export function OpsSetupNudgeCard({
  module,
  onDismiss,
  isDismissing = false,
}: {
  module: OpsNudgeModule;
  onDismiss: (moduleKey: string) => void;
  /**
   * A dismissal is in flight. Blocks a second one, because the server appends to
   * `dismissed_ops_nudges` read-modify-write: two overlapping writes each read
   * the pre-write array and the later one erases the earlier key. That is
   * reachable here rather than theoretical — dismissing falls the *next* nudge
   * through immediately, putting a fresh X under the cursor in the same spot.
   */
  isDismissing?: boolean;
}) {
  const headingId = `ops-nudge-${module.key}`;
  // The module's display name comes from `MODULE_CATALOG`, never from a copy in
  // the nudge catalog, so a relabel there reaches this card. `ops-nudges.spec`
  // in apps/web pins that every nudge key resolves to a real catalog entry, so
  // `getModuleCatalogEntry`'s chat fallback is unreachable here.
  const label = getModuleCatalogEntry(module.key).label;

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
            this card names, rather than dropping the officer at the top of the
            full module list to find it themselves — `settings-page.tsx` reads
            both and hands the key to `SettingsModulesTab`. (No row count here:
            it is `MODULE_CATALOG.length`, which the tab already renders, and a
            hand-copied figure would be a future contradiction.)
          */}
          <Link href={`/settings?tab=modules&module=${module.key}`}>
            Enable {label}
          </Link>
        </Button>
        <button
          type="button"
          onClick={() => onDismiss(module.key)}
          disabled={isDismissing}
          /*
            An explicit label, not the bare "Dismiss" the icon would imply:
            with up to four of these across a chapter's life, a screen-reader
            user hearing "Dismiss, button" twice has no way to tell which
            suggestion they just closed.
          */
          aria-label={`Dismiss the ${label} suggestion`}
          className={cn(
            // 44px square: §2's touch floor applies to the one control on this
            // card that destroys something, and it sits beside a 44px button.
            "inline-flex h-11 w-11 items-center justify-center rounded-md",
            "text-accent-text transition-colors",
            "enabled:hover:bg-accent-subtle-hover",
            "disabled:cursor-not-allowed disabled:text-disabled",
            FOCUS_RING,
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
