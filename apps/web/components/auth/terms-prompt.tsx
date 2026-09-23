"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { statusOf } from "@repo/api-sdk";
import {
  useAcceptLegalTerms,
  useAccessibleChapters,
  useLegalAcceptance,
} from "@repo/hooks";
import { TermsAcceptance } from "@/components/auth/terms-acceptance";
import { Button } from "@/components/ui/button";
import { signOutCurrentSession } from "@/lib/auth/session";
import { asArray } from "@/lib/utils";

/**
 * Copy for the Terms prompt (#2302). Shared verbatim with mobile's
 * `apps/mobile/lib/onboarding/terms-prompt.ts`; `spec/ui/design-system/
 * writing.md` § Terms prompt is the one place it is written down, since
 * neither app can import the other's module.
 */
export const TERMS_PROMPT_COPY = {
  title: "Agree to the Terms to continue",
  body: "We've updated the Terms of Service and Privacy Policy. Read them, then agree to keep using Frapp.",
  cta: "Agree and continue",
  unticked: "Agree to the Terms of Service and Privacy Policy to continue.",
} as const;

/** Copy for an acceptance the server didn't record. */
export function termsPromptErrorCopy(error: unknown): string {
  if (statusOf(error) === 410) {
    return "This account has been deleted. Sign out to continue.";
  }
  return "Couldn't save your agreement. Check your connection and try again.";
}

/**
 * The prompt itself: a full-screen dialog over the dashboard that Escape and
 * outside clicks can't close, the same shape as the chapter wizard. The ways
 * out are agreeing and signing out, so a member who declines is never trapped.
 * Accepting updates the cached status, and the gate unmounts this.
 */
export function TermsPrompt() {
  const acceptTerms = useAcceptLegalTerms();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleAccept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted) {
      setError(TERMS_PROMPT_COPY.unticked);
      return;
    }
    setError(null);
    try {
      await acceptTerms.mutateAsync();
    } catch (caught) {
      setError(termsPromptErrorCopy(caught));
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutCurrentSession();
      window.location.assign("/sign-in");
    } finally {
      setSigningOut(false);
    }
  }

  const busy = acceptTerms.isPending || acceptTerms.isSuccess || signingOut;

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 overflow-y-auto bg-background focus:outline-none"
        >
          <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-8">
            <DialogPrimitive.Title asChild>
              <h1 className="text-2xl font-semibold tracking-tight">
                {TERMS_PROMPT_COPY.title}
              </h1>
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
              {TERMS_PROMPT_COPY.body}
            </DialogPrimitive.Description>

            <form className="mt-6 flex flex-col gap-4" onSubmit={handleAccept}>
              <TermsAcceptance
                id="terms-prompt-accept"
                accepted={accepted}
                onAcceptedChange={(next) => {
                  setAccepted(next);
                  setError(null);
                }}
                disabled={busy}
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {acceptTerms.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : null}
                {TERMS_PROMPT_COPY.cta}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  void handleSignOut();
                }}
              >
                Sign out
              </Button>
            </form>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Asks a member who hasn't accepted the Terms version the server enforces
 * (#2302), on every dashboard route. Mounted in `dashboard-shell.tsx` beside
 * `ChapterWizardGate`.
 *
 * Only a member is asked. A user with no chapter gets the wizard, whose
 * checkbox records the same acceptance. The server decides through
 * `required`, never a compiled-in version. And a failed read of either query
 * asks nothing, so an outage of the endpoint can't lock the dashboard.
 */
export function TermsPromptGate() {
  const chaptersQuery = useAccessibleChapters();
  const legalAcceptance = useLegalAcceptance();
  const isMember =
    chaptersQuery.isSuccess && asArray<unknown>(chaptersQuery.data).length > 0;
  if (!isMember || legalAcceptance.data?.required !== true) return null;
  return <TermsPrompt />;
}
