import { openInAppUrl, type NativePlatform } from "@repo/validation";
import { AuthNote, AuthScreen } from "@/components/auth/auth-screen";
import { LinkGlyph } from "@/components/profile/profile-glyphs";
import { Button } from "@/components/ui/button";
import { installSource, useAppInstall } from "@/lib/app-install";

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
 * (Get TestFlight, then Join the beta): get the app, then open the invite.
 * The order is real, since iOS can't carry the invite through an install: the
 * member comes back to this page, where the link still holds it, and step two
 * opens the app on the join step (2026-11-19, so one texted link is all a
 * beta tester needs). Without one (Frapp Staging before its TestFlight link is
 * set) the page offers Open in the app alone.
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
  return (
    <AuthScreen
      title={hero ? undefined : `Join in the ${app.name} app`}
      hero={hero}
      subtitle={
        hero ? undefined : "Two steps, then you sign in once and land in your chapter."
      }
      footer={footer}
    >
      {hero ? <HandoffHeading appName={app.name} /> : null}
      <ol className="flex flex-col gap-6">
        <HandoffStep
          number={1}
          title={`Get ${app.name}`}
          detail="Already have it? Skip to step 2."
        >
          <Button asChild variant="secondary" className="w-full">
            <a href={installUrl}>Get {app.name}</a>
          </Button>
          {hint ? (
            <p className="text-caption text-muted-foreground">{hint}</p>
          ) : null}
        </HandoffStep>
        <HandoffStep
          number={2}
          title="Open your invite"
          detail="Come back to this page once it's installed. Your invite stays in this link."
        >
          {openLink}
        </HandoffStep>
      </ol>
    </AuthScreen>
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
  children,
}: {
  number: number;
  title: string;
  detail: string;
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
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
        {children}
      </div>
    </li>
  );
}
