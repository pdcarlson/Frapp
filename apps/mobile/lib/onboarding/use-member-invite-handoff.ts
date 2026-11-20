import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { usePathname, useRouter } from "expo-router";
import { useListChapters } from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import {
  peekRememberedInviteToken,
  rememberInviteToken,
  takeInviteTokenFromLink,
} from "@/lib/onboarding/invite-token";
import { isMemberInviteMoment } from "@/lib/onboarding/member-invite";
import { useAuthGateDestination } from "@/lib/onboarding/use-auth-gate";

/** The second-chapter invite card (#4341). */
export const JOIN_ANOTHER_PATH = "/join-another";

/**
 * Mounted app-wide (`components/app-runtime.tsx`). Brings a member's invite
 * to the second-chapter card (`app/(auth)/join-another.tsx`, #4341), where
 * they join in the app with the session they have.
 *
 * It takes the invite from the link that opened the app, marking that link
 * handled so s02 never replays it, and remembers it; or it reads the invite
 * s02 remembered across a signed-out bounce to sign-in (a member who was
 * signed out when they tapped it). The card opens once the gate reaches the
 * tabs, so a member held on the Terms prompt or s03 meets it after them. A
 * link that lands on `/join` with the tabs open is sent to the card by the
 * `(auth)` layout itself, so this leaves that one to it. The invite stays
 * remembered until the card joins it or the member backs out.
 */
export function useMemberInviteHandoff(): void {
  const destination = useAuthGateDestination();
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useAuthSession();
  const chapters = useListChapters({ enabled: status === "authenticated" });
  const chapterCount =
    chapters.isSuccess && Array.isArray(chapters.data)
      ? chapters.data.length
      : null;
  const url = Linking.useURL();
  const memberMoment = isMemberInviteMoment(destination, chapterCount);
  // The invite last sent to the card, until the card is reached: a re-run
  // before the push lands (a new URL, a chapters refetch) doesn't push twice.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!memberMoment) return;
    const fromLink = takeInviteTokenFromLink(url);
    if (fromLink && fromLink !== peekRememberedInviteToken()) {
      rememberInviteToken(fromLink);
    }
    if (destination !== "tabs") return;
    // On the card already, or on the way there from `/join`.
    if (pathname === JOIN_ANOTHER_PATH) {
      sent.current = null;
      return;
    }
    if (pathname === "/join") return;
    const token = peekRememberedInviteToken();
    if (!token || sent.current === token) return;
    sent.current = token;
    router.push({ pathname: JOIN_ANOTHER_PATH, params: { token } });
  }, [destination, memberMoment, pathname, router, url]);
}
