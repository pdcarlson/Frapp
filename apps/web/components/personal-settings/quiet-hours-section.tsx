"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useUpdateUserSettings,
  useUserSettings,
  type UserSettings as StoredUserSettings,
} from "@repo/hooks";
import { localTimeZone, timeZoneCity } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/lib/hooks/use-toast";
import { ProfileSection } from "@/components/profile/profile-section";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { getErrorMessage } from "@/lib/utils";
import { QuietHoursSkeleton } from "@/components/personal-settings/personal-settings-skeleton";

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
 * Settings → Notifications: quiet hours. They are stored on the person
 * (`user_settings`), not on a chapter, so they sit in the rail's "My account"
 * group and follow the member into every chapter. Moved here from `/profile`
 * with the rest of the personal settings (#3856).
 */
export function QuietHoursSection() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>({});

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

  const settings = settingsDraft;

  /*
   * The Quiet hours section has its own query, so it has its own set of
   * states. On `/profile` it once had none. A failed `/v1/settings` fetch rendered empty time
   * fields beside a live Save button, and because the submit maps an unloaded
   * field to `undefined` (so the PATCH omits it), pressing Save sent an empty
   * body and toasted "Preferences saved". That is #1209's "reports a failed
   * fetch as success", one screen over.
   *
   * `sole` is deliberately NOT passed to the nested error and offline states:
   * they sit inside an already-drawn settings page, which is exactly the case
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

  return (
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
  );
}
