"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  joinErrorCopy,
  pendingInviteDetail,
  pendingInviteTitle,
  redeemChapterId,
  useAccessibleChapters,
  useActiveChapterId,
  useJoinTermsCheckbox,
  useMyPermissions,
  usePendingInvites,
  useRedeemInvite,
} from "@repo/hooks";
import type { ChapterMembershipSummary } from "@repo/hooks";
import {
  chapterInitials,
  extractInviteToken,
  extractInviteTokenFromQuery,
} from "@repo/validation";
import { AuthNote, AuthScreen } from "@/components/auth/auth-screen";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { LinkGlyph } from "@/components/profile/profile-glyphs";
import { CrestTile } from "@/components/layout/crest-tile";
import { SignedInAs } from "@/components/auth/signed-in-as";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ErrorState,
  OfflineState,
  SkeletonText,
} from "@/components/shared/async-states";
import { useToast } from "@/lib/hooks/use-toast";
import { getLiveSessionUser } from "@/lib/auth/rejected-session";
import { useSelectChapter } from "@/lib/auth/select-chapter";
import { useNetwork } from "@/lib/providers/network-provider";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { asArray } from "@/lib/utils";
import { isLockedOutOfChapter } from "@/lib/auth/no-access";
import {
  isJoinSkipCandidate,
  shouldSkipJoinForMember,
} from "@/lib/auth/join-visit";

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
 * The field accepts a pasted raw token or the join URL officers copy
 * (`extractInviteToken`); posting the URL as the token is a 410.
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
 * - **The session check.** It is a network call (`getLiveSessionUser()`; then a
 *   helper since deleted), and it ran as
 *   a bare `void ensureSession()` with no `catch`. A member who opened an
 *   invite link on a dropped connection sat on "Verifying your session…"
 *   forever, with no retry and nothing announced.
 * - **Redemption.** Every failure rendered one generic toast. 410 and 409 need
 *   opposite next actions, so the copy comes from `joinErrorCopy` (`@repo/hooks`) and is
 *   rendered inline beside the field rather than as a toast that scrolls away.
 *
 * **#3776.** The session check asks Auth (`getLiveSessionUser`) and clears a
 * cookie Auth refuses. `proxy.ts` trusts the cookie, so a refused one used to
 * bounce the visitor between here and `/sign-in` with the skeleton up for
 * good. Once signed in, the invites emailed to the account's verified address
 * (`GET /v1/invites/mine`) are offered above the field, each a one-tap Join,
 * so a member who signs in with that address needn't go back for the link.
 * A visitor who arrived with an invite link sees only that invite.
 *
 * **#3850.** A member already in a chapter reaches this page too: from an
 * invite link (an old one for their own chapter, or one for a second), the
 * chapter switcher's Join another chapter, `/no-access`, or the sign-in
 * footer's Join your chapter. The page used to give them no way back, so it
 * read as a failed sign-in. Now it leads with "You're already in <chapter>"
 * and Open chat, but only for a member with access there: `/no-access` sends
 * a member with no role here, and Open chat would loop them back to it. Only
 * the sign-in footer's visit can skip the page outright, decided once on
 * arrival (`shouldSkipJoinForMember`), so a join made on this page never
 * re-triggers it mid-redeem. The other entries are deliberate.
 */
function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const redeemInviteMutation = useRedeemInvite();
  const selectChapter = useSelectChapter();
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();
  const initialToken = useMemo(
    () => extractInviteTokenFromQuery((key) => searchParams.get(key)) ?? "",
    [searchParams],
  );
  const [editedToken, setEditedToken] = useState<string | null>(null);
  const token = editedToken ?? initialToken;
  const [sessionState, setSessionState] = useState<
    "checking" | "ready" | "failed"
  >("checking");
  const [account, setAccount] = useState<{
    id: string;
    email: string | null;
  } | null>(null);
  const userId = account?.id ?? null;
  const [attempt, setAttempt] = useState(0);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  // When to show the Terms checkbox, and what a refused join means for it,
  // is shared with mobile s02 (#2302).
  const terms = useJoinTermsCheckbox({ enabled: sessionState === "ready" });
  const pendingInvites = usePendingInvites(
    sessionState === "ready" ? userId : null,
  );
  // A link carries one invite, and that is the one the visitor came for.
  const offers = initialToken ? [] : (pendingInvites.data ?? []);
  const chaptersQuery = useAccessibleChapters({
    enabled: sessionState === "ready",
  });
  const activeChapterId = useActiveChapterId();
  const memberships = asArray<ChapterMembershipSummary>(chaptersQuery.data);
  const currentMembership =
    memberships.find((m) => m.chapter_id === activeChapterId) ??
    memberships[0] ??
    null;
  const permissionsQuery = useMyPermissions({
    enabled: sessionState === "ready",
  });
  // `NoAccessRedirect`'s own rule: a member it would send to `/no-access` gets
  // no Open chat and no skip, since `/chat` would send them straight back.
  // An unanswered or disabled read counts as access, as it does there.
  const hasAccess = !isLockedOutOfChapter(
    permissionsQuery.data?.permissions,
    memberships.length,
  );
  const openChatMembership = hasAccess ? currentMembership : null;

  const visitFrom = searchParams.get("from");
  const visitHasInvite = initialToken !== "";
  const skipCandidate = isJoinSkipCandidate({
    from: visitFrom,
    hasInvite: visitHasInvite,
  });
  // Decided once, on arrival. Re-deciding on every render would fire mid-join:
  // a redeem refetches the chapter list, which turns 0 memberships into 1
  // while `selectChapter` is still running.
  const [skipDecision, setSkipDecision] = useState<
    "undecided" | "skip" | "stay"
  >("undecided");
  // `isLoading`, not `isPending`: a read paused offline isn't loading, so the
  // decision falls to "stay" and the form shows instead of a skeleton for good.
  const skipReadsLoading =
    chaptersQuery.isLoading ||
    pendingInvites.isLoading ||
    permissionsQuery.isLoading;
  const awaitingSkipDecision =
    skipCandidate && sessionState === "ready" && skipDecision === "undecided";
  const [joiningToken, setJoiningToken] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  // Held for the whole join, not just the API call: `selectChapter` and the
  // navigation run after the mutation settles, and a second Join in that
  // window would redeem another invite and race the first over which chapter
  // ends up active.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function ensureSession() {
      try {
        const user = await getLiveSessionUser();
        if (!isMounted) {
          return;
        }

        if (!user) {
          const signInUrl = new URL("/sign-in", window.location.origin);
          signInUrl.searchParams.set(
            "redirectTo",
            `/join${window.location.search}`,
          );
          router.replace(signInUrl.pathname + signInUrl.search);
          return;
        }

        setAccount({ id: user.id, email: user.email ?? null });
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

  // Decided while rendering (React's "adjusting state when a prop changes"),
  // once the reads it needs have settled; the effect below only navigates.
  if (awaitingSkipDecision && !skipReadsLoading) {
    setSkipDecision(
      shouldSkipJoinForMember({
        from: visitFrom,
        hasInvite: visitHasInvite,
        membershipCount: memberships.length,
        offerCount: pendingInvites.data?.length ?? 0,
        hasAccess,
      })
        ? "skip"
        : "stay",
    );
  }

  useEffect(() => {
    if (skipDecision === "skip") router.replace("/chat");
  }, [skipDecision, router]);

  const retrySessionCheck = useCallback(() => {
    setSessionState("checking");
    setAttempt((current) => current + 1);
  }, []);

  async function handleRedeem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRedeemError(null);
    setOfferError(null);
    const extracted = extractInviteToken(token);
    if (!extracted) {
      setRedeemError(
        "Paste the invite your officer sent, or open the invite link.",
      );
      return;
    }
    await redeem(extracted, setRedeemError);
  }

  /** An offered invite's Join: the same redeem, with its token. */
  async function handleJoinOffer(offerToken: string) {
    setRedeemError(null);
    setOfferError(null);
    setJoiningToken(offerToken);
    try {
      await redeem(offerToken, setOfferError);
    } finally {
      setJoiningToken(null);
    }
  }

  async function redeem(extracted: string, onError: (copy: string) => void) {
    if (busy) return;
    if (terms.blocker) {
      onError(terms.blocker);
      return;
    }
    setBusy(true);
    let joined = false;
    try {
      // Joining switches to the new chapter, which ends this tab's Bulk upload.
      if (!(await confirmDrop("switch"))) return;
      joined = await joinWith(extracted, onError);
    } finally {
      // A join that landed keeps the page locked: `router.replace` only starts
      // the navigation, and this page stays mounted until `/chat` arrives.
      if (!joined) setBusy(false);
    }
  }

  /** True once the member is in and the page is on its way to `/chat`. */
  async function joinWith(
    extracted: string,
    onError: (copy: string) => void,
  ): Promise<boolean> {
    try {
      const result = await redeemInviteMutation.mutateAsync(
        terms.redeemBody(extracted),
      );
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
      return true;
    } catch (error) {
      terms.onJoinError(error);
      onError(joinErrorCopy(error));
      return false;
    }
  }

  if (
    sessionState === "checking" ||
    awaitingSkipDecision ||
    skipDecision === "skip"
  ) {
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
            description="Frapp couldn't be reached to confirm you're signed in. Try again in a moment."
            onRetry={retrySessionCheck}
          />
        )}
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      toggle={
        <SignedInAs
          email={account?.email ?? null}
          disabled={busy}
          // Signing in as someone else keeps the invite this page was opened with.
          returnTo={`/join${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}
        />
      }
      title="Join your chapter"
      subtitle="Enter the invite your officer sent. Invites expire after 24 hours and work once."
      footer={JOIN_FOOTER}
    >
      {openChatMembership ? (
        <section
          aria-label="Your chapter"
          className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-card p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {`You're already in ${openChatMembership.chapter?.name ?? "a chapter"}`}
            </p>
            <p className="text-xs text-muted-foreground">
              Have an invite to another chapter? Use it below.
            </p>
          </div>
          <Button
            asChild
            // One primary per screen: an offered invite's Join outranks it.
            variant={offers.length > 0 ? "secondary" : "default"}
          >
            <Link href="/chat">Open chat</Link>
          </Button>
        </section>
      ) : null}
      {offers.length > 0 ? (
        <section aria-label="Your invites" className="mb-6 flex flex-col gap-3">
          {offers.map((offer) => (
            <div
              key={offer.token}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
            >
              <CrestTile
                mark={{
                  logoUrl: null,
                  text: offer.mark_text ?? chapterInitials(offer.chapter_name),
                  source: offer.mark_text ? "short_name" : "initials",
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {pendingInviteTitle(offer.chapter_name)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {pendingInviteDetail(offer)}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void handleJoinOffer(offer.token)}
                disabled={busy}
                aria-label={`Join ${offer.chapter_name}`}
              >
                {joiningToken === offer.token ? (
                  <Loader2 className="animate-spin" />
                ) : null}
                Join
              </Button>
            </div>
          ))}
          {offerError ? (
            <p role="alert" className="text-sm text-destructive">
              {offerError}
            </p>
          ) : null}
        </section>
      ) : null}
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
        {terms.needed ? (
          <TermsAcceptance
            id="join-accept-legal"
            accepted={terms.accepted}
            onAcceptedChange={(next) => {
              terms.setAccepted(next);
              setRedeemError(null);
              setOfferError(null);
            }}
            disabled={busy}
          />
        ) : null}
        <Button
          type="submit"
          className="w-full"
          // One primary per screen: an offered invite's Join, else the
          // member's Open chat, outranks it.
          variant={
            offers.length > 0 || openChatMembership ? "secondary" : "default"
          }
          disabled={busy}
        >
          {busy && joiningToken === null ? (
            <Loader2 className="animate-spin" />
          ) : null}
          Join chapter
        </Button>
      </form>

      <div className="mt-6">
        <AuthNote glyph={<LinkGlyph className="h-5 w-5" />}>
          Got an invite link? Paste it here, or open it and this page fills
          itself in.
        </AuthNote>
      </div>
      {confirmDropDialog}
    </AuthScreen>
  );
}

/** Shared with the Suspense fallback, so the column does not grow on hydration. */
const JOIN_FOOTER = (
  <p>
    Starting a chapter?{" "}
    <Link
      href="/chat"
      className="font-semibold text-accent-text hover:underline"
    >
      Create a chapter
    </Link>
  </p>
);

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen
          title="Join your chapter"
          subtitle="Enter the invite your officer sent. Invites expire after 24 hours and work once."
          footer={JOIN_FOOTER}
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
