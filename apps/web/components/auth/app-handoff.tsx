import {
  STORE_LISTING_URLS,
  openInAppUrl,
  type NativePlatform,
} from "@repo/validation";
import { AuthNote, AuthScreen } from "@/components/auth/auth-screen";
import { LinkGlyph } from "@/components/profile/profile-glyphs";
import { Button } from "@/components/ui/button";

const APP_HANDOFF_TITLE = "Join in the Frapp app";

const STORE_LABEL: Record<NativePlatform, string> = {
  ios: "Get Frapp on the App Store",
  android: "Get Frapp on Google Play",
};

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
 * Open in the app hands the invite over (`openInAppUrl`). iOS has no way to
 * carry it through an App Store install, so the note sends a member who just
 * installed back here, where the link still holds the invite. Android's
 * intent link opens Play by itself when the app is missing.
 */
export function AppHandoff({
  platform,
  token,
  onContinueInBrowser,
}: {
  platform: NativePlatform;
  token: string;
  onContinueInBrowser: () => void;
}) {
  return (
    <AuthScreen
      title={APP_HANDOFF_TITLE}
      subtitle="Your invite opens in the app, so you sign in once and land in your chapter."
      footer={
        <Button type="button" variant="link" onClick={onContinueInBrowser}>
          Continue in the browser
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Button asChild className="w-full">
          <a href={openInAppUrl(platform, token)}>Open in the app</a>
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <a href={STORE_LISTING_URLS[platform]}>{STORE_LABEL[platform]}</a>
        </Button>
      </div>
      <div className="mt-6">
        <AuthNote glyph={<LinkGlyph className="h-5 w-5" />}>
          Just installed it? Come back to this page and tap Open in the app. The
          app is in beta, so if the store says Frapp isn&apos;t available yet,
          continue in the browser.
        </AuthNote>
      </div>
    </AuthScreen>
  );
}
