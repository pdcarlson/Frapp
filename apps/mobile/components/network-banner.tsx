import { useCallback, useEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { useOpenChatTransport } from "@repo/hooks/open-chat-transport";
import { connectionIndicator } from "@repo/validation";
import { useConnection } from "@/lib/connection/use-connection";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { CloseGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";

/**
 * The one connection indicator — `spec/ui/resilience/connection-state.md`
 * § One indicator. Web's `ConnectionPill` draws the same pattern.
 *
 * Reads `useConnection()` and the open chat's transport
 * (`useOpenChatTransport`) rather than taking props, and lets
 * `connectionIndicator` (`@repo/validation`) pick the one thing worth saying:
 * "Offline", "Slow connection", or, on an otherwise healthy connection with a
 * chat open, "Reconnecting…" or "Live updates paused".
 *
 * ## Why one
 *
 * A chat thread used to stack three: this pill, a tinted band under the
 * thread header with the transport's own sentence ("Reconnecting…", or
 * "Real-time updates paused. Polling for new messages."), and the composer's
 * hint line ("You're offline — messages send when you reconnect, but photos
 * need a connection."). A weak connection showed "Slow connection" here and
 * "Reconnecting…" in the band at once (2026-11-06, Paul). Now the thread
 * reports its transport (`useReportOpenChatTransport`) instead of drawing it,
 * and the queue's promise lives in this pill's sentence while a chat is open.
 *
 * ## Short label, whole sentence a tap away
 *
 * The pill draws the short label so it fits between a header's back capsule
 * and its right-hand controls. The whole sentence is its accessible name, and
 * a tap on the label opens it in place (a tap again closes it), so a sighted
 * member can read what a screen reader hears without the pill carrying a
 * paragraph all the time.
 *
 * ## Placement
 *
 * It floats at the top of the window, over the header, mounted in
 * `app/_layout.tsx` after the sheet provider so it draws over every screen and
 * every open sheet. It takes no layout, so nothing moves when it comes or
 * goes, and only the pill takes touches. It can be dismissed.
 *
 * **No emoji.** The banner copy used to lead with ⚡ and 📡. Those predate
 * Signet's iconography rule; the dot's color carries the severity.
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
  const { state } = useConnection();
  const transport = useOpenChatTransport();
  const indicator = connectionIndicator(state, transport);
  // Dismissal and the opened sentence are both of what the pill said: a new
  // thing to say shows again at once, closed.
  const said = indicator?.description ?? null;

  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed = said !== null && dismissedFor === said;
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = said !== null && openFor === said;
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(
      () => setDismissedFor(null),
      REAPPEAR_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [dismissed]);

  const visible = indicator !== null && !dismissed;

  /**
   * Kept mounted only while it has something to show or is animating out.
   *
   * Without this the component returned early only on `indicator === null`, so a
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

  const onDismiss = useCallback(() => setDismissedFor(said), [said]);
  const onToggle = useCallback(
    () => setOpenFor((current) => (current === said ? null : said)),
    [said],
  );

  if (indicator === null || !mounted) return null;

  const severity =
    indicator.tone === "danger"
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
            reader announces, and what a tap opens in place. */}
        <Pressable
          onPress={onToggle}
          style={styles.labelPress}
          accessibilityRole="button"
          accessibilityLabel={indicator.description}
          accessibilityState={{ expanded: open }}
          accessibilityHint={
            open ? "Shows the short label again." : "Shows the whole message."
          }
        >
          <Text style={styles.text} numberOfLines={open ? 4 : 1}>
            {open ? indicator.description : indicator.label}
          </Text>
        </Pressable>
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
    labelPress: {
      flexShrink: 1,
      paddingVertical: tokens.spacing.xs,
    },
    text: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
  });
}
