import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/**
 * The system's reduced-motion setting, as it is now. Reanimated's
 * `useReducedMotion` is the setting the app launched with and never changes,
 * so it only seeds the first frame here, before the system answers;
 * `AccessibilityInfo` reports the setting when the caller mounts, and its
 * `reduceMotionChanged` every change after.
 */
export function useReduceMotion(): boolean {
  const atLaunch = useReducedMotion();
  // Seeded with the launch value, so an answer that matches it re-renders
  // nothing.
  const [now, setNow] = useState(atLaunch);

  useEffect(() => {
    // A change heard before the first read answers is newer than that read.
    let heard = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        heard = true;
        setNow(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!heard) setNow(enabled);
    });
    return () => {
      heard = true;
      subscription.remove();
    };
  }, []);

  return now;
}
