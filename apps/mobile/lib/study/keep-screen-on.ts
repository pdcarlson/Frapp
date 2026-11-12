import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

/**
 * "Keep screen on" for s10 (Paul, 2026-11-12: "a way to force the phone screen
 * to stay on").
 *
 * A locked phone backgrounds Frapp, and a backgrounded session pauses and then
 * closes once its grace window runs out (`spec/behavior/study-sessions.md`).
 * A member who props the phone up on the desk while they study would lose the
 * session to the auto-lock. With this on, the screen stays awake while a
 * session runs on screen, the way a timer or a navigation app holds it; it
 * lets go when the session ends or the member leaves the screen, and the
 * system's own lock comes back.
 *
 * The choice is remembered on this phone, off until the member turns it on:
 * a lit screen costs battery, so it is theirs to ask for.
 */

const STORAGE_KEY = "study:keepScreenOn";
const TAG = "study-session";

/** The remembered choice and its setter. */
export function useKeepScreenOnPreference(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!cancelled && raw === "1") setOn(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const set = useCallback((next: boolean) => {
    setOn(next);
    AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0").catch(() => {
      /* Best effort: the choice holds until the app restarts. */
    });
  }, []);
  return [on, set];
}

/** Hold the screen awake while `active`. Silent where the module is missing. */
export function useKeepScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    try {
      void activateKeepAwakeAsync(TAG).catch(() => undefined);
    } catch {
      return undefined;
    }
    return () => {
      try {
        void Promise.resolve(deactivateKeepAwake(TAG)).catch(() => undefined);
      } catch {
        // Nothing was held.
      }
    };
  }, [active]);
}
