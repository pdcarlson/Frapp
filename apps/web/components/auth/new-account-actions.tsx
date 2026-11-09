"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOutCurrentSession } from "@/lib/auth/session";

/** Shown when the sign-out itself threw. */
export const NEW_ACCOUNT_SIGN_OUT_FAILED =
  "Couldn't sign out. Retry in a moment, or close this tab to end the session.";

/**
 * Whether `next` is an invite. Invite links send a signed-out visitor to
 * `/sign-in`, not `/sign-up`, so a genuine first-time invitee lands on this
 * notice too, and for them carrying on is the likelier right move.
 */
function isInvite(next: string): boolean {
  return next === "/join" || next.startsWith("/join?") || next.startsWith("/join/");
}

/**
 * `/new-account`'s two ways out (#3786).
 *
 * **Which one is primary.** Sign out, unless `next` is an invite. The page
 * only shows after the member chose sign-in, so without an invite the likelier
 * story is a member who picked the wrong provider. With one, it is just as
 * likely a newcomer the invite link sent to `/sign-in`, so Continue leads.
 *
 * **Sign out is local.** The default (global) scope keeps the browser's
 * session when Auth's revoke call fails, and `signOutCurrentSession` doesn't
 * surface that `{ error }` (#2610). `proxy.ts` would then bounce `/sign-in`
 * straight to `next`, dropping the member into the very account they were
 * leaving. The local scope removes this browser's session before it calls
 * Auth, so the next page load is signed out either way. Landing on `/sign-in`
 * keeps `next`, because the proxy sends a signed-in visitor off the auth
 * routes. Continuing is a full navigation so the dashboard mounts fresh on the
 * new session.
 */
export function NewAccountActions({ next }: { next: string }) {
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const invite = isInvite(next);

  async function handleSignOut() {
    setSigningOut(true);
    setFailed(false);
    try {
      await signOutCurrentSession({ scope: "local" });
      window.location.assign(
        `/sign-in?${new URLSearchParams({ redirectTo: next })}`,
      );
    } catch {
      setFailed(true);
      setSigningOut(false);
    }
  }

  const signOut = (
    <Button
      key="sign-out"
      type="button"
      variant={invite ? "secondary" : "default"}
      className="w-full"
      disabled={signingOut}
      onClick={() => void handleSignOut()}
    >
      Sign out
    </Button>
  );
  const carryOn = (
    <Button
      key="continue"
      type="button"
      variant={invite ? "default" : "secondary"}
      className="w-full"
      disabled={signingOut}
      onClick={() => window.location.assign(next)}
    >
      Continue with the new account
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      {invite ? [carryOn, signOut] : [signOut, carryOn]}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {NEW_ACCOUNT_SIGN_OUT_FAILED}
        </p>
      ) : null}
    </div>
  );
}
