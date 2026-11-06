import { useCallback, useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { useConnection } from "@/lib/connection/use-connection";
import { connectionPillLabel } from "@/lib/connection/state";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { CloseGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";

/**
 * The global connection banner — `spec/ui/resilience/connection-state.md`.
 *
 * Reads `useConnection()` rather than taking props. It used to take two raw
 * `expo-network` booleans from `app/_layout.tsx` and derive its own offline and
 * degraded flags inline, which made it a *second* opinion about connectivity
 * alongside the one `@repo/chat-core` already held — two readings of the same
 * device state that could, and did, disagree on screen. There is now one
 * source (`lib/connection/monitor.ts`) and this renders it.
 *
 * ## Two deliberate deviations from connection-state.md, both recorded in the spec
 *
 * **Placement.** UI Indicators says "below the header bar". That is a web-shaped rule
 * written for a dashboard chrome. Here the pill floats at the top of the
 * window, over the header, mounted in `app/_layout.tsx` after the sheet
 * provider so it draws over every screen and every open sheet, because a
 * global banner belongs above everything and moving it under each header would
 * mean editing the frozen `components/screen-shell.tsx`. It draws a short label
 * ("Slow connection", `connectionPillLabel`) so it fits between a header's
 * back capsule and its right-hand controls, and it can be dismissed.
 *
 * **A floating pill, not a band (2026-11-06).** It used to be a full-width
 * tinted band in the layout, under the status bar, so every state change
 * pushed the whole app (an open sheet included) down by a line and back up.
 * Now it floats, as web's banner does: a small pill just under the status
 * bar, drawn over the screen rather than beside it, so nothing moves when it
 * comes or goes. The colored dot carries the severity; the words stay quiet.
 * Only the pill takes touches, so the strip either side of it still reaches
 * the screen beneath.
 *
 * **No emoji.** The banner copy leads with ⚡ and 📡. Those predate Signet's
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
 * mode with no equivalent here, and `spec/ui/resilience/message-delivery.md#receiving-messages-realtime` declares that
 * string normative. The pill suppresses only its own offline branch while this
 * banner is already saying the same thing.
 */

/** UI Indicators: "200ms slide-down animation". */
const SLIDE_MS = 200;

/**
 * UI Indicators: "User can manually dismiss (it reappears if state hasn't changed after
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
   * *dismissed* banner stayed in the tree at opacity 0 for the full 30s until
   * it reappeared: when it was still a band in the layout, that pushed every
   * screen down behind an invisible strip. The pill takes no layout, but
   * unmounting still keeps the `alert` node and the Dismiss button out of the
   * screen-reader tree, which `pointerEvents` alone does not do.
   */
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep the node mounted so the 200ms slide-out can finish
    if (visible) setMounted(true);
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: SLIDE_MS,
      // Opacity only, which the native driver runs on the UI thread.
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, slide]);

  const onDismiss = useCallback(
    () => setDismissedForState(state),
    [state],
  );

  if (message === null || !mounted) return null;

  const severity = isOffline
    ? tokens.color.semantic.destructive
    : tokens.color.semantic.warning;

  return (
    <View
      style={[styles.overlay, { top: insets.top + tokens.spacing.xs }]}
      // The row spans the screen only to center the pill: touches outside the
      // pill pass through to the screen beneath.
      pointerEvents="box-none"
    >
      <Animated.View
        style={[styles.pill, { opacity: slide }]}
        // Announced rather than merely drawn: a member using a screen reader
        // needs to know a write is about to fail as much as a sighted one does.
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        pointerEvents={visible ? "auto" : "none"}
      >
        <View style={[styles.dot, { backgroundColor: severity }]} />
        {/* The short label is drawn; the whole sentence is what a screen
            reader announces (`connectionPillLabel`). */}
        <Text
          style={styles.text}
          numberOfLines={1}
          accessibilityLabel={message}
        >
          {connectionPillLabel(state) ?? message}
        </Text>
        <IconButton
          label="Dismiss"
          hint="Hides this message. It returns if the connection has not recovered."
          onPress={onDismiss}
        >
          <CloseGlyph color={tokens.color.text.mutedForeground} />
        </IconButton>
      </Animated.View>
    </View>
  );
}

/** The pill's height: foundations §9's Chip-to-Row band, under 44 drawn. */
const PILL_HEIGHT = 32;
const DOT_SIZE = 8;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    overlay: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
      paddingHorizontal: tokens.spacing.lg,
      // Over every screen. `app/_layout.tsx` mounts it after the sheet
      // provider, whose portal host is where every open sheet and scrim
      // paints, so it draws over those too; this lifts it over the navigator
      // on Android, where elevation, not order, decides.
      zIndex: 1000,
      elevation: 1000,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      maxWidth: "100%",
      minHeight: PILL_HEIGHT,
      paddingLeft: tokens.spacing.md,
      paddingRight: tokens.spacing.sm,
      borderRadius: PILL_HEIGHT / 2,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
    text: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
  });
}
