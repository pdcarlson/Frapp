"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRedeemInvite } from "@repo/hooks";
import { AuthNote, AuthScreen } from "@/components/auth/auth-screen";
import { joinErrorCopy, redeemChapterId } from "@/components/auth/join-errors";
import { LinkGlyph } from "@/components/profile/profile-glyphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ErrorState,
  OfflineState,
  SkeletonText,
} from "@/components/shared/async-states";
import { useToast } from "@/hooks/use-toast";
import { getSessionUser } from "@/lib/auth/session";
import { useSelectChapter } from "@/lib/auth/select-chapter";
import { useNetwork } from "@/lib/providers/network-provider";

/**
 * s02 — Join chapter (`spec/ui/design-system/reference/canvas-screens.dc.html`).
 *
 * **Where the transcription stops, and why.** s02 draws a six-cell row for a
 * shared chapter code. `spec/behavior/onboarding.md` §Invite Token Rules
 * specifies single-use opaque tokens that expire after 24 hours, and
 * `spec/ui/README.md`'s precedence rule puts behavior above UI on what the
 * product *does* — so the chrome transfers and the input model does not. This
 * is the same call `apps/mobile/app/(auth)/join.tsx` already records in its own
 * docstring; both surfaces now say it in the same place so neither drifts.
 *
 * The #920 Profile & pre-auth slice replaced a two-card grid that explained
 * database behaviour to a member ("Invite redemption writes directly to the
 * chapter membership table") and carried an emerald notice reading "This route
 * is intended for staging validation of real invite + member directory
 * behavior" — the family's last raw-palette colour and last inert `dark:`
 * variant, which shipped as near-black text on `#0E0D0B`.
 *
 * Two failure paths that had none before:
 *
 * - **The session check.** `getSessionUser()` is a network call, and it ran as
 *   a bare `void ensureSession()` with no `catch`. A member who opened an
 *   invite link on a dropped connection sat on "Verifying your session…"
 *   forever, with no retry and nothing announced.
 * - **Redemption.** Every failure rendered one generic toast. 410 and 409 need
 *   opposite next actions, so the copy comes from `join-errors.ts` and is
 *   rendered inline beside the field rather than as a toast that scrolls away.
 */
function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const redeemInviteMutation = useRedeemInvite();
  const selectChapter = useSelectChapter();
  const initialToken = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [editedToken, setEditedToken] = useState<string | null>(null);
  const token = editedToken ?? initialToken;
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "failed">(
    "checking",
  );
  const [attempt, setAttempt] = useState(0);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function ensureSession() {
      try {
        const user = await getSessionUser();
        if (!isMounted) {
          return;
        }

        if (!user) {
          const signInUrl = new URL("/sign-in", window.location.origin);
          signInUrl.searchParams.set("redirectTo", `/join${window.location.search}`);
          router.replace(signInUrl.pathname + signInUrl.search);
          return;
        }

        setSessionState("ready");
      } catch {
        // The check itself could not be made. That is recoverable and must say
        // so — the previous `void ensureSession()` left the member on the
        // pending branch with no way out.
        if (isMounted) setSessionState("failed");
      }
    }

    void ensureSession();

    return () => {
      isMounted = false;
    };
  }, [router, attempt]);

  const retrySessionCheck = useCallback(() => {
    setSessionState("checking");
    setAttempt((current) => current + 1);
  }, []);

  async function handleRedeem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRedeemError(null);
    try {
      const result = await redeemInviteMutation.mutateAsync({
        token: token.trim(),
      });
      const chapterId = redeemChapterId(result);

      if (chapterId) {
        // Persists the selection, refreshes the session so the new
        // active_chapter_id claim is issued, then updates local state.
        await selectChapter(chapterId);
      }

      toast({
        title: "Chapter joined",
        description: "You're in. Opening chat.",
      });
      router.replace("/chat");
      router.refresh();
    } catch (error) {
      setRedeemError(joinErrorCopy(error));
    }
  }

  if (sessionState === "checking") {
    return (
      <AuthScreen
        title="Join your chapter"
        subtitle="Enter the invite your officer sent. Invites expire after 24 hours and work once."
      >
        <div role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Verifying your session…</span>
          <SkeletonText lines={3} />
        </div>
      </AuthScreen>
    );
  }

  if (sessionState === "failed") {
    return (
      <AuthScreen
        title="Join your chapter"
        subtitle="Enter the invite your officer sent. Invites expire after 24 hours and work once."
      >
        {isOffline ? (
          <OfflineState
            title="Can't check your session"
            description="Reconnect to confirm you're signed in, then redeem the invite."
            onRetry={retrySessionCheck}
          />
        ) : (
          <ErrorState
            title="Couldn't check your session"
            description="We couldn't reach the API to confirm you're signed in. Retry in a moment."
            onRetry={retrySessionCheck}
          />
        )}
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Join your chapter"
      subtitle="Enter the invite your officer sent. Invites expire after 24 hours and work once."
    >
      <form className="flex flex-col gap-4" onSubmit={handleRedeem}>
        <div className="space-y-1.5">
          <Label htmlFor="invite-token">Invite</Label>
          <Input
            id="invite-token"
            // foundations §7 names invite tokens in the reserved mono list: it
            // is a machine value a member reads character by character.
            className="font-mono"
            value={token}
            onChange={(event) => {
              setEditedToken(event.target.value);
              setRedeemError(null);
            }}
            placeholder="Paste your invite"
            required
            aria-invalid={redeemError ? true : undefined}
            aria-describedby={redeemError ? "invite-error" : undefined}
          />
          {redeemError ? (
            <p id="invite-error" className="text-sm text-destructive">
              {redeemError}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={redeemInviteMutation.isPending}
        >
          {redeemInviteMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : null}
          Join chapter
        </Button>
      </form>

      <div className="mt-6">
        <AuthNote glyph={<LinkGlyph className="h-5 w-5" />}>
          Got an invite link? Open it and this page fills itself in.
        </AuthNote>
      </div>
    </AuthScreen>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen
          title="Join your chapter"
          subtitle="Enter the invite your officer sent. Invites expire after 24 hours and work once."
        >
          <div role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading the invite form…</span>
            <SkeletonText lines={3} />
          </div>
        </AuthScreen>
      }
    >
      <JoinPageContent />
    </Suspense>
  );
}
