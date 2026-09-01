"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useCurrentUser,
  useDeleteAccount,
  useUpdateOnboarding,
  useUpdateUser,
  useUpdateUserSettings,
  useUserSettings,
} from "@repo/hooks";
import { normalizeTimeZoneInput } from "@repo/validation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  ErrorState,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import {
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { signOutCurrentSession } from "@/lib/auth/session";
import { getErrorMessage, initials } from "@/lib/utils";

type CurrentUser = {
  id?: string;
  email?: string | null;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  graduation_year?: number | null;
  current_city?: string | null;
  current_company?: string | null;
};

/**
 * The quiet-hour fields `PATCH /v1/settings` accepts and this screen edits.
 *
 * `theme` is deliberately absent. See the Preferences card below.
 */
type UserSettings = {
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_tz?: string | null;
};

export function ProfilePanel() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const userQuery = useCurrentUser();
  const settingsQuery = useUserSettings();
  const updateUser = useUpdateUser();
  const updateSettings = useUpdateUserSettings();
  const updateOnboarding = useUpdateOnboarding();
  const deleteAccount = useDeleteAccount();
  const { confirm, confirmDialog } = useConfirmDialog();

  const [profileDraft, setProfileDraft] = useState<CurrentUser>({});
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>({});
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [timeZoneError, setTimeZoneError] = useState<string | null>(null);

  useEffect(() => {
    if (userQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the profile draft from the query; local edits stay until the next server payload
      setProfileDraft(userQuery.data as CurrentUser);
    }
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
      setSettingsDraft(settingsQuery.data as UserSettings);
      // The draft is being replaced wholesale — a refetch on window focus can do
      // this while an error is showing — so the message must go with the value
      // it was about. Otherwise the field reverts to its stored (valid) zone
      // while still flagged invalid.
      setTimeZoneError(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [settingsQuery.data, updateSettings.isPending, updateSettings.isError]);

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
  const userPaused =
    userQuery.isPending && userQuery.fetchStatus === "paused";
  if (isOffline && userQuery.data === undefined) {
    return (
      <OfflineState
        title="Your profile is unavailable offline"
        description="Reconnect to load your directory entry and notification preferences."
        onRetry={() => void userQuery.refetch()}
      />
    );
  }
  if (userQuery.isLoading || userPaused) {
    return <LoadingState message="Loading your profile..." />;
  }
  if (userQuery.isError && userQuery.data === undefined) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        description="Sign in succeeded but we couldn't reach the API. Retry in a moment."
        onRetry={() => void userQuery.refetch()}
      />
    );
  }

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await updateUser.mutateAsync({
        display_name: profileDraft.display_name ?? undefined,
        bio: profileDraft.bio ?? undefined,
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

  async function handleSettingsSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      // Validate only what the member typed; never re-judge what the server
      // stored. Two distinct reasons to leave the field alone:
      //
      //   - `undefined` — the draft never loaded it. It must stay `undefined` so
      //     the PATCH omits it, or we would tell the server to clear a zone we
      //     never showed anyone.
      //   - unchanged from the server's value — this browser's tzdata can be
      //     older than the server's, so our verdict on a stored zone can be a
      //     confident false negative. Blocking on it would abort the whole save
      //     over a field the member never touched, and "fixing" it would
      //     overwrite a zone the server considers perfectly valid.
      //
      // A value the member actually edited is ours to check (blank = clear, so
      // someone holding an unusable zone can always save their way out of it).
      const rawTz = settingsDraft.quiet_hours_tz;
      const serverTz = (settingsQuery.data as UserSettings | undefined)
        ?.quiet_hours_tz;
      let tz: string | null | undefined;
      if (rawTz === undefined || rawTz === serverTz) {
        tz = undefined;
      } else {
        tz = normalizeTimeZoneInput(rawTz);
        if (tz === undefined) {
          setTimeZoneError(
            "Enter a time zone name this server recognizes, like America/Chicago. A fixed offset such as -05:00 is not accepted.",
          );
          return;
        }
      }
      setTimeZoneError(null);

      await updateSettings.mutateAsync({
        quiet_hours_start: settingsDraft.quiet_hours_start ?? undefined,
        quiet_hours_end: settingsDraft.quiet_hours_end ?? undefined,
        quiet_hours_tz: tz,
      });
      toast({
        title: "Preferences saved",
        description: "Quiet hours updated.",
      });
    } catch (error) {
      toast({
        title: "Couldn't save preferences",
        description: getErrorMessage(
          error,
          "Try again or check your connection.",
        ),
        variant: "destructive",
      });
    }
  }

  async function handleSignOut() {
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

  async function handleDeleteAccount() {
    const confirmed = await confirm({
      title: "Delete your account?",
      description:
        'This cannot be undone. Your profile and contact details are erased; chapter history you took part in stays, anonymized as "Deleted User". See the Privacy Policy for what is kept and for how long.',
      confirmLabel: "Delete account",
      tone: "destructive",
    });
    if (!confirmed) return;
    setIsDeletingAccount(true);
    try {
      await deleteAccount.mutateAsync();
    } catch {
      setIsDeletingAccount(false);
      toast({
        title: "Deletion didn't finish",
        description:
          "Part of it may already have gone through, and running it again is safe. Try once more in a moment.",
        variant: "destructive",
      });
      return;
    }
    // The account is gone at this point, so nothing past here should block on
    // — or be undone by — its own failure. `signOutCurrentSession` is
    // best-effort: whether or not it succeeds, the hard navigation below is
    // what actually satisfies `useDeleteAccount`'s "the caller must clear the
    // query cache on success" contract (a full document load discards the
    // in-memory QueryClient; web has no persister), and a signed-out-looking
    // page beats leaving the member on a screen for an account that no longer
    // exists. Deliberately not `handleSignOut()`: that function swallows its
    // own errors and only navigates on its own success path, which would
    // strand the member here — cache intact, no redirect — on a sign-out
    // hiccup immediately after a successful deletion.
    try {
      await signOutCurrentSession();
    } catch {
      // Ignored — see above.
    }
    window.location.assign("/sign-in");
  }

  const profile = profileDraft;
  const settings = settingsDraft;
  // Two different fallbacks, deliberately: the heading needs *something* to
  // say when a member has not set a display name, but the avatar must not
  // spell the initials of that placeholder — `initials("Your profile")` is
  // "YP", which reads as a person who is not them.
  const storedName = profile.display_name?.trim() ?? "";
  const displayName = storedName || "Your profile";

  /*
   * The Preferences card is fed by a *second* query, so it needs a second set
   * of states — it had none. A failed `/v1/settings` fetch rendered empty time
   * fields beside a live Save button, and because the submit maps an unloaded
   * field to `undefined` (so the PATCH omits it), pressing Save sent an empty
   * body and toasted "Preferences saved". That is #1209's "reports a failed
   * fetch as success", one screen over.
   *
   * `sole` is deliberately NOT passed. The panel already owns a screen-scale
   * `LoadingState` above, so the live region and the `<h2>` promotion belong to
   * that one — which is exactly the case `nested-states.tsx` describes as the
   * default, and the reason the prop defaults off.
   */
  const settingsPaused =
    settingsQuery.isPending && settingsQuery.fetchStatus === "paused";
  let preferencesState: React.ReactNode = null;
  if (isOffline && settingsQuery.data === undefined) {
    preferencesState = (
      <NestedOffline
        title="Quiet hours unavailable offline"
        description="Reconnect to load and change when notifications are silenced."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  } else if (settingsQuery.isLoading || settingsPaused) {
    preferencesState = (
      <NestedLoading message="Loading your preferences..." lines={3} />
    );
  } else if (settingsQuery.isError && settingsQuery.data === undefined) {
    preferencesState = (
      <NestedError
        title="Couldn't load your preferences"
        description="Quiet hours couldn't be read, so saving them would overwrite what's stored. Retry in a moment."
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/*
        s15's identity header, as far as the data goes.
        `--accent-subtle` / `--accent-border` / `--accent-text` is the token
        transcription of the board's `#251E0E` / `#6B5619` / `#F4CB63` — the
        board draws one seed (its header says the demo tenant runs house gold)
        and the engine ships nineteen, so the accent roles are what generalise.
        Measured across all of them in `profile-contrast.test.ts`.

        s15's role badge and its three stat cards (points / service hrs /
        attendance) are deliberately NOT here: `GET /v1/users/me` carries none
        of those fields and no query this screen holds does either, so building
        them is new feature work rather than a repaint. Filed, not smuggled in.
      */}
      <header className="flex items-center gap-4">
        <Avatar className="h-[84px] w-[84px] border border-accent-border bg-accent-subtle">
          {profile.avatar_url ? (
            <AvatarImage src={profile.avatar_url} alt="" />
          ) : null}
          {/*
            Sized off the 84px circle rather than off foundations §7's ladder,
            for `signet-mark.tsx`'s reason: initials in an avatar are a drawn
            mark, not a run of text. s15 draws them at 28 in an 84px circle.
          */}
          <AvatarFallback className="bg-accent-subtle text-[26px] font-bold text-accent-text">
            {initials(storedName || profile.email || "")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold tracking-tight">
            {displayName}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {profile.email ?? "Update how your chapter sees you in the directory."}
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Directory profile</CardTitle>
          <CardDescription>
            Visible to the members of your active chapter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleProfileSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={profile.display_name ?? ""}
                onChange={(event) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    display_name: event.target.value,
                  }))
                }
                placeholder="Your full name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={profile.bio ?? ""}
                onChange={(event) =>
                  setProfileDraft((prev) => ({
                    ...prev,
                    bio: event.target.value,
                  }))
                }
                placeholder="Major, year, anything brothers should know."
                rows={3}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="graduation-year">Graduation year</Label>
                <Input
                  id="graduation-year"
                  type="number"
                  min={1900}
                  max={2100}
                  value={profile.graduation_year ?? ""}
                  onChange={(event) =>
                    setProfileDraft((prev) => ({
                      ...prev,
                      graduation_year: event.target.value
                        ? Number(event.target.value)
                        : null,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="current-city">City</Label>
                <Input
                  id="current-city"
                  value={profile.current_city ?? ""}
                  onChange={(event) =>
                    setProfileDraft((prev) => ({
                      ...prev,
                      current_city: event.target.value,
                    }))
                  }
                  placeholder="Optional, for alumni directory"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="current-company">Company</Label>
                <Input
                  id="current-company"
                  value={profile.current_company ?? ""}
                  onChange={(event) =>
                    setProfileDraft((prev) => ({
                      ...prev,
                      current_company: event.target.value,
                    }))
                  }
                  placeholder="Optional, for alumni directory"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          {/*
            The Theme select that used to live here is gone, and the copy that
            promised "theme controls the whole dashboard" with it.
            `next-themes` and the header toggle were deleted in the #920 shell
            slice — Signet is dark-only and `foundations.md` defines no light
            values — so the control had been writing `user_settings.theme` with
            nothing on any surface reading it. `spec/ui/web-dashboard/README.md`
            has asserted "no user-facing theme switch" since that slice; this is
            what makes it true. A control with no reader is deleted, not
            restyled.
          */}
          <CardDescription>
            Quiet hours silence non-urgent notifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preferencesState ?? (
            <form className="space-y-4" onSubmit={handleSettingsSubmit}>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="quiet-start">Quiet hours start</Label>
                  <Input
                    id="quiet-start"
                    type="time"
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
                  <Label htmlFor="quiet-end">Quiet hours end</Label>
                  <Input
                    id="quiet-end"
                    type="time"
                    value={settings.quiet_hours_end ?? ""}
                    onChange={(event) =>
                      setSettingsDraft((prev) => ({
                        ...prev,
                        quiet_hours_end: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="quiet-tz">Timezone</Label>
                  <Input
                    id="quiet-tz"
                    value={settings.quiet_hours_tz ?? ""}
                    onChange={(event) => {
                      setTimeZoneError(null);
                      setSettingsDraft((prev) => ({
                        ...prev,
                        quiet_hours_tz: event.target.value,
                      }));
                    }}
                    placeholder="e.g. America/Chicago"
                    aria-invalid={timeZoneError ? true : undefined}
                    aria-describedby={
                      timeZoneError ? "quiet-tz-error" : undefined
                    }
                  />
                  {timeZoneError ? (
                    <p id="quiet-tz-error" className="text-sm text-destructive">
                      {timeZoneError}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" disabled={updateSettings.isPending}>
                  {updateSettings.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Save preferences
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tutorial</CardTitle>
          <CardDescription>
            Replay the onboarding tour. It&apos;ll reopen on your next dashboard
            visit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Sign out of this device. Signing in again refreshes your permission
            set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="secondary"
            onClick={handleSignOut}
            disabled={isSigningOut || isDeletingAccount}
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </Button>
          <div className="space-y-1.5 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Permanently deletes your account. You&apos;ll be asked to
              confirm.
            </p>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteAccount()}
              disabled={isDeletingAccount || isSigningOut}
            >
              {isDeletingAccount ? "Deleting account…" : "Delete account…"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
