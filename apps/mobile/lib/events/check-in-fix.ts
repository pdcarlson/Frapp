import { useCallback, useEffect, useRef } from "react";
import {
  readForegroundFix,
  readForegroundPermission,
  type LocationFix,
} from "@/lib/location";

/**
 * The member's position for s18, ready before they check in (#4532).
 *
 * A GPS fix indoors can take tens of seconds, and a scanned code expires in 90
 * to 120. So s18 starts a fix as soon as it is on screen, when location is
 * already allowed (it never prompts here: the prompt belongs to the check-in
 * that needs it, `check-in-location.ts`), and the check-in uses that fix when
 * it is fresh. A typed code finds the fix ready while the member types.
 */

/** A warm fix older than this is read again at the scan. */
export const WARM_FIX_MAX_AGE_MS = 60_000;

/**
 * While `active`, keep a fresh GPS fix: one when the scanner opens, and
 * again when it goes stale. Returns a reader for the latest fresh one, or
 * `null` when there is none yet.
 */
export function useWarmCheckInFix(active: boolean): () => LocationFix | null {
  const warmRef = useRef<{ fix: LocationFix; at: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const warm = async () => {
      try {
        const permission = await readForegroundPermission();
        if (cancelled || !permission.granted) return;
        const fix = await readForegroundFix("high", WARM_FIX_MAX_AGE_MS);
        if (cancelled) return;
        warmRef.current = { fix, at: Date.now() };
        timer = setTimeout(() => void warm(), WARM_FIX_MAX_AGE_MS / 2);
      } catch {
        // No fix: the scan asks for its own.
      }
    };
    void warm();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active]);

  return useCallback(() => {
    const warm = warmRef.current;
    return warm && Date.now() - warm.at < WARM_FIX_MAX_AGE_MS ? warm.fix : null;
  }, []);
}
