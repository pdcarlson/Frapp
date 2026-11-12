"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { AuthNote } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildAuthCallbackUrl } from "@/lib/auth/redirect";
import {
  cooldownCopy,
  describeEmailSendError,
  EMAIL_RESEND_COOLDOWN_SECONDS,
  emailCooldownSeconds,
} from "@repo/hooks/auth-error-copy";
import { reportAuthFailure } from "@/lib/sentry/auth-failures";

/**
 * GoTrue sends one address one auth email a minute and refuses a second with
 * a 429. Counting the minute down here means the member never meets that
 * refusal by tapping Resend right after the first email went out. Shared with
 * mobile's Resend (`@repo/hooks/auth-error-copy`).
 */
export const RESEND_COOLDOWN_SECONDS = EMAIL_RESEND_COOLDOWN_SECONDS;

/**
 * Where the confirmation email's link lands: `/auth/callback` with `next` and
 * `intent=confirm`, so a code that can't be exchanged there reads as "your
 * email is confirmed, sign in" rather than as a broken link
 * (`EMAIL_CONFIRMED_AUTH_ERROR`).
 */
export function confirmationRedirectUrl(origin: string, redirectTo: string): string {
  return buildAuthCallbackUrl(origin, redirectTo, { intent: "confirm" });
}

/**
 * "Check your email": what a password account sees between creating itself
 * and opening the confirmation email. Hosted projects require that email
 * (#3776), so a web sign-up never comes back with a session.
 *
 * It replaced a toast and a bounce to the sign-in form (2026-11-09). On launch
 * day an invited member missed the toast, typed their new password into that
 * form four times, and read "Something went wrong" each time; tapping "Email
 * me a magic link" then hit GoTrue's one-email-a-minute limit. This state
 * stays on screen with the address, counts the resend minute down, and offers
 * the sign-in form only as a way back.
 *
 * **It carries on by itself.** The link opens in a new tab and signs that tab
 * in. The session is a cookie this tab can read, so when the member comes back
 * to it (`visibilitychange` / `focus`), or the client reports a sign-in, a
 * session found here sends the tab on to `redirectTo` with a full navigation,
 * so the dashboard mounts fresh on it. A link opened on another device signs
 * that device in, and this tab waits for the password.
 *
 * Both the sign-up screen and the sign-in screen (on `email_not_confirmed`)
 * render it. The sign-in screen can't know when the last email went out, so
 * its Resend starts live and a refusal inside the minute starts the count.
 *
 * **A refused send costs this browser its confirmation link**, until the
 * Confirm signup template moves to `token_hash` (#1925). The link's `?code=`
 * is exchanged against the one legacy PKCE verifier `/auth/callback` reads,
 * and auth-js 2.119 overwrites it on every email request and deletes it when
 * GoTrue refuses one. The link still confirms the address, so it lands on
 * `/sign-in` as "Email confirmed" (`intent=confirm`) and the password does
 * the rest; this tab just doesn't carry on by itself.
 */
export function CheckEmail({
  email,
  redirectTo,
  initialCooldownSeconds,
  backLabel,
  onBack,
}: {
  email: string;
  redirectTo: string;
  /**
   * Seconds before Resend is offered: `RESEND_COOLDOWN_SECONDS` right after an
   * email went out, GoTrue's own remaining seconds (at least 1) when it
   * refused a send inside the minute, else 0.
   */
  initialCooldownSeconds: number;
  backLabel: string;
  onBack: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(initialCooldownSeconds);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((left) => left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let left = false;
    const carryOn = () => {
      if (left) return;
      left = true;
      window.location.assign(redirectTo);
    };
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) carryOn();
      } catch {
        // A failed read leaves the member here, where Resend and the way
        // back still work; the next focus tries again.
      }
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) carryOn();
    });
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [redirectTo]);

  async function resend() {
    setSending(true);
    setNotice(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: confirmationRedirectUrl(window.location.origin, redirectTo),
        },
      });
      if (error) throw error;
      setSecondsLeft(RESEND_COOLDOWN_SECONDS);
      setNotice({ text: `We sent a new link to ${email}.`, isError: false });
    } catch (error) {
      // Shown on `/sign-in` and `/sign-up` alike; a path that isn't a bare
      // screen name is reported as `unknown`.
      reportAuthFailure({
        flow: "confirmation_resend",
        screen: window.location.pathname,
        error,
      });
      const cooldown = emailCooldownSeconds(error);
      if (cooldown !== undefined) {
        setSecondsLeft(Math.max(cooldown, 1));
        setNotice({ text: cooldownCopy(cooldown), isError: false });
      } else {
        setNotice({ text: describeEmailSendError(error), isError: true });
      }
    } finally {
      setSending(false);
    }
  }

  const waiting = secondsLeft > 0;

  return (
    <div className="flex flex-col gap-3">
      <AuthNote glyph={<Mail className="h-5 w-5" aria-hidden="true" />}>
        We sent a link to{" "}
        <span className="font-semibold text-foreground">{email}</span>. Open it to
        finish setting up your account. Not there? Check your spam folder.
      </AuthNote>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={sending || waiting}
        onClick={() => {
          void resend();
        }}
      >
        {sending ? <Loader2 className="animate-spin" /> : null}
        {waiting ? `Resend email in ${secondsLeft}s` : "Resend email"}
      </Button>
      {notice ? (
        <p
          role={notice.isError ? "alert" : "status"}
          className={
            notice.isError ? "text-sm text-destructive" : "text-sm text-muted-foreground"
          }
        >
          {notice.text}
        </p>
      ) : null}
      <Button
        type="button"
        variant="link"
        size="sm"
        // 36 to a mouse, 44 to a finger: components.md §2's compact carve-out.
        className="mx-auto h-9 pointer-coarse:h-11"
        onClick={onBack}
      >
        {backLabel}
      </Button>
    </div>
  );
}
