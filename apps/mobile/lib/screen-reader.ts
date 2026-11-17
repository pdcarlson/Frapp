import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Whether VoiceOver or TalkBack is on now. A read that fails counts as on, so
 * whatever steps aside for a screen reader errs toward stepping aside. Web
 * says no: react-native-web answers true in every browser, which would make
 * every web build look screen-read.
 */
export async function readScreenReaderOn(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return await AccessibilityInfo.isScreenReaderEnabled();
  } catch {
    return true;
  }
}

/**
 * {@link readScreenReaderOn}, followed live. On until the first read
 * answers, so the tab bar's fold (#4904) never hides labelled tabs from a
 * screen reader in the moment before it knows; a change heard before that
 * read answers is newer than it, as `use-reduce-motion.ts` does it.
 */
export function useScreenReaderOn(): boolean {
  const [on, setOn] = useState(Platform.OS !== "web");
  useEffect(() => {
    if (Platform.OS === "web") return;
    let heard = false;
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      (enabled: boolean) => {
        heard = true;
        setOn(enabled);
      },
    );
    void readScreenReaderOn().then((enabled) => {
      if (!heard) setOn(enabled);
    });
    return () => {
      heard = true;
      subscription.remove();
    };
  }, []);
  return on;
}
