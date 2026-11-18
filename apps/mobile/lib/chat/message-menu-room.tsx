import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Keyboard, View, useWindowDimensions } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useChapterBranding } from "@/lib/chapter-branding";

/**
 * The long-press message menu takes the keyboard's place (#5479).
 *
 * Paul, 2026-11-18: "haptic message option pop-up should not take up the
 * whole screen. This makes it impossible to see what message I'm even looking
 * at. It should just replace the keyboard." So the menu opens at the
 * keyboard's height and no taller (`messageMenuHeight`), and while it is up
 * the thread leaves that room under its composer, as it does for the
 * keyboard (`MessageMenuRoom`). The pressed message is drawn in the chapter's
 * quiet fill (`MessageMenuCell`) and, when the room would push it off the
 * top or it already sat under the sheet, scrolled to sit just above it. That
 * is how iMessage, WhatsApp and Telegram keep the message in view while its
 * menu is open.
 */

/** Used when no keyboard has opened yet this run: about a phone keyboard. */
const FALLBACK_SHARE = 0.4;
/** Never shorter than this share: the reactions and the first rows fit. */
const MIN_SHARE = 0.35;
/** Never taller than half the screen, whatever the keyboard reports. */
const MAX_SHARE = 0.5;
/** The sheet's open and close, so the room grows and shrinks with it. */
const ROOM_MS = 250;

/**
 * The menu's one detent, in points: the keyboard's last height, held between
 * 35% and 50% of the window, or 40% before any keyboard has opened.
 */
export function messageMenuHeight(
  windowHeight: number,
  keyboardHeight: number | null,
): number {
  const wanted =
    keyboardHeight && keyboardHeight > 0
      ? keyboardHeight
      : windowHeight * FALLBACK_SHARE;
  return Math.round(
    Math.min(
      windowHeight * MAX_SHARE,
      Math.max(windowHeight * MIN_SHARE, wanted),
    ),
  );
}

/**
 * The last keyboard height this run, shared by every screen, so a menu opened
 * on a thread the keyboard never rose on still matches the keyboard.
 */
let lastKeyboardHeight: number | null = null;

/** Test-only: forget the remembered keyboard. */
export function resetKeyboardHeightForTests() {
  lastKeyboardHeight = null;
}

/** The menu's height, following the keyboard as it opens. */
export function useMessageMenuHeight(): number {
  const { height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(lastKeyboardHeight);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      const next = event?.endCoordinates?.height;
      if (!next || next <= 0) return;
      lastKeyboardHeight = next;
      setKeyboardHeight(next);
    });
    return () => show.remove();
  }, []);
  return messageMenuHeight(windowHeight, keyboardHeight);
}

/** What the highlighted message's cell hands back once it is drawn. */
interface MessageMenuFocus {
  highlightedId: string | null;
  /** The chapter's quiet fill, read once for the list rather than per row. */
  fill?: string;
  /** The highlighted cell, drawn: measure it and scroll it into view. */
  onHighlighted: (messageId: string, cell: View) => void;
}

const MessageMenuFocusContext = createContext<MessageMenuFocus>({
  highlightedId: null,
  onHighlighted: () => {},
});

/**
 * The thread's side of the menu. `reveal` scrolls the list so the message
 * sits at the bottom of the room left above the menu (`jumpToMessage` with
 * `viewPosition: 0` on an inverted list).
 */
export function useMessageMenuRoom(reveal: (messageId: string) => void) {
  const sheetHeight = useMessageMenuHeight();
  const { accentSubtle } = useChapterBranding();
  const { bottom } = useSafeAreaInsets();
  // The SafeAreaView under the composer already pads the bottom inset, which
  // the sheet covers too.
  const room = Math.max(0, sheetHeight - bottom);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const shown = useSharedValue(0);
  const listRef = useRef<View>(null);
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const onMenuOpenChange = useCallback(
    (messageId: string | null) => {
      setHighlightedId(messageId);
      shown.set(withTiming(messageId ? 1 : 0, { duration: ROOM_MS }));
    },
    [shown],
  );

  const onHighlighted = useCallback(
    (messageId: string, cell: View) => {
      const list = listRef.current;
      // Measuring needs the native views; nothing to do without them.
      if (!list?.measureInWindow || !cell.measureInWindow) return;
      list.measureInWindow((_lx, listTop, _lw, listHeight) => {
        cell.measureInWindow((_cx, cellTop, _cw, cellHeight) => {
          // The list is inverted, so the room shrinks it from the bottom and
          // the rows move up with its bottom edge. What the room hasn't taken
          // yet is still to come.
          const toCome = roomRef.current * (1 - shown.get());
          const listBottom = listTop + listHeight - toCome;
          const top = cellTop - toCome;
          const bottomEdge = cellTop + cellHeight - toCome;
          if (top < listTop || bottomEdge > listBottom) {
            revealRef.current(messageId);
          }
        });
      });
    },
    [shown],
  );
  const focus = useMemo<MessageMenuFocus>(
    () => ({ highlightedId, fill: accentSubtle, onHighlighted }),
    [highlightedId, accentSubtle, onHighlighted],
  );

  return {
    /** The menu's detent, for `MessageActionsSheet`'s `height`. */
    sheetHeight,
    /** How much room the thread leaves under its composer, fully open. */
    room,
    /** Animated 0 to 1 with the sheet. */
    shown,
    /** Put on the view that wraps the list, to tell where it ends. */
    listRef,
    focus,
    onMenuOpenChange,
  };
}

/** Hands the menu's message to the cells below it. */
export function MessageMenuFocusProvider({
  value,
  children,
}: {
  value: MessageMenuFocus;
  children: ReactNode;
}) {
  return (
    <MessageMenuFocusContext.Provider value={value}>
      {children}
    </MessageMenuFocusContext.Provider>
  );
}

/**
 * The room the menu takes under the composer, grown and shrunk with the
 * sheet. Nothing while the menu is closed.
 */
export function MessageMenuRoom({
  room,
  shown,
}: {
  room: number;
  shown: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({ height: room * shown.get() }));
  return (
    <Animated.View
      testID="message-menu-room"
      style={style}
      pointerEvents="none"
    />
  );
}

/**
 * One message's cell in a thread list. While its menu is open it is drawn in
 * the chapter's quiet fill, the colour a reaction of yours uses, so the
 * member can see which message the menu acts on.
 */
export function MessageMenuCell({
  messageId,
  children,
}: {
  messageId: string;
  children: ReactNode;
}) {
  const { highlightedId, fill, onHighlighted } = useContext(
    MessageMenuFocusContext,
  );
  const highlighted = highlightedId === messageId;
  const ref = useRef<View>(null);
  useEffect(() => {
    if (highlighted && ref.current) onHighlighted(messageId, ref.current);
  }, [highlighted, messageId, onHighlighted]);
  return (
    <View
      ref={ref}
      testID={highlighted ? "message-menu-highlight" : undefined}
      style={highlighted ? { backgroundColor: fill } : undefined}
    >
      {children}
    </View>
  );
}
