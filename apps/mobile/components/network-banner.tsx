import { useCallback, useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { useConnection } from "@/lib/connection/use-connection";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The global connection banner — `spec/ui/resilience.md` § 2.
 *
 * Reads `useConnection()` rather than taking props. It used to take two raw
 * `expo-network` booleans from `app/_layout.tsx` and derive its own offline and
 * degraded flags inline, which made it a *second* opinion about connectivity
 * alongside the one `@repo/chat-core` already held — two readings of the same
 * device state that could, and did, disagree on screen. There is now one
 * source (`lib/connection/monitor.ts`) and this renders it.
 *
 * ## Two deliberate deviations from § 2, both recorded in the spec
 *
 * **Placement.** § 2 says "below the header bar". That is a web-shaped rule
 * written for a dashboard chrome. Here the banner is mounted above the
 * navigator in `app/_layout.tsx`, because a global banner belongs above every
 * screen and moving it under each header would mean editing the frozen
 * `components/screen-shell.tsx`. It does take the safe-area inset, which it
 * previously did not — it rendered outside every `SafeAreaView` and painted
 * under the status bar on a notched device.
 *
 * **No emoji.** § 2's copy leads with ⚡ and 📡. Those predate Signet's
 * iconography rule, and the semantic tint already carries the severity they
 * stood in for. The copy is otherwise verbatim, and `apps/web`'s banner has been
 * left for its own reskin rather than changed from a mobile slice.
 *
 * ## Why the chat thread still has its own pill
 *
 * `app/(tabs)/chat-thread.tsx` shows a connection pill driven by the realtime
 * transport, which answers a different question: this banner says whether the
 * *API* is reachable, the pill says whether *live updates* are flowing.
 * "Real-time updates paused. Polling for new messages." is a working degraded
 * mode with no equivalent here, and `spec/ui/resilience.md` § 3.2 declares that
 * string normative. The pill suppresses only its own offline branch while this
 * banner is already saying the same thing.
 */

/** § 2: "200ms slide-down animation". */
const SLIDE_MS = 200;

/**
 * § 2: "User can manually dismiss (it reappears if state hasn't changed after
 * 30s)". The reappearance is the point — dismissing acknowledges the message,
 * it does not fix the network, and a member who then loses a write deserves to
 * have been told again.
 */
const REAPPEAR_AFTER_MS = 30_000;

export function NetworkBanner() {
  const { tokens } = useFrappTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(tokens);
  const { state, message, isOffline } = useConnection();

  const [dismissedForState, setDismissedForState] = useState<string | null>(
    null,
  );
  const dismissed = dismissedForState === state;
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(
      () => setDismissedForState(null),
      REAPPEAR_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [dismissed]);

  const visible = message !== null && !dismissed;

  /**
   * Kept mounted only while it has something to show or is animating out.
   *
   * Without this the component returned early only on `message === null`, so a
   * *dismissed* banner stayed in the tree at opacity 0 — keeping its safe-area
   * padding, its text line and its border, and pushing every screen in the app
   * down behind an invisible band for the full 30s until it reappeared. A
   * control whose only job is to give the screen back has to actually give it
   * back. It also keeps the `alert` node and the Dismiss button out of the
   * screen-reader tree, which `pointerEvents` alone does not do.
   */
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the node mounted so the 200ms slide-out can finish
    if (visible) setMounted(true);
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: SLIDE_MS,
      // Opacity alone could run on the UI thread, but the height collapse below
      // cannot — layout is not a transform property — and both have to finish
      // together or the band outlives the message.
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, slide]);

  const onDismiss = useCallback(
    () => setDismissedForState(state),
    [state],
  );

  if (message === null || !mounted) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        isOffline ? styles.offlineContainer : styles.degradedContainer,
        { paddingTop: insets.top + tokens.spacing.sm, opacity: slide },
      ]}
      // Announced rather than merely drawn: a member using a screen reader
      // needs to know a write is about to fail as much as a sighted one does.
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      pointerEvents={visible ? "auto" : "none"}
    >
      <Text
        style={[
          styles.text,
          isOffline ? styles.offlineText : styles.degradedText,
        ]}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        accessibilityHint="Hides this message. It returns if the connection has not recovered."
        // The control is a short word, so the box is well under 44pt; the hit
        // area closes the gap without a chunky bar across the top — the same
        // ruling `components/sheet-scaffold.tsx` applies to its Cancel.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={onDismiss}
      >
        <Text
          style={[
            styles.dismiss,
            isOffline ? styles.offlineText : styles.degradedText,
          ]}
        >
          Dismiss
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.sm,
      borderBottomWidth: 1,
    },
    text: {
      flex: 1,
      ...typeRole(tokens.typography.role.caption),
    },
    dismiss: {
      ...typeRole(tokens.typography.role.caption),
      textDecorationLine: "underline",
    },
    offlineContainer: {
      backgroundColor: tint(tokens.color.semantic.destructive),
      borderBottomColor: tint(tokens.color.semantic.destructive, 0.3),
    },
    degradedContainer: {
      backgroundColor: tint(tokens.color.semantic.warning),
      borderBottomColor: tint(tokens.color.semantic.warning, 0.3),
    },
    offlineText: {
      color: tokens.color.semantic.destructive,
    },
    degradedText: {
      color: tokens.color.semantic.warning,
    },
  });
}
