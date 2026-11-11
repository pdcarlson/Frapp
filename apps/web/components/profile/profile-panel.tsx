"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  useCurrentUser,
  useMemberDisplayNames,
  useUpdateUser,
} from "@repo/hooks";
import {
  GRADUATION_YEAR_MAX,
  GRADUATION_YEAR_MIN,
  MAJOR_MAX_LENGTH,
  PROFILE_ALUMNI_SECTION,
  PROFILE_FIELD_COPY,
  showsAfterGraduation,
} from "@repo/validation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/lib/hooks/use-toast";
import { ProfileSection } from "@/components/profile/profile-section";
import { ProfilePhotoControl } from "@/components/profile/profile-photo-control";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { useNetwork } from "@/lib/providers/network-provider";
import { getErrorMessage, initials, parseGuardedInt } from "@/lib/utils";
import { ProfilePageSkeleton } from "@/components/profile/profile-skeleton";

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
 * `/profile`: who you are in the directory. Name, photo, major, year, bio and
 * the after-graduation fields, and nothing else: quiet hours, chapter alerts,
 * chat density, blocked members, Discord history and the account controls
 * moved to the personal Settings page (`/preferences`,
 * `components/personal-settings/`, #3856).
 */
export function ProfilePanel() {
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const userQuery = useCurrentUser();
  // Your initials wear the color the chapter sees on them (#3860).
  const { avatarTintFor } = useMemberDisplayNames();
  const ownId = (userQuery.data as CurrentUser | undefined)?.id;
  const updateUser = useUpdateUser();

  const [profileDraft, setProfileDraft] = useState<CurrentUser>({});

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
   * (userQuery.isError)` unmounted the whole panel — including the draft
   * state — when a window-focus refetch failed. On a screen whose entire
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
          description="Reconnect to load your directory entry."
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

  const profile = profileDraft;
  // City and Company wait for the graduation year as typed; a stored value
  // keeps its field showing so it can be cleared (`showsAfterGraduation`).
  const afterGraduation = showsAfterGraduation({
    graduationYear: profile.graduation_year ?? null,
    city: (userQuery.data as CurrentUser | undefined)?.current_city,
    company: (userQuery.data as CurrentUser | undefined)?.current_company,
  });
  // Two different fallbacks, deliberately: the heading needs *something* to
  // say when a member has not set a display name, but the avatar must not
  // spell the initials of that placeholder — `initials("Your profile")` is
  // "YP", which reads as a person who is not them.
  const storedName = profile.display_name?.trim() ?? "";
  const displayName = storedName || "Your profile";

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
              The headline role (foundations §7), as mobile's profile photo
              draws the same 84px circle's initials (`profile-photo.tsx`), so
              both apps size them alike (#3830).
            */}
            <AvatarFallback
              tint={ownId ? avatarTintFor(ownId) : null}
              className="bg-popover text-headline font-bold text-muted-foreground"
            >
              {initials(storedName || profile.email || "")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="truncate text-headline font-bold tracking-tight">
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
      </div>
    </div>
  );
}
