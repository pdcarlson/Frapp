"use client";

import { Button } from "@/components/ui/button";
import { useSignOutToSignIn } from "./use-sign-out";

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
 * `/new-account`'s two ways out (#3786, #3801).
 *
 * **Which one is primary.** Sign out, unless `next` is an invite. The page
 * only shows after the member chose sign-in, so without an invite the likelier
 * story is a member who picked the wrong provider or typed an email they
 * never joined with. With one, it is just as
 * likely a newcomer the invite link sent to `/sign-in`, so Continue leads.
 *
 * Sign out is the shared `useSignOutToSignIn`, local scope, landing on
 * `/sign-in` with `next` kept (the proxy sends a signed-in visitor off the
 * auth routes, so it has to end first). Continuing is a full navigation so the
 * dashboard mounts fresh on the new session.
 */
export function NewAccountActions({ next }: { next: string }) {
  const { signOut: handleSignOut, signingOut, failed, confirmDropDialog } =
    useSignOutToSignIn(next);
  const invite = isInvite(next);

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
      {confirmDropDialog}
    </div>
  );
}
