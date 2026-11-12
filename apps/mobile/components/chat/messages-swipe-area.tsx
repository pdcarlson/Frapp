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
import { useOverlayOpen } from "@/lib/overlay-presence";
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
 * The travel is counted from where the pan took over, read off the pan's own
 * start event: gesture-handler zeroes the translation at that moment on iOS
 * and Android and not on web, so a fixed "minus the activation distance"
 * would leave the screen still for the first 24pt on a phone. The pan sits on
 * the area, not on the screen that moves, so a slide that starts on the
 * uncovered strip counts too.
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
 *
 * "At rest" means nobody is using the screen and nothing covers it: no finger
 * down for {@link HINT_REST_MS}, no menu of Chat home's open (`enabled`), and
 * no sheet or + panel over it (`useOverlayOpen`; a sheet leaves the screen
 * focused, and What's new opens on the very launch the hint first could).
 * The showing is recorded before it plays, and only a recorded one plays. One
 * that is covered or left before it could be read
 * ({@link HINT_SEEN_MS} after the slide) is given back, so the member's one
 * showing isn't spent where they couldn't see it.
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
  const overlayOpen = useOverlayOpen();
  const atRest = !!hint?.ready && enabled && !!viewerId && !overlayOpen;
  const unread = hint?.unreadConversations ?? 0;
  // Read at play time, not a dependency: a message arriving while the screen
  // rests must not restart the wait.
  const unreadRef = useRef(unread);
  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);

  const [session] = useState(createHintSession);

  /**
   * Back to rest: the screen home, the label gone. `covered` is an end nobody
   * chose (a sheet opened, the screen was left), which gives back a showing
   * too short to have been read.
   */
  const settle = useCallback(
    (ms: number, covered = false) => {
      session.stop(covered ? duration.context + HINT_SEEN_MS : null);
      offset.set(withTiming(0, { duration: ms }));
      label.set(withTiming(0, { duration: Math.min(ms, duration.standard) }));
    },
    [session, offset, label, duration],
  );

  const play = useCallback(
    (giveBack: () => void) => {
      label.set(withTiming(1, { duration: duration.standard }));
      if (!reduceMotion) {
        offset.set(withTiming(-MESSAGES_PEEK, { duration: duration.context }));
      }
      session.start(
        setTimeout(
          () => settle(duration.context),
          duration.context + HINT_HOLD_MS,
        ),
        giveBack,
      );
    },
    [session, offset, label, reduceMotion, settle, duration],
  );

  useEffect(() => {
    if (!atRest || !viewerId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      // A finger on the screen, or one just lifted, is not rest: wait it out.
      const wait = session.restLeft(HINT_REST_MS);
      if (wait > 0) {
        timer = setTimeout(attempt, wait);
        return;
      }
      void (async () => {
        const [screenReader, tourDue, record] = await Promise.all([
          screenReaderOn(),
          isTourDue(viewerId),
          readMessagesHint(viewerId),
        ]);
        if (cancelled || screenReader || tourDue || !record) return;
        if (session.restLeft(HINT_REST_MS) > 0) {
          attempt();
          return;
        }
        const now = Date.now();
        if (!shouldShowMessagesHint(record, now, unreadRef.current)) return;
        const kept = await writeMessagesHint(
          viewerId,
          messagesHintShown(record, now),
        );
        if (!kept) return;
        const giveBack = () => void writeMessagesHint(viewerId, record);
        if (cancelled) giveBack();
        else play(giveBack);
      })();
    };
    timer = setTimeout(attempt, HINT_REST_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Leaving the screen, or anything opening over it, ends a hint mid-play.
      if (session.isPlaying()) settle(0, true);
    };
  }, [atRest, viewerId, play, settle, session]);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .runOnJS(true)
        .activeOffsetX([MESSAGES_SWIPE_ACTIVATE_X, Number.MAX_SAFE_INTEGER])
        .failOffsetY([-MESSAGES_SWIPE_FAIL_Y, MESSAGES_SWIPE_FAIL_Y])
        .onBegin(() => {
          claim.begin();
          session.panDown();
          // Any touch ends the hint: the screen is the member's again.
          if (session.isPlaying()) settle(duration.micro);
        })
        .onStart((event) => {
          claim.claim();
          cancelAnimation(offset);
          session.panTookOver(event.translationX);
        })
        .onUpdate((event) => {
          offset.set(
            messagesFollowOffset(session.travel(event.translationX)),
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
          session.panUp();
          if (!session.isPlaying()) {
            offset.set(withTiming(0, { duration: duration.standard }));
          }
        }),
    [router, enabled, claim, offset, settle, viewerId, duration, session],
  );

  // The area's own touch events, which reach it whatever the pan decides and
  // wherever the finger lands, the uncovered strip included.
  const touch = useMemo(
    () => ({
      onTouchStart: () => {
        session.touchDown();
        if (session.isPlaying()) settle(duration.micro);
      },
      onTouchEnd: () => session.touchUp(),
      onTouchCancel: () => session.touchUp(),
    }),
    [session, settle, duration.micro],
  );

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));
  const fade = useAnimatedStyle(() => ({ opacity: label.get() }));

  return (
    <SwipeClaimProvider value={claim}>
      <GestureDetector gesture={swipe}>
        <View style={styles.area} testID="messages-swipe-area" {...touch}>
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
          <Animated.View
            style={[styles.screen, slide]}
            testID="messages-swipe-screen"
          >
            {children}
          </Animated.View>
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
      </GestureDetector>
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
 * What the area knows between renders: whether the hint is on screen (and
 * the timer that ends it), whether a finger is down, and where the pan's
 * travel is counted from. A plain object held in state, as the swipe's claim
 * is, because the pan's callbacks read it and they are built during render.
 */
function createHintSession(now: () => number = () => Date.now()) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  let giveBack: (() => void) | null = null;
  let touchIsDown = false;
  let panIsDown = false;
  let liftedAt = Number.NEGATIVE_INFINITY;
  let origin = 0;
  const lifted = () => {
    if (!touchIsDown && !panIsDown) liftedAt = now();
  };
  return {
    isPlaying: () => timer !== null,
    /** The hint is on screen; `undo` gives its showing back. */
    start(next: ReturnType<typeof setTimeout>, undo: () => void) {
      if (timer) clearTimeout(timer);
      timer = next;
      startedAt = now();
      giveBack = undo;
    },
    /**
     * The hint is over. `readableAfter` is passed for an end nobody chose:
     * one that came sooner than that many ms into the play gives the showing
     * back.
     */
    stop(readableAfter: number | null = null) {
      if (timer) clearTimeout(timer);
      const undo = giveBack;
      const unread =
        timer !== null &&
        readableAfter !== null &&
        now() - startedAt < readableAfter;
      timer = null;
      giveBack = null;
      if (unread) undo?.();
    },
    touchDown() {
      touchIsDown = true;
    },
    touchUp() {
      touchIsDown = false;
      lifted();
    },
    panDown() {
      panIsDown = true;
    },
    panUp() {
      panIsDown = false;
      lifted();
    },
    /** How long until the screen has gone `rest` ms with no finger on it. */
    restLeft(rest: number): number {
      if (touchIsDown || panIsDown) return rest;
      return Math.max(0, rest - (now() - liftedAt));
    },
    /** The pan took the touch over at this translation. */
    panTookOver(translationX: number | undefined) {
      origin = translationX ?? 0;
    },
    /** How far the finger has gone since then. */
    travel(translationX: number): number {
      return translationX - origin;
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

/**
 * How long the screen has to have been aside for the label to count as read.
 * A hint covered or left sooner than this is given back.
 */
const HINT_SEEN_MS = 600;

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
