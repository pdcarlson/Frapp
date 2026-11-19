"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  cooldownCopy,
  describeEmailSendError,
  describeEmailCodeError,
  EMAIL_CODE_COPY,
  EMAIL_CODE_LENGTH,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  emailCooldownSeconds,
} from "@repo/hooks/auth-error-copy";
import { FloatingField } from "@/components/auth/floating-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { magicLinkRedirectUrl } from "@/lib/auth/redirect";
import { reportAuthFailure } from "@/lib/sentry/auth-failures";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Continue with email on the invite card (#5625): one address, then the
 * six-digit code from the email typed right here, so nobody leaves the page
 * (Slack's and Notion's sign-in work the same way). The same email still
 * carries the sign-in link, which lands on `redirectTo`: the code needs the
 * Auth email template to print `{{ .Token }}`, and until it does, or on
 * another device, the link is the way in. It works for a new address too:
 * Auth creates the account on the first code.
 *
 * `onSignedIn` runs once this browser holds a session from the code.
 */
export function EmailCodeSignIn({
  redirectTo,
  onSending,
  onSignedIn,
  onCodeSent,
  onCodeVerified,
  onBack,
  disabled = false,
}: {
  redirectTo: string;
  /** The email is about to go out: its link may come back to this card. */
  onSending: () => void;
  onSignedIn: () => void;
  /** The email went out (the invite card's funnel, #5663). */
  onCodeSent?: () => void;
  /** The code was right (the invite card's funnel, #5663). */
  onCodeVerified?: () => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const lastTried = useRef<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (stage === "code") codeRef.current?.focus();
  }, [stage]);

  async function send() {
    const address = email.trim();
    if (!address.includes("@")) {
      setError(EMAIL_CODE_COPY.invalidEmail);
      return;
    }
    setSending(true);
    setError(null);
    onSending();
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: address,
        options: {
          emailRedirectTo: magicLinkRedirectUrl(
            window.location.origin,
            redirectTo,
          ),
        },
      });
      if (sendError) throw sendError;
      onCodeSent?.();
      setStage("code");
      setCooldown(EMAIL_RESEND_COOLDOWN_SECONDS);
    } catch (caught) {
      const wait = emailCooldownSeconds(caught);
      if (wait !== undefined) {
        // One went out under a minute ago; its code still works.
        setStage("code");
        setCooldown(Math.max(1, wait));
        setError(cooldownCopy(wait));
        return;
      }
      reportAuthFailure({
        flow: "magic_link_send",
        screen: "/join",
        error: caught,
      });
      setError(describeEmailSendError(caught));
    } finally {
      setSending(false);
    }
  }

  async function verify(value: string) {
    if (verifying || value.length < EMAIL_CODE_LENGTH) return;
    lastTried.current = value;
    setVerifying(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: value,
        type: "email",
      });
      if (verifyError) throw verifyError;
      onCodeVerified?.();
      onSignedIn();
    } catch (caught) {
      const { message, wrongCode } = describeEmailCodeError(caught);
      setError(message);
      if (wrongCode) {
        setCode("");
      } else {
        // Not the code's fault: keep it, and let the same code go again.
        lastTried.current = null;
        reportAuthFailure({
          flow: "email_code_verify",
          screen: "/join",
          error: caught,
        });
      }
      codeRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  }

  if (stage === "email") {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        noValidate
      >
        <FloatingField
          id="join-email"
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "join-email-error" : undefined}
          disabled={disabled || sending}
        />
        {error ? (
          <p
            id="join-email-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={disabled || sending}>
          {sending ? <Loader2 className="animate-spin" /> : null}
          {EMAIL_CODE_COPY.sendLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onBack}
          disabled={sending}
        >
          Back
        </Button>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      <div>
        <p className="text-base font-semibold text-foreground">
          {EMAIL_CODE_COPY.sentTitle}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {EMAIL_CODE_COPY.sent(email.trim())}
        </p>
      </div>
      <label htmlFor="join-code" className="sr-only">
        {EMAIL_CODE_LENGTH}-digit code
      </label>
      <Input
        ref={codeRef}
        id="join-code"
        // A machine value read character by character: foundations §7's mono.
        className="h-14 text-center font-mono text-title tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={10}
        value={code}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          setCode(digits);
          setError(null);
          // Six digits typed or pasted is the answer; send it at once,
          // but never the same wrong code twice.
          if (
            digits.length === EMAIL_CODE_LENGTH &&
            digits !== lastTried.current
          ) {
            void verify(digits);
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "join-code-error" : undefined}
        disabled={disabled || verifying}
      />
      {error ? (
        <p
          id="join-code-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={disabled || verifying || code.length < EMAIL_CODE_LENGTH}
      >
        {verifying ? <Loader2 className="animate-spin" /> : null}
        Continue
      </Button>
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => {
            setStage("email");
            setCode("");
            setError(null);
            lastTried.current = null;
          }}
          disabled={verifying}
        >
          {EMAIL_CODE_COPY.differentEmail}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => void send()}
          disabled={verifying || sending || cooldown > 0}
        >
          {cooldown > 0
            ? EMAIL_CODE_COPY.sendAgainIn(cooldown)
            : EMAIL_CODE_COPY.sendAgain}
        </Button>
      </div>
    </form>
  );
}
