"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  useActiveChapterId,
  useCurrentUser,
  useUpdateOnboarding,
  useUpdateUser,
} from "@repo/hooks";
import {
  DISPLAY_NAME_MAX_LENGTH,
  ONBOARDING_YOU_COPY,
  initialNameField,
  typedNameMissing,
} from "@repo/validation";
import { AuthScreen } from "@/components/auth/auth-screen";
import { ProfilePhotoControl } from "@/components/profile/profile-photo-control";
import {
  ErrorState,
  OfflineState,
  SkeletonText,
} from "@/components/shared/async-states";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markWelcomeDue } from "@/lib/onboarding/welcome-due";
import { useNetwork } from "@/lib/providers/network-provider";
import { initials } from "@/lib/utils";

type Me = {
  id?: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

/**
 * "How the chapter sees you": the screen a member sees on the web right after
 * joining a chapter, before chat (#5627; Paul's pick 2026-11-19, "Two: name,
 * then notifications"). The phone's s03 shows the same screen, in the same
 * order and words (`apps/mobile/app/(auth)/welcome.tsx`); the phone then asks
 * about notifications, which the web has no second screen for, so here the
 * one button goes to chat.
 *
 * The name is pre-filled when sign-in carried a real one (Apple or Google). A
 * name that is only the API's `Member` or the email before the `@` starts
 * empty (`needsName` in `@repo/validation`), and a typed name is required (`typedNameMissing`), because every
 * message the member sends carries it. The photo is optional and saves on its
 * own, as it does on Profile.
 *
 * Leaving marks onboarding done (`has_completed_onboarding`), as the phone's
 * s03 does, so the Directory stops listing the member as pending. The phone
 * then skips s03 for them, and its chat home asks about notifications once
 * instead (`usePushReminder`, which offers to a member never asked).
 */
export function WelcomeYou() {
  const router = useRouter();
  const { isOffline } = useNetwork();
  const userQuery = useCurrentUser();
  const updateUser = useUpdateUser();
  const updateOnboarding = useUpdateOnboarding();
  const chapterId = useActiveChapterId();
  const me = userQuery.data as Me | undefined;
  // `null` until typed in: the field shows the loaded name until then.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (!me) {
    if (isOffline && userQuery.isPending) {
      return (
        <AuthScreen title={ONBOARDING_YOU_COPY.title}>
          <OfflineState
            title="Can't load your profile"
            description="Reconnect to add your name and photo."
            onRetry={() => void userQuery.refetch()}
          />
        </AuthScreen>
      );
    }
    if (userQuery.isError) {
      return (
        <AuthScreen title={ONBOARDING_YOU_COPY.title}>
          <ErrorState
            title="Couldn't load your profile"
            description="Frapp couldn't be reached. Try again in a moment."
            onRetry={() => void userQuery.refetch()}
          />
        </AuthScreen>
      );
    }
    return (
      <AuthScreen
        title={ONBOARDING_YOU_COPY.title}
        subtitle={ONBOARDING_YOU_COPY.lede}
      >
        <SkeletonText lines={3} />
      </AuthScreen>
    );
  }

  const storedName = (me.display_name ?? "").trim();
  const nameValue =
    nameDraft ?? initialNameField(me.display_name, me.email ?? null);

  // Validated on Go to chat, not per keystroke. A name that didn't change
  // isn't sent again; one that did is saved first, so a failure keeps the
  // member here with the reason rather than losing the name.
  async function leave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (leaving) return;
    const name = nameValue.trim();
    if (typedNameMissing(name)) {
      setNameError(ONBOARDING_YOU_COPY.nameRequired);
      return;
    }
    setLeaving(true);
    if (name !== storedName) {
      try {
        await updateUser.mutateAsync({ display_name: name });
      } catch {
        setNameError(ONBOARDING_YOU_COPY.saveFailed);
        setLeaving(false);
        return;
      }
    }
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
    } catch {
      // Non-fatal: the member is in, and the Directory says pending a while.
    }
    // The welcome card in the default channel shows once (#5627).
    if (me?.id && chapterId) markWelcomeDue(me.id, chapterId);
    // Stays busy: the page is on its way to chat.
    router.replace("/chat");
  }

  return (
    <AuthScreen
      title={ONBOARDING_YOU_COPY.title}
      subtitle={ONBOARDING_YOU_COPY.lede}
    >
      <form noValidate onSubmit={(event) => void leave(event)}>
        {/*
          The photo beside its controls, as Profile draws it on the web
          (#4137): the 84px circle the phone draws over the name.
        */}
        <div className="flex items-center gap-4">
          <Avatar className="h-[84px] w-[84px] border border-border bg-popover">
            {me.avatar_url ? <AvatarImage src={me.avatar_url} alt="" /> : null}
            <AvatarFallback className="bg-popover text-headline font-bold text-foreground">
              {initials(nameValue.trim() || null)}
            </AvatarFallback>
          </Avatar>
          <ProfilePhotoControl
            hasPhoto={!!me.avatar_url}
            disabled={isOffline || leaving}
          />
        </div>

        <div className="mt-6 grid gap-1.5">
          <Label htmlFor="welcome-name">{ONBOARDING_YOU_COPY.nameLabel}</Label>
          <Input
            id="welcome-name"
            value={nameValue}
            onChange={(event) => {
              setNameDraft(event.target.value);
              setNameError(null);
            }}
            placeholder={ONBOARDING_YOU_COPY.namePlaceholder}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="name"
            autoCapitalize="words"
            spellCheck={false}
            disabled={leaving}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "welcome-name-error" : undefined}
          />
          <p
            id="welcome-name-error"
            aria-live="polite"
            className="min-h-5 text-sm text-destructive"
          >
            {nameError}
          </p>
        </div>

        <Button
          type="submit"
          className="mt-4 w-full"
          disabled={leaving}
          aria-busy={leaving}
        >
          {leaving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          {ONBOARDING_YOU_COPY.goToChat}
        </Button>
      </form>
    </AuthScreen>
  );
}
