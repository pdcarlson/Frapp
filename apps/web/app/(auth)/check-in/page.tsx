"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { statusOf } from "@repo/api-sdk";
import { selectOwnAttendance, useCheckIn, useMyAttendance } from "@repo/hooks";
import {
  CHECK_IN_CODE_CHANGED_COPY,
  CHECK_IN_LINK_PATH,
  STORE_LISTING_URLS,
  checkInTargetFrom,
  openCheckInInAppUrl,
  statusLabel,
  type CheckInLinkTarget,
  type NativePlatform,
} from "@repo/validation";
import { AuthDivider, AuthScreen } from "@/components/auth/auth-screen";
import { SignedInAs } from "@/components/auth/signed-in-as";
import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonText } from "@/components/shared/async-states";
import { getLiveSessionUser } from "@/lib/auth/rejected-session";
import { usePhonePlatform } from "@/lib/use-phone-platform";
import { cn } from "@/lib/utils";
import {
  checkInFailure,
  locationHelpCopy,
  readBrowserLocation,
  type CheckInFailure,
} from "./check-in-outcome";

/**
 * Where the event check-in QR lands when no app claims it (2026-11-13).
 *
 * The code an officer's screen shows is an ordinary link
 * (`@repo/validation`'s `check-in-link.ts`), so a member points the phone's own
 * camera at it. With the app installed and app links set up, the app opens
 * and this page never shows. It shows on a phone without the app, on a build
 * that doesn't claim the path yet, or on a desktop. Like the invite's hand-off
 * (`components/auth/app-handoff.tsx`), it offers the app; unlike it, the
 * browser can finish the job: a member signed in on the web checks in here in
 * one tap, location included, the way Eventbrite's and Luma's check-in links
 * work without their apps.
 *
 * Location is asked for on the tap, never on arrival. A refusal still sends
 * the check-in, because most events need no location and the server is the
 * one that knows; only when it answers that this one did does the page say
 * where to turn location on.
 *
 * Reachable signed out: `/check-in` is not in `proxy.ts`'s gated prefixes, and
 * the page reads nothing of the member's until a live session says who they
 * are. The token rotates every couple of minutes, so a member who signs in
 * first may come back to a stale one; the server's 403 then reads as "point
 * your camera at the screen again", not as a failure.
 */
function CheckInPageContent() {
  const searchParams = useSearchParams();
  const target = checkInTargetFrom(
    searchParams.get("event"),
    searchParams.get("t"),
  );
  if (!target) {
    return (
      <AuthScreen title="Check in">
        <p className="text-sm text-muted-foreground">
          This check-in link is incomplete. Point your camera at the code again.
        </p>
      </AuthScreen>
    );
  }
  return <CheckInForTarget target={target} query={searchParams.toString()} />;
}

type SessionState =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | { kind: "ready"; email: string | null }
  | { kind: "failed" };

type Outcome =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; already: boolean }
  | { kind: "failed"; failure: CheckInFailure };

function CheckInForTarget({
  target,
  query,
}: {
  target: CheckInLinkTarget;
  query: string;
}) {
  const phone = usePhonePlatform();
  const checkIn = useCheckIn();
  // Read only on a 409, to tell "already on the list" from an officer's mark.
  const ownRow = useMyAttendance(target.eventId, { enabled: false });
  // Held from the tap until the answer: a second tap before React re-renders
  // would otherwise send a second check-in, whose 409 could land last.
  const sendingRef = useRef(false);
  const [session, setSession] = useState<SessionState>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const here = `${CHECK_IN_LINK_PATH}?${query}`;

  useEffect(() => {
    let mounted = true;
    getLiveSessionUser(CHECK_IN_LINK_PATH)
      .then((user) => {
        if (!mounted) return;
        setSession(
          user
            ? { kind: "ready", email: user.email ?? null }
            : { kind: "signed-out" },
        );
      })
      .catch(() => {
        if (mounted) setSession({ kind: "failed" });
      });
    return () => {
      mounted = false;
    };
  }, [attempt]);

  const retrySession = useCallback(() => {
    setSession({ kind: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  async function checkInHere() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setOutcome({ kind: "pending" });
    const fix = await readBrowserLocation();
    try {
      await checkIn.mutateAsync({
        eventId: target.eventId,
        token: target.token,
        ...(fix.kind === "fix"
          ? {
              lat: fix.lat,
              lng: fix.lng,
              ...(fix.accuracy !== undefined
                ? { accuracy_meters: fix.accuracy }
                : {}),
            }
          : {}),
      });
      setOutcome({ kind: "done", already: false });
    } catch (error) {
      // A 409 is a row already there. Checked in or late (a second scan, or
      // the app got there first) is what they came for; an officer's absent
      // or excused mark is said as one, so "you're in" never contradicts the
      // record, as mobile's check-in says it (#3703).
      if (statusOf(error) === 409) {
        const read = await ownRow.refetch();
        const row = read.isSuccess ? selectOwnAttendance(read.data) : null;
        if (row && row.status !== "PRESENT" && row.status !== "LATE") {
          setOutcome({
            kind: "failed",
            failure: {
              kind: "other",
              message: `An officer marked you ${statusLabel("attendance", row.status).toLowerCase()} for this event.`,
            },
          });
        } else {
          setOutcome({ kind: "done", already: true });
        }
        return;
      }
      setOutcome({ kind: "failed", failure: checkInFailure(error, fix.kind) });
    } finally {
      sendingRef.current = false;
    }
  }

  if (outcome.kind === "done") {
    return (
      <AuthScreen
        title={outcome.already ? "You're already checked in" : "You're checked in"}
      >
        <p className="text-sm text-muted-foreground">You can close this page.</p>
      </AuthScreen>
    );
  }

  if (session.kind === "checking") {
    return (
      <AuthScreen title="Check in">
        <div role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Checking your session…</span>
          <SkeletonText lines={2} />
        </div>
      </AuthScreen>
    );
  }

  if (session.kind === "failed") {
    return (
      <AuthScreen title="Check in">
        <ErrorState
          title="Couldn't check your session"
          description="Frapp couldn't be reached to confirm you're signed in. Try again in a moment."
          onRetry={retrySession}
        />
        {phone ? <AppButtons platform={phone} target={target} lead /> : null}
      </AuthScreen>
    );
  }

  if (session.kind === "signed-out") {
    return (
      <AuthScreen title="Check in">
        {phone ? <AppButtons platform={phone} target={target} lead /> : null}
        {phone ? <AuthDivider label="or" /> : null}
        <p className="mb-3 text-sm text-muted-foreground">
          You can check in here after you sign in.
        </p>
        <Button
          asChild
          variant={phone ? "secondary" : "default"}
          className="w-full"
        >
          <Link href={`/sign-in?redirectTo=${encodeURIComponent(here)}`}>
            Sign in
          </Link>
        </Button>
      </AuthScreen>
    );
  }

  const pending = outcome.kind === "pending";
  const failure = outcome.kind === "failed" ? outcome.failure : null;
  const expired = failure?.kind === "expired";

  return (
    <AuthScreen
      title="Check in"
      toggle={
        <SignedInAs email={session.email} disabled={pending} returnTo={here} />
      }
    >
      {expired ? null : (
        <Button
          type="button"
          className="w-full"
          disabled={pending}
          onClick={() => void checkInHere()}
        >
          {pending ? "Checking in…" : failure ? "Try again" : "Check in here"}
        </Button>
      )}
      {failure ? (
        <p
          role="alert"
          // Expired and location are next steps, not faults: plain text.
          className={cn(
            "text-sm",
            !expired && "mt-3",
            failure.kind === "other" ? "text-destructive" : "text-foreground",
          )}
        >
          {failureCopy(failure, phone)}
        </p>
      ) : null}
      {phone ? (
        <>
          <AuthDivider label="or" />
          <AppButtons platform={phone} target={target} lead={false} />
        </>
      ) : null}
    </AuthScreen>
  );
}

function failureCopy(
  failure: CheckInFailure,
  phone: NativePlatform | null,
): string {
  switch (failure.kind) {
    case "expired":
      return CHECK_IN_CODE_CHANGED_COPY;
    case "needs-location":
      return locationHelpCopy(failure.fix, phone);
    default:
      return failure.message;
  }
}

/**
 * Open in Frapp, and the store for a phone without it. `lead` makes Open in
 * Frapp the screen's one primary; beside a signed-in Check in here, both step
 * back. On Android the intent link opens Play by itself when the app is
 * missing; iOS refuses the scheme silently, hence the store button.
 */
function AppButtons({
  platform,
  target,
  lead,
}: {
  platform: NativePlatform;
  target: CheckInLinkTarget;
  lead: boolean;
}) {
  return (
    <div className={lead ? "flex flex-col gap-3" : "flex gap-3"}>
      <Button
        asChild
        variant={lead ? "default" : "secondary"}
        className={lead ? "w-full" : "flex-1"}
      >
        <a href={openCheckInInAppUrl(platform, target)}>Open in Frapp</a>
      </Button>
      <Button
        asChild
        variant={lead ? "secondary" : "ghost"}
        className={lead ? "w-full" : "flex-1"}
      >
        <a href={STORE_LISTING_URLS[platform]}>Get Frapp</a>
      </Button>
    </div>
  );
}

export default function CheckInPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen title="Check in">
          <div role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading…</span>
            <SkeletonText lines={2} />
          </div>
        </AuthScreen>
      }
    >
      <CheckInPageContent />
    </Suspense>
  );
}
