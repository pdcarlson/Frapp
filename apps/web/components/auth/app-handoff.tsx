import { useState } from "react";
import {
  installHandoffCopy,
  openInAppUrl,
  type NativePlatform,
} from "@repo/validation";
import { AuthNote, AuthScreen } from "@/components/auth/auth-screen";
import { LinkGlyph } from "@/components/profile/profile-glyphs";
import { Button } from "@/components/ui/button";
import { installSource, useAppInstall } from "@/lib/app-install";
import { buildJoinUrl } from "@/lib/invite-link";

/** What each kind of install link does, said under the Get button. */
const INSTALL_HINT = {
  testflight:
    "Opens TestFlight, Apple's app for betas. Tap Accept, then Install. If you don't have TestFlight, Apple's page offers it first.",
  "play-testing":
    "Opens Google Play's tester page. Join the test, then tap Install. If Play says you aren't a tester, ask the officer who sent your invite to add you.",
  // During the beta the store listings open for testers only.
  store:
    "The app is in beta, so if the store says it isn't available yet, continue in the browser.",
} as const;

/**
 * What an invite link opened on a phone shows first (#4002).
 *
 * With the app installed and app links set up, the link opens the app and
 * never reaches this page. It shows when the app isn't installed, when the
 * link was opened inside another app's browser, or on a build without app
 * links. Joining here and then signing in to the app again is the double
 * sign-in #4002 removes, so the app comes first and the browser is the
 * fallback: the way Discord's and Slack's invite pages on a phone lead with
 * their app and keep "continue in browser" below.
 *
 * With an install link for this environment's app (`lib/app-install.ts`), the
 * page is two numbered steps, the way TestFlight's own public-link page reads
 * (Get TestFlight, then Join the beta): get the app, then paste the invite in
 * it (2026-11-19, so one texted link is all a beta tester needs). iOS can't
 * carry a link through an install, so tapping Get copies the invite link
 * (#5626, Paul's pick "Copy on install, Paste fallback"), and the app's first
 * screen offers the system Paste, which opens this invite's card. The store
 * page opens in a new tab, so this page, and its Open in the app for a member
 * who already had it, is still here to come back to. Without an install link
 * (Frapp Staging before its TestFlight link is set) the page offers Open in
 * the app alone.
 *
 * Open in the app hands the invite over (`openInAppUrl`). Android's intent
 * link opens Play by itself when the app is missing.
 */
export function AppHandoff({
  platform,
  token,
  hero,
  onContinueInBrowser,
}: {
  platform: NativePlatform;
  token: string;
  /**
   * The invite card (#5625), drawn above the steps so the chapter is the
   * first thing on the page; the steps then sit under a plain heading.
   */
  hero?: React.ReactNode;
  onContinueInBrowser: () => void;
}) {
  const { app, installUrl } = useAppInstall(platform);
  const openLink = (
    <Button asChild className="w-full">
      <a href={openInAppUrl(platform, token, app)}>Open in {app.name}</a>
    </Button>
  );
  const footer = (
    <p>
      Not on your phone?{" "}
      <Button
        type="button"
        variant="link"
        className="h-auto px-0"
        onClick={onContinueInBrowser}
      >
        Join on the web instead
      </Button>
    </p>
  );

  if (installUrl === null) {
    return (
      <AuthScreen
        title={hero ? undefined : `Join in the ${app.name} app`}
        hero={hero}
        subtitle={
          hero
            ? undefined
            : "Your invite opens in the app, so you sign in once and land in your chapter."
        }
        footer={footer}
      >
        {hero ? <HandoffHeading appName={app.name} /> : null}
        {openLink}
        <div className="mt-6">
          <AuthNote glyph={<LinkGlyph className="h-5 w-5" />}>
            Don&apos;t have {app.name} yet? Ask the officer who sent your invite
            how to get it, or continue in the browser.
          </AuthNote>
        </div>
      </AuthScreen>
    );
  }

  const hint = INSTALL_HINT[installSource(installUrl)];
  const copy = installHandoffCopy(app.name);
  return (
    <AuthScreen
      title={hero ? undefined : `Join in the ${app.name} app`}
      hero={hero}
      subtitle={
        hero
          ? undefined
          : "Two steps, then you sign in once and land in your chapter."
      }
      footer={footer}
    >
      {hero ? <HandoffHeading appName={app.name} /> : null}
      <ol className="flex flex-col gap-6">
        <GetAppStep
          appName={app.name}
          installUrl={installUrl}
          token={token}
          hint={hint}
        />
        <HandoffStep
          number={2}
          title={copy.pasteTitle}
          detail={copy.pasteDetail}
        >
          {openLink}
        </HandoffStep>
      </ol>
    </AuthScreen>
  );
}

/**
 * Step 1, Get the app, which also copies the invite (#5626). The copy runs in
 * the tap itself, as browsers require of a clipboard write, and the store
 * opens in a new tab so this page stays where the member left it. The line
 * under the title says what happened, in its own place, so nothing moves: the
 * app's Paste is next, or, where the browser refused the write (some in-app
 * browsers do), coming back here to Open in the app once it's installed.
 */
function GetAppStep({
  appName,
  installUrl,
  token,
  hint,
}: {
  appName: string;
  installUrl: string;
  token: string;
  hint: string | undefined;
}) {
  const copy = installHandoffCopy(appName);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  function copyInvite() {
    try {
      // Inside the `try`: the link refuses a public plain-http origin, and
      // the store must still open with the fallback line shown.
      const link = buildJoinUrl(window.location.origin, token);
      void navigator.clipboard
        .writeText(link)
        .then(() => setCopied("yes"))
        .catch(() => setCopied("failed"));
    } catch {
      // No clipboard at all (an insecure origin, an old in-app browser), or
      // no link to copy.
      setCopied("failed");
    }
  }
  return (
    <HandoffStep
      number={1}
      title={`Get ${appName}`}
      detail={
        copied === "yes"
          ? copy.copied
          : copied === "failed"
            ? copy.copyFailed
            : copy.getDetail
      }
      live
    >
      <Button asChild variant="secondary" className="w-full">
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={copyInvite}
        >
          Get {appName}
        </a>
      </Button>
      {hint ? (
        <p className="text-caption text-muted-foreground">{hint}</p>
      ) : null}
    </HandoffStep>
  );
}

/** Above the steps when the invite card heads the page (#5625). */
function HandoffHeading({ appName }: { appName: string }) {
  return (
    <p className="mb-5 text-base text-muted-foreground">
      Join in the {appName} app, so you sign in once and land in your chapter.
    </p>
  );
}

function HandoffStep({
  number,
  title,
  detail,
  live = false,
  children,
}: {
  number: number;
  title: string;
  detail: string;
  /** The detail changes on a tap, so a screen reader hears the new line. */
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-caption font-bold text-accent-text"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="text-base font-semibold text-foreground">
            <span className="sr-only">Step {number}: </span>
            {title}
          </p>
          <p
            className="text-sm text-muted-foreground"
            aria-live={live ? "polite" : undefined}
          >
            {detail}
          </p>
        </div>
        {children}
      </div>
    </li>
  );
}
