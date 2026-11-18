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
import { Keyboard, Platform, View, useWindowDimensions } from "react-native";
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
 * quiet fill (`MessageMenuCell`) and, once the menu has settled, scrolled
 * into view above it if the room left it partly hidden. That is how
 * iMessage, WhatsApp and Telegram keep the message in view while its menu is
 * open.
 *
 * **Measured after it settles, not predicted.** The menu closes the keyboard
 * as it opens, and the keyboard gives back about the room the menu takes, so
 * where a message ends up depends on both animations. The check waits for
 * them (`SETTLE_MS`) and measures where the message is drawn then, with the
 * list already its shorter height, so a scroll to the list's top edge isn't
 * clamped to the taller list's range (Android clamps; iOS doesn't).
 */

/** Used when no keyboard has opened yet this run: about a phone keyboard. */
const FALLBACK_SHARE = 0.4;
/** Never taller than half the screen, whatever the keyboard reports. */
const MAX_SHARE = 0.5;
/**
 * A keyboard height shorter than this is a hardware keyboard's bar, not a
 * keyboard the menu could stand in for, so the fallback is used instead.
 */
const MIN_KEYBOARD = 200;
/** The sheet's open and close, so the room grows and shrinks with it. */
const ROOM_MS = 250;
/** When both the sheet and the closing keyboard have come to rest. */
export const SETTLE_MS = 400;

/**
 * The menu's one detent, in points: the keyboard's last height, no taller
 * than half the window, or 40% of it before a software keyboard has opened.
 */
export function messageMenuHeight(
  windowHeight: number,
  keyboardHeight: number | null,
): number {
  const wanted =
    keyboardHeight && keyboardHeight >= MIN_KEYBOARD
      ? keyboardHeight
      : windowHeight * FALLBACK_SHARE;
  return Math.round(Math.min(windowHeight * MAX_SHARE, wanted));
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

/**
 * The keyboard's height from the bottom of the screen, which is where the
 * sheet stands. React Native's Android event leaves out the navigation bar
 * under the keyboard (`ReactRootView.checkForKeyboardEvents` reports the IME
 * inset less the bars'), so the bottom inset is added back there; iOS reports
 * the whole height, home indicator included. Read from React Native's
 * source, not yet measured on a device.
 */
export function keyboardFromScreenBottom(
  reported: number,
  bottomInset: number,
  os: string = Platform.OS,
): number {
  return os === "android" ? reported + bottomInset : reported;
}

/** The menu's height, following the keyboard as it opens. */
export function useMessageMenuHeight(): number {
  const { height: windowHeight } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
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
  return messageMenuHeight(
    windowHeight,
    keyboardHeight === null
      ? null
      : keyboardFromScreenBottom(keyboardHeight, bottom),
  );
}

/** Where the menu's message is hidden, and so which way to bring it back. */
export interface MessageMenuReveal {
  /** Bring its top to the list's top, or its bottom to the room's top. */
  edge: "top" | "bottom";
  /**
   * The height of what the list draws under the message in the same cell (a
   * member's Ask answer, #4713), so a bottom reveal lines up the message, not
   * the answer below it.
   */
  below: number;
}

/** A cell's outer view (message and what's under it) and the message's own. */
interface MessageMenuCellViews {
  outer: View;
  message: View;
}

interface MessageMenuFocus {
  highlightedId: string | null;
  /** The chapter's quiet fill, read once for the list rather than per row. */
  fill?: string;
  /** The highlighted cell, drawn: kept to measure once the menu settles. */
  register: (messageId: string, cell: MessageMenuCellViews | null) => void;
}

const MessageMenuFocusContext = createContext<MessageMenuFocus>({
  highlightedId: null,
  register: () => {},
});

export type Frame = { top: number; height: number };

function measure(view: View): Promise<Frame | null> {
  return new Promise((resolve) => {
    if (typeof view.measureInWindow !== "function") {
      resolve(null);
      return;
    }
    view.measureInWindow((_x, top, _w, height) => resolve({ top, height }));
  });
}

/**
 * Which way, if any, the message has to move to be wholly in view: `list` is
 * the list's frame with the room already taken, `message` the message's own
 * frame and `cell` the whole cell's. A message taller than the list is
 * brought to its bottom edge, the end its menu opens from.
 */
export function revealFor(
  list: Frame,
  message: Frame,
  cell: Frame,
): MessageMenuReveal | null {
  const listBottom = list.top + list.height;
  const messageBottom = message.top + message.height;
  const below = Math.max(0, cell.top + cell.height - messageBottom);
  if (messageBottom > listBottom) return { edge: "bottom", below };
  if (message.top < list.top) {
    return message.height > list.height
      ? { edge: "bottom", below }
      : { edge: "top", below };
  }
  return null;
}

/**
 * The thread's side of the menu. `reveal` scrolls the list to bring the
 * message into view from the edge it is hidden past.
 */
export function useMessageMenuRoom(
  reveal: (messageId: string, how: MessageMenuReveal) => void,
) {
  const sheetHeight = useMessageMenuHeight();
  const { bottom } = useSafeAreaInsets();
  const { accentSubtle } = useChapterBranding();
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
  const cells = useRef(new Map<string, MessageMenuCellViews>());
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSettle = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
  }, []);
  useEffect(() => cancelSettle, [cancelSettle]);

  const checkInView = useCallback(async (messageId: string) => {
    const list = listRef.current;
    const cell = cells.current.get(messageId);
    if (!list || !cell) return;
    const [listFrame, messageFrame, cellFrame] = await Promise.all([
      measure(list),
      measure(cell.message),
      measure(cell.outer),
    ]);
    if (!listFrame || !messageFrame || !cellFrame) return;
    const how = revealFor(listFrame, messageFrame, cellFrame);
    if (how) revealRef.current(messageId, how);
  }, []);

  const onMenuOpenChange = useCallback(
    (messageId: string | null) => {
      cancelSettle();
      setHighlightedId(messageId);
      shown.set(withTiming(messageId ? 1 : 0, { duration: ROOM_MS }));
      if (!messageId) return;
      settle.current = setTimeout(() => {
        settle.current = null;
        void checkInView(messageId);
      }, SETTLE_MS);
    },
    [cancelSettle, checkInView, shown],
  );

  const register = useCallback(
    (messageId: string, views: MessageMenuCellViews | null) => {
      if (views) cells.current.set(messageId, views);
      else cells.current.delete(messageId);
    },
    [],
  );

  const focus = useMemo<MessageMenuFocus>(
    () => ({ highlightedId, fill: accentSubtle, register }),
    [highlightedId, accentSubtle, register],
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
 * One message's cell in a thread list. While its menu is open the message is
 * drawn in the chapter's quiet fill, the colour a reaction of yours uses, so
 * the member can see which message the menu acts on. `below` is what the
 * list draws under the message in the same cell (a member's Ask answer),
 * which stays unlit: the menu doesn't act on it.
 */
export function MessageMenuCell({
  messageId,
  below,
  children,
}: {
  messageId: string;
  below?: ReactNode;
  children: ReactNode;
}) {
  const { highlightedId, fill, register } = useContext(MessageMenuFocusContext);
  const highlighted = highlightedId === messageId;
  const outer = useRef<View>(null);
  const message = useRef<View>(null);
  useEffect(() => {
    if (!highlighted || !outer.current || !message.current) return;
    register(messageId, { outer: outer.current, message: message.current });
    return () => register(messageId, null);
  }, [highlighted, messageId, register]);
  return (
    <View ref={outer} collapsable={false}>
      <View
        ref={message}
        collapsable={false}
        testID={highlighted ? "message-menu-highlight" : undefined}
        style={highlighted ? { backgroundColor: fill } : undefined}
      >
        {children}
      </View>
      {below}
    </View>
  );
}
