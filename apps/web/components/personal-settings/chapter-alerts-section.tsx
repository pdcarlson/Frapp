"use client";

import {
  useActiveChapterId,
  useNotificationPreferences,
  usePermissionList,
  useUpdateNotificationPreference,
} from "@repo/hooks";
import {
  isNotificationCategoryKey,
  rowsToNotificationCategoryState,
  shownNotificationCategories,
  type NotificationCategoryKey,
} from "@repo/validation";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/lib/hooks/use-toast";
import { ProfileSection } from "@/components/profile/profile-section";
import { anyReadUncached } from "@/components/shared/async-states";
import { InlineNote } from "@/components/shared/inline-note";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { denseListClassName } from "@/components/shared/table-controls";
import { useNetwork } from "@/lib/providers/network-provider";
import { getErrorMessage } from "@/lib/utils";
import { NotificationSettingsSkeleton } from "@/components/personal-settings/personal-settings-skeleton";
import { ChatLevelControl } from "@/components/personal-settings/chat-level-control";

/**
 * The offline note under the notification switches, referenced by every one of
 * them through `aria-describedby` while OFFLINE. Named once so the paragraph
 * and its referrers cannot drift apart into a dangling id.
 */
const OFFLINE_NOTE_ID = "notification-categories-offline";

/**
 * Settings → Chapter alerts: which of the active chapter's notification
 * categories the member receives. `notification_preferences` is keyed
 * `(user_id, chapter_id, category)`, so this section sits in the rail's
 * "In <chapter>" group. With no active chapter there is nothing to read and
 * the query stays disabled; see the `chapterId` branch below. Moved here from
 * `/profile` (#3856).
 */
export function ChapterAlertsSection() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const chapterId = useActiveChapterId();
  const preferencesQuery = useNotificationPreferences(chapterId ?? "");
  const updatePreference = useUpdateNotificationPreference();
  // Decides which audience-gated switches are drawn (the join switch, #4008).
  const permissions = usePermissionList();

  /*
   * ...and a *third* query is a third set, by the same rule (#564).
   *
   * Two rungs here have no counterpart on the cards above, and the reason is
   * NOT that a disabled query spins a skeleton — it does not. v5 derives
   * `isLoading = isPending && isFetching`, and a disabled query never fetches,
   * so `isLoading` is false and the loading rung is simply never reached. An
   * earlier version of this comment claimed otherwise; the rungs earn their
   * place for a different and more serious reason.
   *
   * Without them the card falls through every branch to `null` and renders six
   * live-looking switches whose clicks `handleCategoryToggle` silently drops at
   * its own `!chapterId` guard — a control that looks operable and does
   * nothing, which is the dead-control failure the shared catalog exists to
   * prevent.
   *
   * The no-chapter copy is phrased as an instruction rather than a claim about
   * the member's account, and that is load-bearing. `activeChapterId` comes
   * from a persisted zustand store that initializes to `null`
   * (`chapter-store.ts`), so before rehydration — and in the server-rendered
   * HTML — a member WITH a chapter is indistinguishable from one without;
   * `subscription-gate.tsx` records the same window. "Select a chapter" is
   * true in both states, where "you have no chapter" would be a confident
   * falsehood in one of them.
   *
   * Gating this rung on the store's `hasHydrated` was tried and reverted: it
   * can never become true when `localStorage` access throws (privacy modes,
   * blocked site data). `createJSONStorage` returns `undefined` there
   * (`zustand/esm/middleware.mjs:283`) and `hydrate()` early-returns on
   * `!storage` (`:382`) WITHOUT invoking the rehydration callback, so the flag
   * sticks at `false` and the card would show a permanent skeleton — to
   * precisely the members for whom "no active chapter" is actually true, since
   * nothing can have been persisted. A wrong-for-an-instant sentence is worth
   * fixing; a card that never resolves is not the way to fix it.
   *
   * `data === undefined` guards the offline and error rungs for the reason the
   * screen-scale block above spells out: TanStack keeps `data` through a
   * background refetch failure, and switches drawn from a still-held cache are
   * better than a card that vanishes when a focus refetch blips.
   */
  const preferencesPaused =
    preferencesQuery.isPending && preferencesQuery.fetchStatus === "paused";
  let categoriesState: React.ReactNode = null;
  if (!chapterId) {
    categoriesState = (
      <InlineNote>Pick a chapter to set its notifications.</InlineNote>
    );
  } else if (isOffline && anyReadUncached(preferencesQuery)) {
    categoriesState = (
      <NestedOffline
        title="Notification settings unavailable offline"
        description="Reconnect to load which categories you receive."
        onRetry={() => void preferencesQuery.refetch()}
      />
    );
  } else if (preferencesQuery.isLoading || preferencesPaused) {
    categoriesState = <NotificationSettingsSkeleton />;
  } else if (preferencesQuery.isError && anyReadUncached(preferencesQuery)) {
    categoriesState = (
      <NestedError
        title="Couldn't load your notification settings"
        description="These couldn't be read, so a switch here would report a change that never saved. Retry in a moment."
        onRetry={() => void preferencesQuery.refetch()}
      />
    );
  }

  /*
   * A complete state for every catalog key, folded from whatever rows came
   * back — never a patch, and never keyed off the response's own keys. The
   * fold lives in `@repo/validation` beside the catalog because mobile's s16
   * grid performs exactly the same one; see that module's docblock for why a
   * per-surface copy is the failure mode rather than a convenience.
   */
  const categories = rowsToNotificationCategoryState(preferencesQuery.data);

  function handleCategoryToggle(
    category: NotificationCategoryKey,
    label: string,
    isEnabled: boolean,
  ) {
    if (!chapterId) return;
    if (isOffline) {
      // Refused rather than queued — see the `aria-disabled` note on the
      // Switch. Said out loud, because a control that silently ignores a click
      // is the dead control this card is otherwise careful to avoid.
      toast({
        title: "You're offline",
        description:
          "Reconnect to change your notification settings. Nothing has been changed.",
      });
      return;
    }
    /*
     * `useUpdateNotificationPreference` writes the cache optimistically and
     * reverts just this category on failure (#312), so the switch moves at
     * once and un-moves itself if the PATCH loses. All this owes the member is
     * the sentence explaining why it moved back.
     *
     * `mutateAsync().catch()`, NOT `mutate(…, { onError })`. All six switches
     * share one mutation observer, and v5's `MutationObserver.mutate` detaches
     * the observer from the previous mutation and overwrites its stored
     * per-call options — so a superseded mutation's `onError` never fires, and
     * if it did it would carry the *later* toggle's closure and name the wrong
     * category. That window is seconds wide, not a race: `query-provider.tsx`
     * retries a transient failure (a 5xx, a lost response) twice with backoff,
     * so such a PATCH takes ~6-7s to surface. Flip two switches inside that
     * and the first would
     * revert silently — the exact "revert reads as the control being broken"
     * outcome this exists to prevent. `mutateAsync`'s promise belongs to the
     * call, so supersession and unmount cannot swallow it.
     * `packages/hooks/src/use-notifications.ts` documents the same asymmetry.
     */
    updatePreference
      .mutateAsync({ chapter_id: chapterId, category, is_enabled: isEnabled })
      .catch((error: unknown) =>
        toast({
          title: `Couldn't turn ${label} notifications ${isEnabled ? "on" : "off"}`,
          description: getErrorMessage(
            error,
            "The switch has been put back. Try again or check your connection.",
          ),
          variant: "destructive",
        }),
      );
  }

  return (
    <ProfileSection
      id="chapter-alerts"
      title="Chapter alerts"
      hint="For this chapter, on every device you use."
    >
      {/* The chapter-wide chat level (#4124) has its own read and its own
          states, so it is drawn whenever there is a chapter to set it for,
          even while the switches below are still loading. Keyed by the
          chapter: a switch made in another tab moves the active chapter in
          place (`use-claim-chapter-sync.ts`), and a save still in flight for
          the old chapter must not show, or fail, under the new one. */}
      {chapterId ? (
        <div className="mb-4">
          <ChatLevelControl key={chapterId} />
        </div>
      ) : null}
      {categoriesState ?? (
        <div className="space-y-4">
          <ul className={denseListClassName}>
            {shownNotificationCategories(permissions).map((category) => {
              const switchId = `notification-category-${category.key}`;
              const descriptionId = `${switchId}-description`;
              return (
                <li
                  key={category.key}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="grid gap-1">
                    <Label htmlFor={switchId}>{category.label}</Label>
                    <p
                      id={descriptionId}
                      className="text-sm text-muted-foreground"
                    >
                      {category.description}
                    </p>
                  </div>
                  <Switch
                    id={switchId}
                    checked={categories[category.key]}
                    // The offline reason belongs on the control, not only in
                    // the paragraph after the last row — `spec/ui/resilience/connection-state.md`'s
                    // queueless rule is explicit that it wires to the control
                    // itself. Without this a screen-reader member offline
                    // hears "Points, switch, on, unavailable" and nothing
                    // about why, with the explanation sitting six rows below
                    // and the toast arriving only after they activate a
                    // control their AT has just called unavailable.
                    aria-describedby={
                      isOffline
                        ? `${descriptionId} ${OFFLINE_NOTE_ID}`
                        : descriptionId
                    }
                    /*
                     * Soft-disabled offline, NOT `disabled`.
                     *
                     * The write is refused up front rather than attempted.
                     * Since #1754 the query client sets `networkMode:
                     * "always"`, so an offline mutation no longer parks — it
                     * starts, exhausts its two retries, and rejects in ~3s. That
                     * is a real improvement over the pause-forever it
                     * replaced, but it is still the wrong experience on a
                     * *switch*: the optimistic `onMutate` moves it, it sits
                     * wrong for three seconds while retries burn, then snaps
                     * back under an error toast. Refusing costs the member
                     * nothing and tells them immediately, and the switch
                     * never shows a value the server was never told about.
                     *
                     * This is § 2's "disabled with 'Reconnect to make
                     * changes'" on a control whose appearance carries
                     * state. Queueless dashboard *buttons* go through
                     * `useSubscriptionGate` (#1753) and take the real
                     * `disabled` attribute; these switches cannot, for
                     * the colour / tab-order reasons below. #1754's note
                     * that an ungated offline member would get an error
                     * toast is the backstop, not the intended path.
                     *
                     * But the real `disabled` attribute cost more than it
                     * bought. `switch.tsx` scopes every state colour to
                     * `enabled:`, and its thumb takes `group-data-[disabled]`
                     * which outranks the `data-[state]` rules — so all six
                     * switches render an identical track and thumb, and the
                     * only surviving on/off cue is the thumb offset at about
                     * 2.24:1, under WCAG 1.4.11's 3:1 for non-text. Reading
                     * which categories are muted is the *more* common offline
                     * need, and `disabled` also drops all six out of the tab
                     * order. `aria-disabled` keeps the colours, the tab order
                     * and the announced state while still refusing the write.
                     */
                    aria-disabled={isOffline || undefined}
                    onCheckedChange={(checked) =>
                      handleCategoryToggle(
                        category.key,
                        category.label,
                        checked,
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
          {isOffline ? (
            // Says only what is true. An earlier draft added "your current
            // settings are still in force", which is false in exactly the
            // case the refusal exists for: a toggle fired just before the
            // connection dropped is mid-retry, so a switch can be showing a
            // value the server has not accepted — and since #1754 it will
            // reject a few seconds later and revert under the reader's
            // eyes. Claiming the displayed state is authoritative would be
            // most wrong precisely when it matters.
            <p id={OFFLINE_NOTE_ID} className="text-sm text-muted-foreground">
              You&apos;re offline, so these can&apos;t be changed right now.
            </p>
          ) : null}
          {/*
            Rendered only while `announcements` is genuinely absent from the
            catalog, rather than hard-coded as mobile's copy is. When #1323
            lands and adds the key, this card would otherwise show an
            "Announcements" switch and, directly beneath it, a sentence
            denying that switch exists — a control and its own denial in one
            card. Deriving the condition from the catalog makes that
            contradiction unrepresentable instead of leaving it to whoever
            ships #1323 to remember two surfaces' prose.

            Asked through `isNotificationCategoryKey` rather than a literal
            comparison against `category.key`: the catalog is `as const`, so
            `key !== "announcements"` is a type error today ("no overlap")
            and would only start compiling once the key exists. The
            predicate takes `unknown`, which is what lets the question be
            asked before the answer changes.

            Why it is absent at all is the catalog's own docblock, not
            restated here: both emitters send URGENT, which bypasses the
            preference gate (#1041), so a switch would suppress nothing.

            Deliberately NOT claiming this is the only unswitchable
            category — `admin` (the chat-report alert and the Discord
            import notice) is NORMAL priority with no catalog entry either.
            The member-joined push left it for its own switch (#4008).
            This names the
            one a member is most likely to go looking for, and does not
            pretend the grid is exhaustive.
          */}
          {/* Chat has no switch here: a channel or DM is muted where it
              is read (the catalog's docblock in @repo/validation says why
              the coarse Chat switch was dropped, 2026-11-06). Chat messages
              above lowers every channel at once but never silences chat. */}
          <p className="text-sm text-muted-foreground">
            Mute a channel or DM from the chat itself.
          </p>
          {isNotificationCategoryKey("announcements") ? null : (
            <p className="text-sm text-muted-foreground">
              Chapter announcements always arrive. They can carry emergencies,
              so they are not switchable here.
            </p>
          )}
        </div>
      )}
    </ProfileSection>
  );
}
