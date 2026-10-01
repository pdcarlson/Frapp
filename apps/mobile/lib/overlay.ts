import { useEffect, type RefObject } from "react";
import { AccessibilityInfo, BackHandler } from "react-native";

/**
 * The two effects an in-tree overlay needs while it is up
 * (`spec/ui/mobile/patterns.md` § Overlays): Android's back button closes it,
 * and a screen reader's focus moves onto it. Every overlay takes them from
 * here, so a change to either (#2641 will change the focus half) reaches all
 * of them at once rather than one copy.
 */

type FocusTarget = Parameters<
  typeof AccessibilityInfo.sendAccessibilityEvent
>[0];

/**
 * While `open`, Android's back button calls `close` and goes no further. The
 * overlay takes every tap on the screen, so a back press that popped the
 * navigator underneath would leave the member somewhere they can't see. Nothing
 * is held while it is closed.
 */
export function useBackToClose(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        close();
        return true;
      },
    );
    return () => subscription.remove();
  }, [open, close]);
}

/**
 * When `open` turns true, moves a screen reader's focus onto `ref`. Opening an
 * overlay hides the control that had focus, which clears that focus rather
 * than moving it.
 *
 * Sent from the next task, not from the effect: on Android the effect runs
 * before the commit's views are mounted, and a focus event for a view that
 * isn't there yet is dropped (#2641 tracks confirming it on a device). An
 * overlay that closes before that task runs sends nothing.
 */
export function useFocusOnOpen(
  ref: RefObject<FocusTarget | null>,
  open = true,
): void {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (ref.current) {
        AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, ref]);
}
