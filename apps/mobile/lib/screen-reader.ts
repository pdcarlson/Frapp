import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Whether VoiceOver or TalkBack is on, followed live. `true` while the first
 * read is out and when it fails, so a control that hides itself under a
 * screen reader errs toward staying put. Web has no screen reader API: false.
 */
export function useScreenReaderOn(): boolean {
  const [on, setOn] = useState(Platform.OS !== "web");
  useEffect(() => {
    if (Platform.OS === "web") return;
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled().then(
      (enabled) => live && setOn(enabled),
      () => live && setOn(true),
    );
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      (enabled: boolean) => setOn(enabled),
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return on;
}
