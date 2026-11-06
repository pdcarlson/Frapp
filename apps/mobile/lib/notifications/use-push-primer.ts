import { useCallback, useContext, useEffect, useState } from "react";
import { AnalyticsContext } from "@/lib/analytics-provider";
import { getPushPermission, isPushAvailable } from "@/lib/notifications/push";
import {
  acceptPrimer,
  readPrimerDecision,
  recordPrimerDecision,
  shouldOfferPrimer,
  type PrimerDecision,
} from "@/lib/notifications/primer";
import {
  PUSH_PROMPT_ANSWERED_EVENT,
  pushPromptAnsweredProperties,
} from "@/lib/notifications/push-analytics";

/**
 * The C7 push primer's state for a screen that hosts the card: s03 for a
 * member who joined, and chapter setup for the officer who created the
 * chapter (#3351). Both ask the same way, so the decision, the permission read
 * and the two answers live here once. "Turn on" itself is `acceptPrimer()` in
 * `primer.ts`, which s16 Settings' push switch also calls, so a tap there
 * accepts exactly as the card does.
 *
 * `showPrimer` stays false until the stored decision and the permission have
 * both been read, so the card never flashes in and out (`shouldOfferPrimer`).
 * "Turn on" records the decision before it asks, so a crash mid-prompt still
 * counts as asked.
 */
export function usePushPrimer() {
  const [decision, setDecision] = useState<PrimerDecision>("unasked");
  const [decisionRead, setDecisionRead] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [isRequesting, setIsRequesting] = useState(false);
  const track = useContext(AnalyticsContext);

  useEffect(() => {
    let live = true;
    void readPrimerDecision().then((value) => {
      if (!live) return;
      setDecision(value);
      setDecisionRead(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    // A failed read offers no card, as an unknown permission does.
    void getPushPermission()
      .catch(() => null)
      .then((result) => {
        if (live) setPermissionGranted(result ? result.granted : null);
      });
    return () => {
      live = false;
    };
  }, []);

  const available = isPushAvailable();
  const showPrimer =
    decisionRead &&
    shouldOfferPrimer({ isAvailable: available, permissionGranted, decision });

  /**
   * Resolves with whether the member allowed notifications, and never
   * rejects: a prompt the OS failed to show counts as not allowed, and the
   * decision stays recorded, so the card isn't offered again.
   */
  const turnOn = useCallback(async (): Promise<boolean> => {
    setIsRequesting(true);
    try {
      const granted = await acceptPrimer(() => setDecision("accepted"));
      setPermissionGranted(granted);
      track?.(
        PUSH_PROMPT_ANSWERED_EVENT,
        pushPromptAnsweredProperties(granted ? "allowed" : "denied", "primer"),
      );
      return granted;
    } catch {
      return false;
    } finally {
      setIsRequesting(false);
    }
  }, [track]);

  const notNow = useCallback(async (): Promise<void> => {
    await recordPrimerDecision("declined");
    setDecision("declined");
    track?.(
      PUSH_PROMPT_ANSWERED_EVENT,
      pushPromptAnsweredProperties("not_now", "primer"),
    );
  }, [track]);

  return { showPrimer, isRequesting, turnOn, notNow };
}
