"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useCurrentUser,
  useUpdateUser,
  useUpdateUserSettings,
  useUserSettings,
} from "@repo/hooks";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ErrorState, LoadingState } from "@/components/shared/async-states";
import { signOutCurrentSession } from "@/lib/auth/session";

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

type UserSettings = {
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_tz?: string | null;
  theme?: "light" | "dark" | "system";
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

export function ProfilePanel() {
  const { toast } = useToast();
  const userQuery = useCurrentUser();
  const settingsQuery = useUserSettings();
  const updateUser = useUpdateUser();
  const updateSettings = useUpdateUserSettings();

  const [profileDraft, setProfileDraft] = useState<CurrentUser>({});
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>({});
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (userQuery.data) {
      setProfileDraft(userQuery.data as CurrentUser);
    }
  }, [userQuery.data]);

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsDraft(settingsQuery.data as UserSettings);
    }
  }, [settingsQuery.data]);

  if (userQuery.isPending) {
    return <LoadingState message="Loading your profile..." />;
  }

  if (userQuery.isError) {
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
            : profileDraft.graduation_year ?? undefined,
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
      await updateSettings.mutateAsync({
        quiet_hours_start: settingsDraft.quiet_hours_start ?? undefined,
        quiet_hours_end: settingsDraft.quiet_hours_end ?? undefined,
        quiet_hours_tz: settingsDraft.quiet_hours_tz ?? undefined,
        theme: settingsDraft.theme,
      });
      toast({
        title: "Preferences saved",
        description: "Quiet hours and theme preferences updated.",
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
      window.location.assign("/sign-in");
    } finally {
      setIsSigningOut(false);
    }
  }

  const profile = profileDraft;
  const settings = settingsDraft;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">My profile</h2>
        <p className="text-sm text-muted-foreground">
          Update how your chapter sees you in the directory and how Frapp
          notifies you.
        </p>
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
          <CardDescription>
            Quiet hours silence non-urgent notifications; theme controls the
            whole dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                <Label htmlFor="quiet-tz">Timezone offset</Label>
                <Input
                  id="quiet-tz"
                  value={settings.quiet_hours_tz ?? ""}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      quiet_hours_tz: event.target.value,
                    }))
                  }
                  placeholder="e.g. America/Chicago"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="theme">Theme</Label>
              <Select
                value={settings.theme ?? "system"}
                onValueChange={(value) =>
                  setSettingsDraft((prev) => ({
                    ...prev,
                    theme: value as "light" | "dark" | "system",
                  }))
                }
              >
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Sign out of this device. Signing in again refreshes your
            permission set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
