import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo, BackHandler, Platform } from "react-native";

/**
 * The two effects an in-tree overlay needs while it is up
 * (`spec/ui/mobile/patterns.md` § Overlays): Android's back button closes it,
 * and a screen reader's focus moves onto it (and, for the glass menu, back to
 * the control that opened it on close). Every overlay that can close
 * takes them from here, so a change to either (#2641 will change the focus
 * half) reaches all of them at once rather than one copy. The update gate
 * (`components/client-policy-gate.tsx`) is the exception: it can't close, so
 * it holds back and announces with effects of its own.
 */

export type FocusTarget = Parameters<
  typeof AccessibilityInfo.sendAccessibilityEvent
>[0];

/** How many overlays in the overlay layer hold back right now. */
let layerOverlaysUp = 0;

/**
 * While `open`, Android's back button calls `close` and goes no further. The
 * overlay takes every tap on the screen, so a back press that popped the
 * navigator underneath would leave the member somewhere they can't see. Nothing
 * is held while it is closed. Nothing is held on web either, where there is
 * no hardware back and react-native-web's `BackHandler` only logs an error:
 * every sheet holds this now, so the Expo web build would log one per sheet.
 */
export function useBackToClose(
  open: boolean,
  close: () => void,
  /**
   * `"layer"` for an overlay drawn in the app's overlay layer
   * (`components/overlay-layer.tsx`), which is over every screen and sheet.
   */
  where: "tree" | "layer" = "tree",
): void {
  useEffect(() => {
    if (!open || Platform.OS === "web") return;
    const inLayer = where === "layer";
    if (inLayer) layerOverlaysUp += 1;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        // `BackHandler` asks the newest listener first, so a sheet presented
        // under an open layer overlay (a startup sheet's turn coming up)
        // would otherwise close behind its scrim. It passes the press on.
        if (!inLayer && layerOverlaysUp > 0) return false;
        close();
        return true;
      },
    );
    return () => {
      subscription.remove();
      if (inLayer) layerOverlaysUp -= 1;
    };
  }, [open, close, where]);
}

/** What an overlay hands focus back to: the control's view, or its tag. */
export type FocusReturn = FocusTarget | number;

/**
 * The control a press or an accessibility action landed on, from the event's
 * `currentTarget`, or `null` when it names none.
 */
export function focusReturnOf(
  event: { currentTarget?: unknown } | null | undefined,
): FocusReturn | null {
  const target = event?.currentTarget;
  if (typeof target === "number") return target;
  if (target && typeof target === "object") return target as FocusTarget;
  return null;
}

/**
 * When `open` turns false, moves a screen reader's focus back to the control
 * that opened the overlay (`target`, as it was while open), as a dismissed
 * `Modal` did. Hiding that control cleared its focus rather than keeping it,
 * so without this focus drops to the top of the screen. Sent from the next
 * task, as {@link useFocusOnOpen} is, once the overlay has gone.
 */
export function useReturnFocusOnClose(
  target: FocusReturn | null | undefined,
  open: boolean,
): void {
  const held = useRef<FocusReturn | null>(null);
  useEffect(() => {
    if (open) {
      if (target != null) held.current = target;
      return;
    }
    const to = held.current;
    held.current = null;
    if (to == null) return;
    const timer = setTimeout(() => sendFocus(to), 0);
    return () => clearTimeout(timer);
  }, [open, target]);
}

function sendFocus(to: FocusReturn): void {
  if (typeof to === "number") {
    if (typeof AccessibilityInfo.setAccessibilityFocus === "function") {
      AccessibilityInfo.setAccessibilityFocus(to);
    }
  } else if (typeof AccessibilityInfo.sendAccessibilityEvent === "function") {
    AccessibilityInfo.sendAccessibilityEvent(to, "focus");
  }
}

/**
 * When `open` turns true, moves a screen reader's focus onto `ref`. `open` is
 * required: an overlay that stays mounted while closed and passed nothing would
 * focus once at mount, while its ref is still empty, and never on an open. Opening an
 * overlay hides the control that had focus, which clears that focus rather
 * than moving it.
 *
 * Sent from the next task, not from the effect: on Android the effect runs
 * before the commit's views are mounted, and a focus event for a view that
 * isn't there yet is dropped (#2641 tracks confirming it on a device). An
 * overlay that closes before that task runs sends nothing.
 *
 * Nothing is sent where `sendAccessibilityEvent` doesn't exist:
 * react-native-web leaves it out, so on the Expo web build calling it threw
 * and covered every overlay with the error screen (#3916). A feature check
 * rather than `Platform.OS`, so any other platform without it is safe too.
 */
export function useFocusOnOpen(
  ref: RefObject<FocusTarget | null>,
  open: boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (
        ref.current &&
        typeof AccessibilityInfo.sendAccessibilityEvent === "function"
      ) {
        AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, ref]);
}
