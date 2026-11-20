import { useCallback, useEffect, useRef, useState } from "react";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { BackRow } from "@/components/back-row";
import { JoinWithInvite } from "@/components/onboarding/join-with-invite";
import {
  consumeRememberedInviteToken,
  inviteFromParams,
  rememberInviteToken,
  type InviteParams,
} from "@/lib/onboarding/invite-token";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { useBackToClose } from "@/lib/overlay";
import { useFrappTheme } from "@/lib/theme";

/**
 * An invite to another chapter, for a member who already has one (#4341).
 *
 * s02 is the zero-membership screen and the gate keeps a member off it, so an
 * invite link a member opens comes here instead: the `(auth)` layout sends a
 * link that lands on `/join` with a member's gate here, and
 * `useMemberInviteHandoff` brings one remembered across a sign-in, or one
 * that arrived while the Terms prompt or s03 held them. It is the same invite
 * card s02 draws (`JoinWithInvite`): the chapter, the role the link grants,
 * the Terms checkbox when the account needs it, and Join. Joining selects the
 * new chapter, whose first-run (s03) the gate then opens, as a new member's
 * would; an invite to a chapter they're already in says so and opens it.
 *
 * Back declines the invite and returns to the chapter they were in, as
 * Discord's Join server sheet closes over the current server and Slack's
 * workspace switcher leaves the open workspace where it was.
 */
export default function JoinAnotherChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const params = useLocalSearchParams<InviteParams>();
  const [token, setToken] = useState(() => inviteFromParams(params));
  // A join, or the open of a chapter they're already in, holds the screen.
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // A new link opened while this screen is up replaces the invite it shows,
  // once: a join that ends (busy back to false) doesn't put the link's invite
  // back over one pasted since.
  const fromParams = inviteFromParams(params);
  const shownParam = useRef(fromParams);
  useEffect(() => {
    if (!fromParams || busy || fromParams === shownParam.current) return;
    shownParam.current = fromParams;
    setToken(fromParams);
  }, [busy, fromParams]);

  // However the card closes (Back, iOS's edge swipe, a join), the invite is
  // done with: nothing reopens it now or on the next launch.
  useEffect(
    () => () => {
      consumeRememberedInviteToken();
    },
    [],
  );

  const leave = useCallback(() => {
    if (busy) return;
    // Declined: nothing carries it to the next launch.
    consumeRememberedInviteToken();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [busy, router]);
  useBackToClose(focused, leave);

  const openOther = useCallback((next: string) => {
    rememberInviteToken(next);
    setToken(next);
  }, []);

  if (!token) return <Redirect href="/" />;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      <KeyboardAvoidingArea style={styles.flex} atScreenBottom>
        <View style={styles.flex}>
          <JoinWithInvite
            key={token}
            token={token}
            then={null}
            header={
              <View style={styles.header}>
                <BackRow
                  house
                  label="Back"
                  accessibilityLabel="Back to your chapter"
                  disabled={busy}
                  onPress={leave}
                />
              </View>
            }
            onBusyChange={setBusy}
            onOtherInvite={openOther}
            onLeave={leave}
          />
        </View>
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    header: {
      minHeight: tokens.touch.minimum,
      marginTop: tokens.spacing.sm,
    },
  });
}
