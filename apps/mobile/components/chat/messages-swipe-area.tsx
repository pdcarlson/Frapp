import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { BackGlyph } from "@/components/control-glyphs";
import { NavGlyph } from "@/components/nav-glyph";
import {
  MESSAGES_FOLLOW_MAX,
  MESSAGES_HINT_TEXT,
  MESSAGES_PEEK,
  messagesFollowOffset,
  messagesHintShown,
  messagesHintSwiped,
  readMessagesHint,
  shouldShowMessagesHint,
  writeMessagesHint,
} from "@/lib/chat/messages-hint";
import {
  MESSAGES_SWIPE_ACTIVATE_X,
  MESSAGES_SWIPE_FAIL_Y,
  opensMessages,
} from "@/lib/chat/messages-swipe";
import { isTourDue } from "@/lib/onboarding/tour";
import { createSwipeClaim, SwipeClaimProvider } from "@/lib/swipe-claim";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chat home's swipe to Messages (#3774): a slide right to left opens it, as
 * the top-right door does. The rule for what counts is
 * `lib/chat/messages-swipe.ts`. JS-thread callbacks: the release navigates,
 * and the claim below has to be set before a row's press arrives.
 *
 * `enabled` is false while anything is open over the screen (a menu, a row's
 * actions), the way an open overlay holds screen gestures elsewhere
 * (`useHoldSwipeBack`): a drag across a menu must not open Messages behind
 * it. A pan the system cancels (`success` false) opens nothing.
 *
 * Once the pan takes the touch over, it holds it: the rows and buttons inside
 * read the claim it hands down (`lib/swipe-claim.ts`) and drop the press the
 * swipe's release would otherwise give the control it started on. A slide that activates
 * the pan is never a tap, whether or not it went far enough to open Messages.
 *
 * ## The screen gives under the finger
 *
 * Since #4610 step 3 the screen moves a little with the slide
 * (`messagesFollowOffset`: 60% of the travel, at most 72pt) and shows the
 * edge of Messages behind it, a strip with the door's paper plane. Until then
 * nothing moved until release, so a member who started the slide by accident
 * learned nothing from it. Messages still opens on release; the strip is a
 * sign of what is over there, not the screen itself. Only a transform moves,
 * so nothing in the layout shifts, and the floating tab bar stays where it is.
 *
 * ## The hint
 *
 * `hint` teaches the swipe (`lib/chat/messages-hint.ts` has when): once Chat
 * home has been at rest for a moment, the screen slides {@link MESSAGES_PEEK}
 * to the left by itself, a small label says "Swipe left for Messages", and it
 * settles back. With Reduce Motion on, the label shows and nothing slides.
 * Any touch ends it at once. It is skipped while a screen reader is on (the
 * door is the labelled way in, and a label that comes and goes is noise
 * there) and while the first-run tour is still due.
 */
export function MessagesSwipeArea({
  enabled,
  hint,
  children,
}: {
  enabled: boolean;
  hint?: MessagesSwipeHint;
  children: ReactNode;
}) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const reduceMotion = useReducedMotion();
  const [claim] = useState(createSwipeClaim);
  const offset = useSharedValue(0);
  const label = useSharedValue(0);
  const duration = tokens.motion.duration;

  const viewerId = hint?.viewerId ?? null;
  const atRest = !!hint?.ready && enabled && !!viewerId;
  const unread = hint?.unreadConversations ?? 0;
  // Read at play time, not a dependency: a message arriving while the screen
  // rests must not restart the wait.
  const unreadRef = useRef(unread);
  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);

  const [playback] = useState(createHintPlayback);

  /** Back to rest: the screen home, the label gone. */
  const settle = useCallback(
    (ms: number) => {
      playback.stop();
      offset.set(withTiming(0, { duration: ms }));
      label.set(withTiming(0, { duration: Math.min(ms, duration.standard) }));
    },
    [playback, offset, label, duration.standard],
  );

  const play = useCallback(() => {
    label.set(withTiming(1, { duration: duration.standard }));
    if (!reduceMotion) {
      offset.set(withTiming(-MESSAGES_PEEK, { duration: duration.context }));
    }
    playback.start(
      setTimeout(
        () => settle(duration.context),
        duration.context + HINT_HOLD_MS,
      ),
    );
  }, [playback, offset, label, reduceMotion, settle, duration]);

  useEffect(() => {
    if (!atRest || !viewerId) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const [screenReader, tourDue, record] = await Promise.all([
          screenReaderOn(),
          isTourDue(viewerId),
          readMessagesHint(viewerId),
        ]);
        if (cancelled || screenReader || tourDue || !record) return;
        const now = Date.now();
        if (!shouldShowMessagesHint(record, now, unreadRef.current)) return;
        await writeMessagesHint(viewerId, messagesHintShown(record, now));
        if (!cancelled) play();
      })();
    }, HINT_REST_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Leaving the screen, or a menu opening over it, ends a hint mid-play.
      if (playback.isPlaying()) settle(0);
    };
  }, [atRest, viewerId, play, settle, playback]);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .runOnJS(true)
        .activeOffsetX([MESSAGES_SWIPE_ACTIVATE_X, Number.MAX_SAFE_INTEGER])
        .failOffsetY([-MESSAGES_SWIPE_FAIL_Y, MESSAGES_SWIPE_FAIL_Y])
        .onBegin(() => {
          claim.begin();
          // Any touch ends the hint: the screen is the member's again.
          if (playback.isPlaying()) settle(duration.micro);
        })
        .onStart(() => {
          claim.claim();
          cancelAnimation(offset);
        })
        .onUpdate((event) => {
          offset.set(
            messagesFollowOffset(event.translationX, MESSAGES_SWIPE_ACTIVATE_X),
          );
        })
        .onEnd((event, success) => {
          if (!success || !opensMessages(event)) return;
          router.push("/messages");
          // They know the swipe now, so the hint never plays again.
          if (viewerId) {
            void readMessagesHint(viewerId).then((record) => {
              if (record && !record.swiped) {
                void writeMessagesHint(viewerId, messagesHintSwiped(record));
              }
            });
          }
        })
        .onFinalize(() => {
          claim.release();
          if (!playback.isPlaying()) {
            offset.set(withTiming(0, { duration: duration.standard }));
          }
        }),
    [router, enabled, claim, offset, settle, viewerId, duration, playback],
  );

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));
  const fade = useAnimatedStyle(() => ({ opacity: label.get() }));

  return (
    <SwipeClaimProvider value={claim}>
      <View style={styles.area}>
        {/* The edge of Messages, behind the screen: seen only while the
            screen is moved aside. Decoration; the door is the control. */}
        <View
          style={styles.edge}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="messages-edge"
        >
          <NavGlyph
            paths={NAV_GLYPHS.direct}
            color={tokens.color.text.mutedForeground}
            size={EDGE_GLYPH}
          />
        </View>
        <GestureDetector gesture={swipe}>
          <Animated.View style={[styles.screen, slide]}>
            {children}
          </Animated.View>
        </GestureDetector>
        {hint ? (
          <Animated.View
            style={[styles.label, fade]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="messages-hint"
          >
            <BackGlyph color={tokens.color.text.mutedForeground} size={16} />
            <Text style={styles.labelText}>{MESSAGES_HINT_TEXT}</Text>
          </Animated.View>
        ) : null}
      </View>
    </SwipeClaimProvider>
  );
}

export type MessagesSwipeHint = {
  /** Whose record to read; `null` until the account has loaded. */
  viewerId: string | null;
  /**
   * Chat home is in front and at rest: focused, its list loaded, the launch
   * jump settled. The area adds its own `enabled`, so an open menu holds it.
   */
  ready: boolean;
  /** Conversations with anything unread, which earns the one reminder. */
  unreadConversations: number;
};

/**
 * Whether the hint is on screen, and the timer that ends it. A plain object
 * held in state, as the swipe's claim is, because the pan's callbacks read it
 * and they are built during render.
 */
function createHintPlayback() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    isPlaying: () => timer !== null,
    start(next: ReturnType<typeof setTimeout>) {
      if (timer) clearTimeout(timer);
      timer = next;
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Whether a screen reader is on; an unanswered check counts as on. Not asked
 * on web, where react-native-web answers `true` for every browser: web is
 * the dev and capture build, never a member's phone.
 */
async function screenReaderOn(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return await AccessibilityInfo.isScreenReaderEnabled();
  } catch {
    return true;
  }
}

/** The label's height: the small control size (foundations.md §2). */
const LABEL_HEIGHT = 36;

/** The plane on the Messages edge. */
const EDGE_GLYPH = 24;

/** How long Chat home rests before the hint plays. */
const HINT_REST_MS = 1200;

/** How long the screen stays aside, once it has slid there. */
const HINT_HOLD_MS = 1400;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    area: {
      flex: 1,
      overflow: "hidden",
      backgroundColor: tokens.color.surface.background,
    },
    screen: { flex: 1 },
    edge: {
      position: "absolute",
      top: 0,
      bottom: 0,
      right: 0,
      width: MESSAGES_FOLLOW_MAX,
      // The plane sits in the middle of what the hint uncovers.
      alignItems: "flex-end",
      paddingRight: (MESSAGES_PEEK - EDGE_GLYPH) / 2,
      justifyContent: "center",
      backgroundColor: tokens.color.surface.surface1,
      borderLeftWidth: 1,
      borderLeftColor: tokens.color.border.hairline,
    },
    // Over the screen, beside the strip it points at, where a thumb would
    // start the slide. Its opacity is all that changes.
    label: {
      position: "absolute",
      top: "56%",
      right: MESSAGES_PEEK + tokens.spacing.md,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      height: LABEL_HEIGHT,
      paddingLeft: tokens.spacing.sm,
      paddingRight: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.popover,
    },
    labelText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
