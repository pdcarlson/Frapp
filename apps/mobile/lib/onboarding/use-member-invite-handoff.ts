import { useEffect } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useListChapters } from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import {
  consumeRememberedInviteToken,
  peekRememberedInviteToken,
  takeInviteTokenFromLink,
} from "@/lib/onboarding/invite-token";
import {
  isMemberInviteMoment,
  memberInviteWebUrl,
} from "@/lib/onboarding/member-invite";
import { useAuthGateDestination } from "@/lib/onboarding/use-auth-gate";

/**
 * Mounted app-wide (`components/app-runtime.tsx`). Takes the invite from the
 * link that opened the app, marking that link handled so s02 never replays
 * it, or from the invite s02 remembered across a signed-out bounce to sign-in
 * (a member who was signed out when they tapped it).
 */
export function useMemberInviteHandoff(): void {
  const destination = useAuthGateDestination();
  const { status } = useAuthSession();
  const chapters = useListChapters({ enabled: status === "authenticated" });
  const chapterCount =
    chapters.isSuccess && Array.isArray(chapters.data)
      ? chapters.data.length
      : null;
  const url = Linking.useURL();
  const memberMoment = isMemberInviteMoment(destination, chapterCount);

  useEffect(() => {
    if (!memberMoment) return;
    const fromLink = takeInviteTokenFromLink(url);
    const token =
      fromLink ??
      (peekRememberedInviteToken() !== null
        ? consumeRememberedInviteToken()
        : null);
    if (!token) return;
    // A browser already open (iOS answers `locked`) is closed first, so a
    // second invite tapped while the first page is up still opens.
    void WebBrowser.openBrowserAsync(memberInviteWebUrl(token))
      .then(async (result) => {
        if (result.type !== "locked") return;
        WebBrowser.dismissBrowser();
        await WebBrowser.openBrowserAsync(memberInviteWebUrl(token));
      })
      .catch(() => {
        // No browser to open it in (an Android without Custom Tabs). The
        // link still works from the phone's own browser; nothing here can
        // open it there without the app catching it again.
      });
  }, [memberMoment, url]);
}
