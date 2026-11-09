"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSignOutToSignIn } from "./use-sign-out";

/**
 * "Signed in as <email> · Sign out", on every screen an account with no
 * chapter passes through: `/join` and each step of the setup wizard (#3776).
 * Without it, someone signed in with the wrong account (a fresh Apple account,
 * say) had no way out but "I have an invite" and back. Mobile s02's Account
 * menu says the same (`writing.md` § Join chapter (pre-auth)).
 *
 * `email` is null while it's unknown, or for an account that has none; the
 * line then says only "Signed in", and Sign out still works.
 */
export function SignedInAs({
  email,
  disabled = false,
  className,
}: {
  email: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const { signOut, signingOut, confirmDropDialog } = useSignOutToSignIn();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="min-w-0 break-all">
        {email ? (
          <>
            Signed in as{" "}
            <span className="font-semibold text-foreground">{email}</span>
          </>
        ) : (
          "Signed in"
        )}
      </span>
      <span aria-hidden="true">·</span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0"
        disabled={disabled || signingOut}
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
      {confirmDropDialog}
    </div>
  );
}
