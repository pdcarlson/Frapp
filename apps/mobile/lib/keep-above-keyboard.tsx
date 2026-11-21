import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { Keyboard, type ScrollView, type View } from "react-native";

/**
 * Keeps a field typed in a long screen's body above the keyboard: while it
 * has focus, its part of the page is scrolled into the band between the
 * pinned back row and the keyboard's top: when the keyboard opens (and once
 * more as it settles), when that part moves within its own section, and on
 * each keystroke. Event details' agenda is the case it was built for: each
 * item added from the field under the list pushes the field down a row, and
 * the newest item and the field went under the keyboard (#5463,
 * `spec/behavior/events.md` § Agenda and attachments). Apple's Reminders and
 * Notes apps keep the line being typed above the keyboard the same way.
 *
 * The screen owns the scroll view, so it makes the reveal
 * (`useScrollReveal`) and provides it around its `ScreenShell` (a provider
 * inside the shell would wrap the whole body into one child and lose the
 * shell's gap). The field's component takes `useKeepAboveKeyboard` and puts
 * its `hold` (a callback ref) and `onLayout` on the view that holds the
 * field, and `onFocus`, `onBlur` and `onType` on the field. The screen passes
 * `avoidKeyboard` to the shell too, so the scroll view ends at the keyboard
 * and a field near the end of the page has room to scroll up.
 *
 * Nothing is moved while the keyboard is down, so a layout change elsewhere
 * on the page never scrolls it.
 *
 * Why not `react-native-keyboard-controller`'s `KeyboardAwareScrollView`,
 * which does the same on the UI thread: the scroll view belongs to
 * `ScreenShell`, one of the eight frozen files
 * (`.claude/skills/ui-development/SKILL.md`), and that library is switched
 * off in Expo Go (`lib/keyboard.tsx`), where every field would lose the
 * reveal. This works on every run path through the shell's own `scrollRef`.
 */

/**
 * How long after `keyboardDidShow` the reveal runs again: past the keyboard's
 * own animation (about 250ms on both platforms), which the avoiding area
 * follows. Derived from the libraries' source, not measured on a device.
 */
const KEYBOARD_SETTLE_MS = 350;

/** Scrolls the screen's body so `target` sits in its visible band. */
export type ScrollReveal = (target: View) => void;

const ScrollRevealContext = createContext<ScrollReveal | null>(null);

/** Provided around a screen's `ScreenShell`, with `useScrollReveal`'s value. */
export const ScrollRevealProvider = ScrollRevealContext.Provider;

type Band = {
  /** The scroll view's current offset. */
  offset: number;
  /** The target's top and bottom, in window coordinates. */
  targetTop: number;
  targetBottom: number;
  /** The part of the scroll view nothing covers, in window coordinates. */
  visibleTop: number;
  visibleBottom: number;
  /** Room kept between the target and either edge of the band. */
  margin: number;
};

/**
 * The offset that brings the target into the band with the least movement,
 * or `null` when it is already there. A target taller than the band shows its
 * top, where its field is.
 */
export function revealScrollY({
  offset,
  targetTop,
  targetBottom,
  visibleTop,
  visibleBottom,
  margin,
}: Band): number | null {
  const room = visibleBottom - visibleTop - 2 * margin;
  let delta = 0;
  if (targetBottom - targetTop > room) {
    delta = targetTop - margin - visibleTop;
  } else if (targetBottom + margin > visibleBottom) {
    delta = targetBottom + margin - visibleBottom;
  } else if (targetTop - margin < visibleTop) {
    delta = targetTop - margin - visibleTop;
  }
  // Under a point is rounding, not a move.
  if (Math.abs(delta) < 1) return null;
  return Math.max(0, offset + delta);
}

type Box = { y: number; height: number };

function measure(view: Pick<View, "measureInWindow">): Promise<Box> {
  return new Promise((resolve) =>
    view.measureInWindow((_x, y, _width, height) => resolve({ y, height })),
  );
}

/**
 * `getInnerViewRef` is on React Native's `ScrollView` (0.86,
 * `ScrollView.js`'s imperative methods) but missing from its TypeScript
 * declarations, which carry only the older `getInnerViewNode` (a node handle).
 */
type ScrollWithContent = ScrollView & {
  getInnerViewRef: () => Pick<View, "measureInWindow"> | null;
};

/**
 * The screen's reveal, over the `ScrollView` it hands `ScreenShell` as
 * `scrollRef`. Everything is measured in the window, through host views (a
 * node handle is refused under the New Architecture): the scroll view's
 * frame, its content view, whose distance above the frame is the current
 * offset, and the target. The band runs from `top` below the frame's top
 * (the pinned back row floats over it) to the frame's bottom or the
 * keyboard's top, whichever is higher, so it holds before the screen's
 * avoiding area has finished rising.
 */
export function useScrollReveal(
  scrollRef: RefObject<ScrollView | null>,
  { top, margin }: { top: number; margin: number },
): ScrollReveal {
  return useCallback(
    (target: View) => {
      const scroll = scrollRef.current as ScrollWithContent | null;
      const frame = scroll?.getNativeScrollRef();
      const content = scroll?.getInnerViewRef();
      if (!scroll || !frame || !content) return;
      void Promise.all([measure(frame), measure(content), measure(target)])
        .then(([framed, contained, aimed]) => {
          const keyboardTop = Keyboard.isVisible()
            ? Keyboard.metrics()?.screenY
            : undefined;
          const y = revealScrollY({
            offset: framed.y - contained.y,
            targetTop: aimed.y,
            targetBottom: aimed.y + aimed.height,
            visibleTop: framed.y + top,
            visibleBottom: Math.min(
              framed.y + framed.height,
              keyboardTop ?? Number.POSITIVE_INFINITY,
            ),
            margin,
          });
          if (y !== null) scrollRef.current?.scrollTo({ y, animated: true });
        })
        // A view gone mid-measure (the field submitted its last item) has
        // nothing left to show.
        .catch(() => undefined);
    },
    [scrollRef, top, margin],
  );
}

/**
 * A field's side: `hold` (a callback ref) and `onLayout` go on the view that
 * holds the field (with anything that should show with it, such as its error
 * line), and `onFocus`, `onBlur` and `onType` (from its `onChangeText`) on the
 * field, or on each field of a small form that shares the view. Outside a `ScrollRevealProvider` it does
 * nothing. Take `hold` apart from the rest (`const { hold, ...keep } =`):
 * React's lint treats whatever is passed as a `ref` as a ref, and reading the
 * other handlers off the same object during render would then count as
 * reading a ref.
 */
export function useKeepAboveKeyboard() {
  const reveal = useContext(ScrollRevealContext);
  const held = useRef<View | null>(null);
  const focused = useRef(false);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(() => {
    if (!reveal || !focused.current || !held.current) return;
    if (!Keyboard.isVisible()) return;
    reveal(held.current);
  }, [reveal]);
  useEffect(() => {
    if (!reveal) return undefined;
    // After the keyboard has opened (or changed size): Android sends no
    // "will" events. Once more when the screen's avoiding area has surely
    // risen, since on Android the event can come while its padding is still
    // growing and the scroll range can't reach the field yet. A reveal that
    // finds the field in view moves nothing.
    const opened = Keyboard.addListener("keyboardDidShow", () => {
      show();
      if (settling.current) clearTimeout(settling.current);
      settling.current = setTimeout(show, KEYBOARD_SETTLE_MS);
    });
    return () => {
      opened.remove();
      if (settling.current) clearTimeout(settling.current);
    };
  }, [reveal, show]);
  const onFocus = useCallback(() => {
    focused.current = true;
    // Moving from one field to another: the keyboard is already up.
    show();
  }, [show]);
  const onBlur = useCallback(() => {
    focused.current = false;
  }, []);
  const hold = useCallback((view: View | null) => {
    held.current = view;
    // A field that unmounts while focused (the agenda filling on Return)
    // sends no blur, so its view going away ends its focus.
    if (!view) focused.current = false;
  }, []);
  // `onType` on each keystroke: a section above that grew (the check-in
  // card opening on the clock) moves the field without its own layout
  // changing, and the next keystroke brings it back.
  return { hold, onLayout: show, onType: show, onFocus, onBlur };
}
