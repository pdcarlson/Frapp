"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useActiveChapterId,
  useCurrentUser,
  useMemberDisplayNames,
  useNotificationPreferences,
  useUpdateNotificationPreference,
  useUpdateOnboarding,
  useUpdateUser,
  useUpdateUserSettings,
  useUserSettings,
  type UserSettings as StoredUserSettings,
} from "@repo/hooks";
import {
  GRADUATION_YEAR_MAX,
  GRADUATION_YEAR_MIN,
  isNotificationCategoryKey,
  localTimeZone,
  MAJOR_MAX_LENGTH,
  PROFILE_ALUMNI_SECTION,
  PROFILE_FIELD_COPY,
  shownNotificationCategories,
  rowsToNotificationCategoryState,
  showsAfterGraduation,
  timeZoneCity,
  type NotificationCategoryKey,
} from "@repo/validation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/hooks/use-toast";
import { BlockedMembersCard } from "@/components/profile/blocked-members-card";
import { DiscordHistoryCard } from "@/components/profile/discord-history-card";
import { ProfileSection } from "@/components/profile/profile-section";
import { ChatDensityControl } from "@/components/profile/chat-density-control";
import { ProfilePhotoControl } from "@/components/profile/profile-photo-control";
import {
  DELETE_ACCOUNT_FAILED,
  useDeleteAccountFlow,
} from "@/components/profile/use-delete-account-flow";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { denseListClassName } from "@/components/shared/table-controls";
import { Switch } from "@/components/ui/switch";
import { useNetwork } from "@/lib/providers/network-provider";
import { signOutCurrentSession } from "@/lib/auth/session";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { getErrorMessage, initials, parseGuardedInt } from "@/lib/utils";
import {
  NotificationSettingsSkeleton,
  ProfilePageSkeleton,
  QuietHoursSkeleton,
} from "@/components/profile/profile-skeleton";
import { InlineNote } from "@/components/shared/inline-note";

type CurrentUser = {
  id?: string;
  email?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  graduation_year?: number | null;
  major?: string | null;
  current_city?: string | null;
  current_company?: string | null;
};

/**
 * The quiet-hour fields `PATCH /v1/settings` accepts and this screen edits.
 *
 * `theme` is deliberately absent. See the Quiet hours section below. Picked from
 * the contract's type, so renaming one of these fields there fails to compile
 * here rather than seeding an empty input.
 */
type UserSettings = Partial<
  Pick<
    StoredUserSettings,
    "quiet_hours_start" | "quiet_hours_end" | "quiet_hours_tz"
  >
>;

/**
 * The offline note under the notification switches, referenced by every one of
 * them through `aria-describedby` while OFFLINE. Named once so the paragraph
 * and its referrers cannot drift apart into a dangling id.
 */
const OFFLINE_NOTE_ID = "notification-categories-offline";

export function ProfilePanel() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const userQuery = useCurrentUser();
  // Your initials wear the color the chapter sees on them (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const ownId = (userQuery.data as CurrentUser | undefined)?.id;
  const settingsQuery = useUserSettings();
  const updateUser = useUpdateUser();
  const updateSettings = useUpdateUserSettings();
  const updateOnboarding = useUpdateOnboarding();
  const deleteFlow = useDeleteAccountFlow({
    onFailed: () => toast({ ...DELETE_ACCOUNT_FAILED, variant: "destructive" }),
  });
  const isDeletingAccount = deleteFlow.isDeleting;
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();
  // The notification categories are per-chapter — `notification_preferences` is
  // keyed `(user_id, chapter_id, category)` — so this card, unlike the rest of
  // /profile, has a tenant. With no active chapter there is nothing to read and
  // the query stays disabled; see the `chapterId` branch below.
  const chapterId = useActiveChapterId();
  const preferencesQuery = useNotificationPreferences(chapterId ?? "");
  const updatePreference = useUpdateNotificationPreference();

  const [profileDraft, setProfileDraft] = useState<CurrentUser>({});
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>({});
  const [isSigningOut, setIsSigningOut] = useState(false);

  // The server payload the draft was last seeded from, so a re-seed can tell a
  // field the member edited from one they left alone.
  const seededFrom = useRef<CurrentUser | null>(null);

  useEffect(() => {
    if (!userQuery.data) return;
    const next = userQuery.data as CurrentUser;
    const previous = seededFrom.current;
    seededFrom.current = next;
    setProfileDraft((draft) => {
      if (!previous) return next;
      // Keep what the member has typed and not saved. A photo change refetches
      // this payload mid-edit (#732), as does a window-focus refetch, and a
      // wholesale re-seed would drop their unsaved name or bio without a word.
      const merged: CurrentUser = { ...next };
      for (const key of Object.keys(draft) as (keyof CurrentUser)[]) {
        if (draft[key] !== previous[key]) {
          (merged as Record<string, unknown>)[key] = draft[key];
        }
      }
      // The photo is never a draft field: it changes only on the server.
      merged.avatar_url = next.avatar_url;
      return merged;
    });
  }, [userQuery.data]);

  useEffect(() => {
    // Hold the draft while a save is in flight or has failed.
    //
    // `useUpdateUserSettings` writes optimistically and rolls back on error
    // (#312), so `settingsQuery.data` now changes twice per save instead of
    // once on success. Without this guard the rollback re-runs this effect and
    // overwrites the draft with the stored settings — silently discarding the
    // edits the member just failed to save, next to a toast telling them to try
    // again. `isError` stays true until the next `mutate`, so the retry path
    // resyncs normally once it succeeds.
    if (updateSettings.isPending || updateSettings.isError) return;
    if (settingsQuery.data) {
      /* eslint-disable react-hooks/set-state-in-effect -- re-seed settings draft from the query except while a save is in flight or failed */
      setSettingsDraft(settingsQuery.data);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [settingsQuery.data, updateSettings.isPending, updateSettings.isError]);

  /*
   * Switching off clears the stored window, so the last one is kept here and
   * comes back when the member switches on again on this page. Mobile keeps
   * the same thing on the device; a fresh page load falls back to 10 PM to 8 AM.
   */
  const lastWindow = useRef<{ start: string; end: string; tz: string | null }>(
    null,
  );
  useEffect(() => {
    const stored = settingsQuery.data;
    if (stored?.quiet_hours_start && stored.quiet_hours_end) {
      lastWindow.current = {
        start: stored.quiet_hours_start,
        end: stored.quiet_hours_end,
        tz: stored.quiet_hours_tz?.trim() || null,
      };
    }
  }, [settingsQuery.data]);

  /*
   * Screen-scale states, in the order `spec/ui/design-system/README.md` §4
   * fixes: offline, then loading, then error, then the screen.
   *
   * There is **no entitlement branch**, deliberately. `useCurrentUser`
   * (`packages/hooks/src/use-user.ts`) sets no `enabled`, so
   * `isPending && fetchStatus === "idle"` is unreachable here — and there is no
   * `<Can>` either, because `/profile` is about the viewer rather than the
   * chapter and there is no permission that could deny it.
   *
   * `isError && data === undefined`, not bare `isError`, and that is the
   * defect this replaces rather than a stylistic preference. TanStack v5 keeps
   * `data` through a *background* refetch failure, so the old `if
   * (userQuery.isError)` unmounted the whole panel — including both draft
   * states — when a window-focus refetch failed. On a screen whose entire
   * purpose is holding text a member is part-way through typing, that discards
   * their work and says nothing about it. Same shape as `<Can>`'s branch since
   * #1211, met on a form.
   */
  const userPaused = userQuery.isPending && userQuery.fetchStatus === "paused";
  if (isOffline && anyReadUncached(userQuery)) {
    return (
      <>
        <NestedOffline
          title="Your profile is unavailable offline"
          description="Reconnect to load your directory entry and notification preferences."
          onRetry={() => void userQuery.refetch()}
          sole
        />
      </>
    );
  }
  if (userQuery.isLoading || userPaused) {
    return <ProfilePageSkeleton />;
  }
  if (userQuery.isError && anyReadUncached(userQuery)) {
    return (
      <>
        <NestedError
          title="Couldn't load your profile"
          description="You're signed in, but Frapp couldn't be reached. Try again in a moment."
          onRetry={() => void userQuery.refetch()}
          sole
        />
      </>
    );
  }

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await updateUser.mutateAsync({
        display_name: profileDraft.display_name ?? undefined,
        bio: profileDraft.bio ?? undefined,
        major: profileDraft.major ?? undefined,
        graduation_year:
          profileDraft.graduation_year === null
            ? null
            : (profileDraft.graduation_year ?? undefined),
        current_city: profileDraft.current_city ?? undefined,
        current_company: profileDraft.current_company ?? undefined,
      });
      toast({
        title: "Profile saved",
        description: "Your chapter directory entry is up to date.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save profile",
        description: getErrorMessage(
          error,
          "Try again or check your connection.",
        ),
        variant: "destructive",
      });
    }
  }

  /*
   * Quiet hours are on exactly when a window is stored: the server derives
   * enforcement from `quiet_hours_start`/`quiet_hours_end`, so the switch reads
   * the stored row, never the draft (spec/behavior/notifications.md § Quiet
   * Hours). Turning it off clears the window; turning it on stores the times
   * in the draft, or 10 PM to 8 AM for a member who has none.
   */
  const storedSettings = settingsQuery.data;
  const quietHoursOn = Boolean(
    storedSettings?.quiet_hours_start && storedSettings?.quiet_hours_end,
  );
  const browserZone = localTimeZone();
  const storedZone = storedSettings?.quiet_hours_tz?.trim() || null;
  // A window stored with no zone is evaluated in UTC by the server, so that is
  // the zone the line below names (spec/behavior/notifications.md § Quiet Hours).
  const zoneInForce = storedZone ?? "UTC";

  async function saveQuietHours(
    patch: UserSettings,
    successTitle: string,
  ): Promise<void> {
    try {
      await updateSettings.mutateAsync(patch);
      toast({ title: successTitle });
    } catch (error) {
      toast({
        title: "Couldn't save quiet hours",
        description: getErrorMessage(
          error,
          "Try again or check your connection.",
        ),
        variant: "destructive",
      });
    }
  }

  function refuseOffline(): boolean {
    if (!isOffline) return false;
    toast({
      title: "You're offline",
      description: "Reconnect to change quiet hours. Nothing has been changed.",
    });
    return true;
  }

  function handleQuietHoursToggle(on: boolean) {
    if (refuseOffline()) return;
    if (!on) {
      void saveQuietHours(
        {
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_tz: null,
        },
        "Quiet hours off",
      );
      return;
    }
    // The window and zone a member had before switching off come back. A
    // remembered zone is never re-judged here (this browser's tzdata can be
    // older than the server's); only a member with none gets this browser's.
    const last = lastWindow.current;
    void saveQuietHours(
      {
        quiet_hours_start: last?.start ?? "22:00",
        quiet_hours_end: last?.end ?? "08:00",
        quiet_hours_tz: last?.tz ?? browserZone,
      },
      "Quiet hours on",
    );
  }

  async function handleSettingsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refuseOffline()) return;
    // Times only. The zone has its own control below, so a save here never
    // touches it, and a blank time can't clear the window by accident: the
    // switch is what turns quiet hours off.
    await saveQuietHours(
      {
        quiet_hours_start: settingsDraft.quiet_hours_start || undefined,
        quiet_hours_end: settingsDraft.quiet_hours_end || undefined,
      },
      "Quiet hours saved",
    );
  }

  function handleUseBrowserZone() {
    if (refuseOffline()) return;
    void saveQuietHours({ quiet_hours_tz: browserZone }, "Time zone updated");
  }

  async function handleSignOut() {
    if (!(await confirmDrop("sign-out"))) return;
    setIsSigningOut(true);
    try {
      await signOutCurrentSession();
      // Deliberately not in a `finally`: on the success path this line never
      // returns, and resetting the flag after it would only ever run on the
      // failure path — where the member does need the control back.
      window.location.assign("/sign-in");
    } catch (error) {
      setIsSigningOut(false);
      toast({
        title: "Couldn't sign out",
        description: getErrorMessage(
          error,
          "Retry in a moment, or close this tab to end the session locally.",
        ),
        variant: "destructive",
      });
    }
  }

  const profile = profileDraft;
  // City and Company wait for the graduation year as typed; a stored value
  // keeps its field showing so it can be cleared (`showsAfterGraduation`).
  const afterGraduation = showsAfterGraduation({
    graduationYear: profile.graduation_year ?? null,
    city: (userQuery.data as CurrentUser | undefined)?.current_city,
    company: (userQuery.data as CurrentUser | undefined)?.current_company,
  });
  const settings = settingsDraft;
  // Two different fallbacks, deliberately: the heading needs *something* to
  // say when a member has not set a display name, but the avatar must not
  // spell the initials of that placeholder — `initials("Your profile")` is
  // "YP", which reads as a person who is not them.
  const storedName = profile.display_name?.trim() ?? "";
  const displayName = storedName || "Your profile";

  /*
   * The Quiet hours section is fed by a *second* query, so it needs a second set
   * of states — it had none. A failed `/v1/settings` fetch rendered empty time
   * fields beside a live Save button, and because the submit maps an unloaded
   * field to `undefined` (so the PATCH omits it), pressing Save sent an empty
   * body and toasted "Preferences saved". That is #1209's "reports a failed
   * fetch as success", one screen over.
   *
   * `sole` is deliberately NOT passed to the nested error and offline states:
   * they sit inside an already-loaded profile page, which is exactly the case
   * `nested-states.tsx` describes as the default, and the reason the prop
   * defaults off. The loading branch is `QuietHoursSkeleton`, which carries
   * its own one-line status.
   */
  const settingsPaused =
    settingsQuery.isPending && settingsQuery.fetchStatus === "paused";
  let preferencesState: React.ReactNode = null;
  if (isOffline && anyReadUncached(settingsQuery)) {
    preferencesState = (
      <NestedOffline
        title="Quiet hours unavailable offline"
        description="Reconnect to load and change when notifications are silenced."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else if (settingsQuery.isLoading || settingsPaused) {
    preferencesState = <QuietHoursSkeleton />;
  } else if (settingsQuery.isError && anyReadUncached(settingsQuery)) {
    preferencesState = (
      <NestedError
        title="Couldn't load your preferences"
        description="Quiet hours couldn't be read, so saving them would overwrite what's stored. Retry in a moment."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

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
    <div className="space-y-6">
      {/*
        One column, capped at a form's width: a 1,100px name field is not a
        form anyone reads. Each block is a section on the page surface under
        its label, not a card (`spec/ui/web-dashboard/README.md` Page grammar).
      */}
      <div className="max-w-2xl space-y-10">
        {/*
          s15's identity header, as far as the data goes. The initials take
          your member tint, as everywhere your face appears (#3860). s15 drew it in
          the house-gold family and this transcribed that as the chapter accent
          until 2026-11-05, when the accent came off people's avatars
          (`foundations.md` §6). Measured in `profile-contrast.spec.ts`.

          s15's role badge and its three stat cards (points / service hrs /
          attendance) are deliberately NOT here: `GET /v1/users/me` carries none
          of those fields and no query this screen holds does either, so building
          them is new feature work rather than a repaint. Filed, not smuggled in.
        */}
        <header className="flex items-center gap-4">
          <Avatar className="h-[84px] w-[84px] border border-border bg-popover">
            {profile.avatar_url ? (
              <AvatarImage src={profile.avatar_url} alt="" />
            ) : null}
            {/*
              Sized off the 84px circle rather than off foundations §7's ladder,
              for `signet-mark.tsx`'s reason: initials in an avatar are a drawn
              mark, not a run of text. s15 draws them at 28 in an 84px circle.
            */}
            <AvatarFallback
              tint={ownId ? avatarTintFor(ownId) : null}
              className="bg-popover text-[26px] font-bold text-muted-foreground"
            >
              {initials(storedName || profile.email || "")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-semibold tracking-tight">
              {displayName}
            </h2>
            {/* An absent email is absent, not a sentence standing in for it. */}
            {profile.email ? (
              <p className="truncate text-sm text-muted-foreground">
                {profile.email}
              </p>
            ) : null}
            <div className="mt-2">
              <ProfilePhotoControl
                hasPhoto={!!profile.avatar_url}
                disabled={isOffline}
              />
            </div>
          </div>
        </header>

        <ProfileSection
          id="directory-profile"
          title="Directory profile"
          hint="Visible to the members of your active chapter."
        >
          <form className="space-y-4" onSubmit={handleProfileSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="display-name">
                {PROFILE_FIELD_COPY.displayName.label}
              </Label>
              <Input
                id="display-name"
                value={profile.display_name ?? ""}
                onChange={(event) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    display_name: event.target.value,
                  }))
                }
                placeholder={PROFILE_FIELD_COPY.displayName.placeholder}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div className="grid gap-2">
                <Label htmlFor="major">{PROFILE_FIELD_COPY.major.label}</Label>
                <Input
                  id="major"
                  value={profile.major ?? ""}
                  maxLength={MAJOR_MAX_LENGTH}
                  onChange={(event) =>
                    setProfileDraft((prev) => ({
                      ...prev,
                      major: event.target.value,
                    }))
                  }
                  placeholder={PROFILE_FIELD_COPY.major.placeholder}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="graduation-year">
                  {PROFILE_FIELD_COPY.graduationYear.label}
                </Label>
                <Input
                  id="graduation-year"
                  aria-label={PROFILE_FIELD_COPY.graduationYear.accessibleLabel}
                  type="number"
                  inputMode="numeric"
                  min={GRADUATION_YEAR_MIN}
                  max={GRADUATION_YEAR_MAX}
                  value={profile.graduation_year ?? ""}
                  placeholder={PROFILE_FIELD_COPY.graduationYear.placeholder}
                  onChange={(event) => {
                    const raw = event.target.value;
                    // Cleared means "no year". The range
                    // (`GRADUATION_YEAR_MIN`–`GRADUATION_YEAR_MAX`) is refused
                    // at submit, by the input's `min`/`max` and by the API,
                    // not here: guarding it on change would refuse the "2"
                    // on the way to "2026" (components.md § Text input,
                    // "When an error shows").
                    const next =
                      raw.trim() === "" ? null : parseGuardedInt(raw);
                    if (next === undefined) return;
                    setProfileDraft((prev) => ({
                      ...prev,
                      graduation_year: next,
                    }));
                  }}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bio">{PROFILE_FIELD_COPY.bio.label}</Label>
              <Textarea
                id="bio"
                value={profile.bio ?? ""}
                onChange={(event) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    bio: event.target.value,
                  }))
                }
                placeholder={PROFILE_FIELD_COPY.bio.placeholder}
                rows={3}
              />
            </div>
            {afterGraduation ? (
              <fieldset className="grid gap-4 pt-2">
                <legend className="mb-4 grid gap-1">
                  <span className="text-sm font-semibold text-foreground">
                    {PROFILE_ALUMNI_SECTION.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {PROFILE_ALUMNI_SECTION.hint}
                  </span>
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="current-city">
                      {PROFILE_FIELD_COPY.city.label}
                    </Label>
                    <Input
                      id="current-city"
                      value={profile.current_city ?? ""}
                      onChange={(event) =>
                        setProfileDraft((prev) => ({
                          ...prev,
                          current_city: event.target.value,
                        }))
                      }
                      placeholder={PROFILE_FIELD_COPY.city.placeholder}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="current-company">
                      {PROFILE_FIELD_COPY.company.label}
                    </Label>
                    <Input
                      id="current-company"
                      value={profile.current_company ?? ""}
                      onChange={(event) =>
                        setProfileDraft((prev) => ({
                          ...prev,
                          current_company: event.target.value,
                        }))
                      }
                      placeholder={PROFILE_FIELD_COPY.company.placeholder}
                    />
                  </div>
                </div>
              </fieldset>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save profile
              </Button>
            </div>
          </form>
        </ProfileSection>

        <ProfileSection
          id="quiet-hours"
          title="Quiet hours"
          hint="Non-urgent notifications stay silent between these times."
        >
          {/*
            The Theme select that used to live here is gone, and the copy that
            promised "theme controls the whole dashboard" with it.
            `next-themes` and the header toggle were deleted in the #920 shell
            slice — the design system is dark-only and `foundations.md` defines no light
            values — so the control had been writing `user_settings.theme` with
            nothing on any surface reading it. `spec/ui/web-dashboard/README.md`
            has asserted "no user-facing theme switch" since that slice; this is
            what makes it true. A control with no reader is deleted, not
            restyled.
          */}
          {preferencesState ?? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="quiet-hours-switch">Quiet hours</Label>
                <Switch
                  id="quiet-hours-switch"
                  checked={quietHoursOn}
                  aria-disabled={isOffline || undefined}
                  onCheckedChange={handleQuietHoursToggle}
                />
              </div>
              {/* The times only while quiet hours are on: off, there is
                  nothing for them to govern (owner, 2026-11-06). */}
              {quietHoursOn ? (
                <form className="space-y-4" onSubmit={handleSettingsSubmit}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="quiet-start">From</Label>
                      <Input
                        id="quiet-start"
                        type="time"
                        required
                        value={settings.quiet_hours_start ?? ""}
                        onChange={(event) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            quiet_hours_start: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="quiet-end">To</Label>
                      <Input
                        id="quiet-end"
                        type="time"
                        required
                        value={settings.quiet_hours_end ?? ""}
                        onChange={(event) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            quiet_hours_end: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  {/* The zone is a fact, not a field. A member who never set
                      one got this browser's when they switched quiet hours on,
                      so this line only speaks up when the zone in force is
                      another one, and offers the one fix that needs no list. */}
                  {zoneInForce !== browserZone ? (
                    <p className="text-sm text-muted-foreground">
                      Times are in {timeZoneCity(zoneInForce)} time.{" "}
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-4"
                        onClick={handleUseBrowserZone}
                      >
                        Use {timeZoneCity(browserZone)} time
                      </button>
                    </p>
                  ) : null}
                  <div className="flex items-center justify-end gap-2">
                    <Button type="submit" disabled={updateSettings.isPending}>
                      {updateSettings.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Save quiet hours
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </ProfileSection>

        {/*
          Anchor target for the top-bar account menu's "Notification settings"
          row. Notification preferences have no route of their own — they are a
          section of this screen — so the menu links here rather than advertising
          a settings page that does not exist. `scroll-mt` clears the sticky
          48px top bar so the heading is not hidden under it on arrival.
        */}
        <ProfileSection
          id="notification-settings"
          title="Notifications"
          hint="For this chapter, on every device you use."
        >
          {categoriesState ?? (
            <div className="space-y-4">
              <ul className={denseListClassName}>
                {shownNotificationCategories().map((category) => {
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
                <p
                  id={OFFLINE_NOTE_ID}
                  className="text-sm text-muted-foreground"
                >
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
                category — `admin` (the member-joined push, `invite.service.ts`)
                is NORMAL priority with no catalog entry either. This names the
                one a member is most likely to go looking for, and does not
                pretend the grid is exhaustive.
              */}
              {/* Chat has no switch here: a channel or DM is muted where it
                  is read (the catalog's docblock in @repo/validation says why
                  the coarse Chat switch was dropped, 2026-11-06). */}
              <p className="text-sm text-muted-foreground">
                Mute a channel or DM from the chat itself.
              </p>
              {isNotificationCategoryKey("announcements") ? null : (
                <p className="text-sm text-muted-foreground">
                  Chapter announcements always arrive. They can carry
                  emergencies, so they are not switchable here.
                </p>
              )}
            </div>
          )}
        </ProfileSection>

        {/*
          How tightly the thread draws (§11 § Density). Kept on the device, so
          the hint says so: a phone can stay cozy while a laptop goes compact.
        */}
        <ProfileSection
          id="chat-density"
          title="Chat density"
          hint="Applies on this browser."
        >
          <ChatDensityControl />
        </ProfileSection>

        {/*
          The durable undo for a chat block (#2313): its own states, because the
          block list is another query on this screen and a failed read of it must
          not look like "nobody is blocked".
        */}
        <BlockedMembersCard />

        <DiscordHistoryCard />

        {/*
          Tutorial, session and deletion were three cards with a paragraph each.
          They are one list of rows now: what the row does on the left, its one
          control on the right, the way the notification switches above read.
        */}
        <ProfileSection id="account" title="Account">
          <ul className={denseListClassName}>
            <li className="flex items-center justify-between gap-4 py-3">
              <div className="grid min-w-0 gap-1">
                <p className="text-sm font-semibold">Tutorial</p>
                <p className="text-sm text-muted-foreground">
                  The onboarding tour reopens on your next dashboard visit.
                </p>
              </div>
              <Button
                variant="secondary"
                size="toolbar"
                className="shrink-0"
                disabled={updateOnboarding.isPending}
                onClick={async () => {
                  try {
                    await updateOnboarding.mutateAsync({
                      has_completed_onboarding: false,
                    });
                    toast({
                      title: "Tutorial queued",
                      description:
                        "The onboarding tour will reappear the next time you open the dashboard.",
                    });
                  } catch (error) {
                    toast({
                      title: "Couldn't reset onboarding",
                      description: getErrorMessage(
                        error,
                        "Retry in a moment. Your permissions may need refreshing.",
                      ),
                      variant: "destructive",
                    });
                  }
                }}
              >
                Replay tutorial
              </Button>
            </li>
            <li className="flex items-center justify-between gap-4 py-3">
              <div className="grid min-w-0 gap-1">
                <p className="text-sm font-semibold">Session</p>
                <p className="text-sm text-muted-foreground">
                  Signing in again refreshes your permissions.
                </p>
              </div>
              <Button
                variant="secondary"
                size="toolbar"
                className="shrink-0"
                onClick={handleSignOut}
                disabled={isSigningOut || isDeletingAccount}
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </Button>
            </li>
            <li className="flex items-center justify-between gap-4 py-3">
              <div className="grid min-w-0 gap-1">
                <p className="text-sm font-semibold">Delete account</p>
                <p className="text-sm text-muted-foreground">
                  Permanently deletes your account. You&apos;ll be asked to
                  confirm.
                </p>
              </div>
              <Button
                variant="destructive"
                size="toolbar"
                className="shrink-0"
                onClick={() => void deleteFlow.start()}
                disabled={isDeletingAccount || isSigningOut}
              >
                {isDeletingAccount ? "Deleting account…" : "Delete account…"}
              </Button>
            </li>
          </ul>
        </ProfileSection>
      </div>
      {deleteFlow.confirmDialog}
      {confirmDropDialog}
    </div>
  );
}
