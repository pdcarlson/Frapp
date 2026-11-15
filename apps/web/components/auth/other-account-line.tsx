"use client";

import {
  OTHER_ACCOUNT_ACTION,
  OTHER_ACCOUNT_HINT,
  OTHER_ACCOUNT_PROMPT,
} from "@repo/validation";
import { TERMS_PROMPT_SIGN_OUT_FAILED } from "./terms-prompt";

/**
 * "Already in a chapter? Use a different account", the quiet line on `/join`
 * and the setup wizard's first step for someone who signed in with another
 * account than the one they joined with (`@repo/validation` `other-account`
 * says why it replaced `/new-account`).
 *
 * The screen owns the sign-out (`useSignOutToSignIn`, returning to
 * `JOIN_FROM_SIGN_IN_PATH` so a member lands in their chapter) and passes it
 * in, so it can lock its own controls while the session goes away and render
 * the one bulk-upload confirm.
 */
export function OtherAccountLine({
  signOut,
  signingOut,
  failed,
  disabled = false,
}: {
  signOut: () => Promise<void>;
  signingOut: boolean;
  failed: boolean;
  disabled?: boolean;
}) {
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
          {TERMS_PROMPT_SIGN_OUT_FAILED}
        </p>
      ) : null}
    </div>
  );
}
