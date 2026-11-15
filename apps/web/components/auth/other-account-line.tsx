"use client";

import {
  OTHER_ACCOUNT_ACTION,
  OTHER_ACCOUNT_HINT,
  OTHER_ACCOUNT_PROMPT,
} from "@repo/validation";
import { useSignOutToSignIn } from "./use-sign-out";

/** Shown when the sign-out itself threw. */
export const OTHER_ACCOUNT_SIGN_OUT_FAILED =
  "Couldn't sign out. Retry in a moment, or close this tab to end the session.";

/**
 * "Already in a chapter? Use a different account", `/join`'s quiet line for
 * someone who signed in with another account than the one they joined with
 * (`@repo/validation` `other-account` says why it replaced `/new-account`).
 * Signs out and lands on `/sign-in`, returning to `/join` after.
 */
export function OtherAccountLine({ disabled = false }: { disabled?: boolean }) {
  const { signOut, signingOut, failed, confirmDropDialog } =
    useSignOutToSignIn("/join");
  return (
    <div className="text-center text-sm text-muted-foreground">
      <p>
        {OTHER_ACCOUNT_PROMPT}{" "}
        <button
          type="button"
          className="font-semibold text-accent-text hover:underline disabled:opacity-50"
          title={OTHER_ACCOUNT_HINT}
          disabled={disabled || signingOut}
          onClick={() => void signOut()}
        >
          {OTHER_ACCOUNT_ACTION}
        </button>
      </p>
      {failed ? (
        <p role="alert" className="mt-1 text-destructive">
          {OTHER_ACCOUNT_SIGN_OUT_FAILED}
        </p>
      ) : null}
      {confirmDropDialog}
    </div>
  );
}
