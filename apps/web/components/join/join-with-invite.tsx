"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { codeOf, statusOf } from "@repo/api-sdk";
import {
  askForNewLinkCopy,
  deadInviteCopy,
  joinErrorCopy,
  joinRedeemBody,
  redeemChapterId,
  UNKNOWN_INVITE_COPY,
  useAccessibleChapters,
  useAskForNewLink,
  useInviteCardViewed,
  useInviteDetails,
  useInviteFunnel,
  useRedeemInvite,
  type InviteDetails,
} from "@repo/hooks";
import type { ChapterMembershipSummary } from "@repo/hooks";
import { extractInviteToken, inviteJoinFailureReason } from "@repo/validation";
import { AppHandoff } from "@/components/auth/app-handoff";
import {
  JOIN_IN_BROWSER_KEY,
  JOIN_IN_BROWSER_VALUE,
  WELCOME_PATH,
} from "@/lib/auth/join-visit";
import { AuthScreen } from "@/components/auth/auth-screen";
import { SignedInAs } from "@/components/auth/signed-in-as";
import { useConfirmDropBulkUploads } from "@/components/backwork/bulk/use-confirm-drop-bulk-uploads";
import { ErrorState, OfflineState } from "@/components/shared/async-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  joinPathWithoutThen,
  clearJoinMark,
  inviteVisitId,
  joinReturnPath,
  joinThenFor,
  readJoinThen,
  rememberJoinMark,
  type JoinThen,
} from "@/lib/auth/join-visit";
import { getLiveSessionUser } from "@/lib/auth/rejected-session";
import { useSelectChapter } from "@/lib/auth/select-chapter";
import { useToast } from "@/lib/hooks/use-toast";
import { useNetwork } from "@/lib/providers/network-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { usePhonePlatform } from "@/lib/use-phone-platform";
import { asArray } from "@/lib/utils";
import { DeadInviteHero, InviteHero, InviteHeroSkeleton } from "./invite-hero";
import { JoinSignIn, PasswordSignInLine } from "./join-sign-in";
import { TermsLine } from "./terms-line";

type SessionState = "checking" | "signed-out" | "ready" | "failed";

/**
 * `/join` opened with an invite (#5625, epic #5624): the chapter card first,
 * before any account, and one tap that is sign-in and join together.
 *
 * Paul's ask (2026-11-19) was "the best onboarding flow ever from invite link
 * to landing in the chapter … fast and PAINLESS". Before this, a signed-out
 * visitor was sent to a "Welcome back" sign-in form that never named the
 * chapter, then to a join form with the raw invite in a mono field and a
 * Terms checkbox, then to Join. Now the visitor sees whose chapter it is and
 * who sent it, taps Continue with Apple, Google or email, and lands in the
 * chapter. Discord's, GroupMe's and Slack's invite pages are the model:
 * group first, one button, the Terms as a line under it.
 *
 * - **Signed out, live link.** The card, the three ways in, the Terms line.
 *   Each way in returns here marked `then=join` (`joinReturnPath`), and that
 *   mark is what joins: only a sign-in started from this card joins on its
 *   own. The email code signs this tab in without leaving it.
 * - **Signed in.** The card and one Join. Someone already in the chapter is
 *   told so and offered it instead of a Join that would fail.
 * - **Dead link** (expired, used, turned off). The card still names the
 *   chapter and its sender, and "Ask Paul for a new link" notifies them by
 *   name. Asking needs an account, so the sender knows who; signed out, the
 *   button opens the ways in, marked `then=ask`.
 * - **Not an invite** (404). Says so, and takes another link.
 * - **A phone.** The app is the only way in (`AppHandoff`, #4002; Paul,
 *   2026-11-21), under the same card, signed in or not and member or not:
 *   the app signs in natively, joins, or opens the chapter for someone
 *   already in it. Joining here on a phone and then opening the app was two
 *   sign-ins and onboarding twice. Only a sign-in already on its way back
 *   (`then`) finishes here, so nobody is stranded mid-way, and an old phone
 *   build's hand-off (`web=1`, `join-visit.ts`) goes on here, so it can't
 *   loop.
 *
 * The page reads the invite with `POST /v1/invites/details`, which needs no
 * sign-in and answers for a dead link too, so nothing here waits on Auth to
 * show the chapter.
 *
 * Each step is recorded in the invite card funnel (#5663, `useInviteFunnel`):
 * the card viewed (its state, signed in or not), the way in tapped, the email
 * code sent and verified, the join or a failed one, and an ask for a new
 * link.
 */
export function JoinWithInvite({ token }: { token: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isOffline } = useNetwork();
  const selectChapter = useSelectChapter();
  const { confirmDrop, confirmDropDialog } = useConfirmDropBulkUploads();
  const redeem = useRedeemInvite();
  const ask = useAskForNewLink();
  const details = useInviteDetails(token);
  const [visitId] = useState(() => inviteVisitId(token));
  const record = useInviteFunnel(token, visitId);

  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A sign-in finished on this page (the email code) acts like one that came
  // back marked: it carries on with what the visitor started.
  const [localThen, setLocalThen] = useState<JoinThen | null>(null);
  // Read once on arrival: the URL's mark, honored only when this browser
  // tapped a way in on this card (`joinThenFor`), so a crafted link can't
  // join or ask on a signed-in visitor's behalf.
  const [arrivedThen] = useState(() => joinThenFor(token, searchParams));
  const then = localThen ?? arrivedThen;
  // Held for the whole join, through `selectChapter` and the navigation, so a
  // second tap can't redeem twice. Starts held when the visit comes back to
  // join, so the Join button never flashes before it presses itself.
  const [busy, setBusy] = useState(() => then === "join");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const acted = useRef(false);

  const ready = sessionState === "ready";
  const chapters = useAccessibleChapters({ enabled: ready });
  const memberships = asArray<ChapterMembershipSummary>(chapters.data);
  const invite = details.data;
  const alreadyIn =
    ready &&
    !!invite &&
    memberships.some((m) => m.chapter_id === invite.chapter_id);

  useInviteCardViewed(
    record,
    invite && (sessionState === "signed-out" || ready)
      ? { state: invite.state, signed_in: ready }
      : null,
  );

  const phone = usePhonePlatform();
  // An old phone build's hand-off of a member's second-chapter invite
  // (`JOIN_IN_BROWSER_KEY`) is the one phone visit that goes on here.
  const handedBackByApp =
    searchParams.get(JOIN_IN_BROWSER_KEY) === JOIN_IN_BROWSER_VALUE;
  const offerApp =
    phone !== null &&
    !handedBackByApp &&
    then === null &&
    invite?.state === "live";

  useEffect(() => {
    let live = true;
    getLiveSessionUser()
      .then((user) => {
        if (!live) return;
        setEmail(user?.email ?? null);
        setSessionState(user ? "ready" : "signed-out");
      })
      .catch(() => {
        if (live) setSessionState("failed");
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  // The email's link, opened in another tab, signs this browser in too. This
  // tab notices and carries on with the rest (the other tab's join is the
  // same redeem, and a second one reads "already in" and just opens it).
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && sessionState === "signed-out") {
        setAttempt((n) => n + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [sessionState]);

  const openChapter = useCallback(
    async (chapterId: string) => {
      setBusy(true);
      if (!(await confirmDrop("switch"))) {
        setBusy(false);
        return;
      }
      await selectChapter(chapterId);
      router.replace("/chat");
      router.refresh();
    },
    [confirmDrop, router, selectChapter],
  );

  const join = useCallback(
    async (card: InviteDetails) => {
      setBusy(true);
      setJoinError(null);
      try {
        // Joining switches to the new chapter, which ends this tab's Bulk upload.
        if (!(await confirmDrop("switch"))) {
          setBusy(false);
          return;
        }
        const result = await redeem.mutateAsync(joinRedeemBody(token));
        record({ step: "joined" });
        const chapterId = redeemChapterId(result) ?? card.chapter_id;
        await selectChapter(chapterId);
        toast({ title: `Welcome to ${card.chapter_name}` });
        // Their name and photo first, then chat (#5627).
        router.replace(WELCOME_PATH);
        router.refresh();
      } catch (error) {
        // Already in, from another tab's join or an earlier visit: open it.
        if (statusOf(error) === 409) {
          await selectChapter(card.chapter_id);
          router.replace("/chat");
          router.refresh();
          return;
        }
        record({
          step: "join-failed",
          reason: inviteJoinFailureReason(statusOf(error), isOffline),
        });
        setJoinError(joinErrorCopy(error));
        setBusy(false);
        // A link that died since the card was read gets the dead card.
        if (statusOf(error) === 410) void details.refetch();
      }
    },
    [
      confirmDrop,
      details,
      isOffline,
      record,
      redeem,
      router,
      selectChapter,
      toast,
      token,
    ],
  );

  const askForLink = useCallback(async () => {
    setAskError(null);
    try {
      await ask.mutateAsync(token);
      record({ step: "new-link-asked" });
      setAsked(true);
    } catch (error) {
      const code = codeOf(error);
      if (code === "invite.still_live") return; // the card refetches as live
      if (code === "invite.already_member") {
        void chapters.refetch();
        return;
      }
      setAskError(
        isOffline
          ? "You're offline. Reconnect, then ask again."
          : "Couldn't send that. Try again in a moment.",
      );
    }
  }, [ask, chapters, isOffline, record, token]);

  // What a sign-in from the card came back to do, done once. The mark comes
  // off the URL first, so a refresh or Back never repeats it.
  useEffect(() => {
    if (acted.current || then === null) return;
    // A link that can't be read has nothing to carry on with: let go of the
    // hold, so the screen's Signed in as stays usable.
    if (details.isError) {
      acted.current = true;
      clearJoinMark();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect acts once on what a sign-in came back to do; each branch starts or releases the page's hold
      setBusy(false);
      return;
    }
    // A sign-in that didn't take leaves the visit signed out, and the
    // signed-out card reads no hold; nothing to undo here.
    if (!ready || !invite || chapters.isLoading) return;
    acted.current = true;
    clearJoinMark();
    if (readJoinThen(searchParams)) {
      router.replace(joinPathWithoutThen(searchParams));
    }
    if (alreadyIn) {
      toast({ title: `You're already in ${invite.chapter_name}` });
      void openChapter(invite.chapter_id);
    } else if (then === "join" && invite.state === "live") {
      void join(invite);
    } else {
      setBusy(false);
      if (then === "ask" && invite.state !== "live") void askForLink();
    }
  }, [
    alreadyIn,
    askForLink,
    chapters.isLoading,
    details.isError,
    invite,
    join,
    openChapter,
    ready,
    router,
    searchParams,
    sessionState,
    then,
    toast,
  ]);

  const signedInHere = useCallback((next: JoinThen) => {
    setLocalThen(next);
    if (next === "join") setBusy(true);
    setSessionState("checking");
    setAttempt((n) => n + 1);
  }, []);

  const signedInAs = ready ? (
    <SignedInAs
      email={email}
      disabled={busy}
      returnTo={joinPathWithoutThen(searchParams)}
    />
  ) : undefined;

  // ── Reading the invite or the session ────────────────────────────────────
  if (details.isLoading || sessionState === "checking") {
    return <AuthScreen hero={<InviteHeroSkeleton />} />;
  }

  if (details.isError) {
    if (statusOf(details.error) === 404) {
      return (
        <AuthScreen
          toggle={signedInAs}
          title={UNKNOWN_INVITE_COPY.title}
          subtitle={UNKNOWN_INVITE_COPY.body}
          footer={
            sessionState === "signed-out" ? (
              <PasswordSignInLine returnTo="/join?from=sign-in" />
            ) : undefined
          }
        >
          <OtherInviteForm />
        </AuthScreen>
      );
    }
    return (
      <AuthScreen title="Join your chapter">
        {isOffline ? (
          <OfflineState
            title="Can't open your invite"
            description="Reconnect, and your invite opens right here."
            onRetry={() => void details.refetch()}
          />
        ) : (
          <ErrorState
            title="Couldn't open your invite"
            description="Frapp couldn't be reached. Try again in a moment."
            onRetry={() => void details.refetch()}
          />
        )}
      </AuthScreen>
    );
  }

  if (sessionState === "failed") {
    return (
      <AuthScreen title="Join your chapter">
        <ErrorState
          title="Couldn't check your sign-in"
          description="Frapp couldn't be reached to confirm who's signed in. Try again in a moment."
          onRetry={() => {
            setSessionState("checking");
            setAttempt((n) => n + 1);
          }}
        />
      </AuthScreen>
    );
  }

  if (!invite) return null;

  // ── A live link on a phone: the app, signed in or not, member or not ─────
  if (offerApp && phone !== null) {
    return (
      <AppHandoff
        platform={phone}
        token={token}
        hero={<InviteHero details={invite} />}
      />
    );
  }

  // ── Already in this chapter ──────────────────────────────────────────────
  if (alreadyIn && !busy) {
    return (
      <AuthScreen
        toggle={signedInAs}
        hero={<InviteHero details={invite} eyebrow="You're already in" />}
      >
        <Button
          type="button"
          className="w-full"
          onClick={() => void openChapter(invite.chapter_id)}
        >
          Open chat
        </Button>
        {confirmDropDialog}
      </AuthScreen>
    );
  }

  // ── A dead link ──────────────────────────────────────────────────────────
  if (invite.state !== "live") {
    const copy = deadInviteCopy(invite);
    const askCopy = askForNewLinkCopy(invite);
    return (
      <AuthScreen
        toggle={signedInAs}
        hero={
          <DeadInviteHero
            details={invite}
            title={copy.title}
            sent={copy.sent}
          />
        }
      >
        <p className="text-base leading-relaxed text-muted-foreground">
          {copy.body}
        </p>
        <div className="mt-6">
          {asked ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-md border border-border bg-surface-1 p-4"
            >
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-tint text-success">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <p className="text-sm text-foreground">{askCopy.sent}</p>
            </div>
          ) : ready ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                disabled={ask.isPending}
                onClick={() => void askForLink()}
              >
                {ask.isPending ? <Loader2 className="animate-spin" /> : null}
                {copy.ask}
              </Button>
              {askError ? (
                <p role="alert" className="text-sm text-destructive">
                  {askError}
                </p>
              ) : (
                <p className="text-center text-caption text-muted-foreground">
                  {askCopy.hint}
                </p>
              )}
            </div>
          ) : askOpen ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-foreground">
                {askCopy.signedOutHint}
              </p>
              <JoinSignIn
                returnTo={joinReturnPath(searchParams, "ask")}
                onStart={() => rememberJoinMark(token, "ask")}
                onSignedIn={() => signedInHere("ask")}
                record={record}
              />
              <TermsLine action="continuing" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className="w-full"
                onClick={() => setAskOpen(true)}
              >
                {copy.ask}
              </Button>
              <p className="text-center text-caption text-muted-foreground">
                {askCopy.hint}
              </p>
            </div>
          )}
        </div>
      </AuthScreen>
    );
  }

  // ── A live link, signed out: one tap signs in and joins ──────────────────
  if (sessionState === "signed-out") {
    const returnTo = joinReturnPath(searchParams, "join");
    return (
      <AuthScreen
        hero={<InviteHero details={invite} />}
        footer={
          <PasswordSignInLine
            returnTo={returnTo}
            onStart={() => {
              rememberJoinMark(token, "join");
              record({ step: "sign-in-started", method: "password" });
            }}
          />
        }
      >
        <JoinSignIn
          returnTo={returnTo}
          onStart={() => rememberJoinMark(token, "join")}
          onSignedIn={() => signedInHere("join")}
          record={record}
        />
        <TermsLine action="continuing" className="mt-4" />
      </AuthScreen>
    );
  }

  // ── A live link, signed in: one Join ─────────────────────────────────────
  return (
    <AuthScreen toggle={signedInAs} hero={<InviteHero details={invite} />}>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          className="h-11 w-full"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void join(invite)}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? `Joining ${invite.chapter_name}…` : "Join chapter"}
        </Button>
        {joinError ? (
          <p role="alert" className="text-sm text-destructive">
            {joinError}
          </p>
        ) : null}
        <TermsLine action="joining" className="mt-1" />
      </div>
      {confirmDropDialog}
    </AuthScreen>
  );
}

/**
 * Another link, for a visitor whose link isn't an invite. It only opens it
 * here, so it works signed out too: the card does the rest.
 */
function OtherInviteForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const next = extractInviteToken(value);
        if (!next) {
          setError("Paste the whole invite link your officer sent.");
          return;
        }
        router.replace(`/join?token=${encodeURIComponent(next)}`);
      }}
    >
      <Label htmlFor="other-invite">Have another invite link?</Label>
      <Input
        id="other-invite"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        placeholder="Paste it here"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "other-invite-error" : undefined}
      />
      {error ? (
        <p id="other-invite-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" className="w-full">
        Open invite
      </Button>
    </form>
  );
}
