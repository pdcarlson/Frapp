import { useEffect, useRef } from "react";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { shouldMeetFrappAi, useAiConsent, useCurrentUser } from "@repo/hooks";
import { MeetFrappAiSheet } from "@/components/ai/meet-frapp-ai";
import { isTourDue } from "@/lib/onboarding/tour";
import {
  releaseStartupSheet,
  requestStartupSheet,
} from "@/lib/startup-sheets";

/**
 * Meet Frapp AI, once, for an account that never answered it (#4790): a
 * member who joined before the screen was part of onboarding, or one whose
 * onboarding read of it never came back. Mounted in the tab layout beside
 * What's new, so it never runs during onboarding, which asks itself.
 *
 * It opens over the chat home a moment after launch, takes its turn with
 * What's new (`lib/startup-sheets.ts`), and sits out a launch the first-run
 * tour is due on. Continue and Not now are both answers, so neither brings
 * it back; swiping it away is not, and the next launch asks again.
 */

/** After What's new's own delay, so the launch jump has finished. */
export const MEET_FRAPP_AI_OPEN_DELAY_MS = 1_200;

const MEET_FRAPP_AI_SHEET = "meet-frapp-ai";

export function MeetFrappAiHost() {
  const sheet = useRef<BottomSheetModal>(null);
  const consent = useAiConsent();
  const userQuery = useCurrentUser();
  const userId = (userQuery.data as { id?: string } | undefined)?.id ?? null;
  const due = shouldMeetFrappAi(consent.data);
  // Once per process: the answer is the account's, and it is read here.
  const checked = useRef(false);

  useEffect(() => {
    if (!due || !userId || checked.current) return;
    checked.current = true;
    let live = true;
    let cancelTurn: (() => void) | undefined;
    const timer = setTimeout(() => {
      void isTourDue(userId).then((tourDue) => {
        if (!live || tourDue) return;
        cancelTurn = requestStartupSheet(MEET_FRAPP_AI_SHEET, () =>
          sheet.current?.present(),
        );
      });
    }, MEET_FRAPP_AI_OPEN_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      cancelTurn?.();
      checked.current = false;
    };
  }, [due, userId]);

  if (consent.data === null || consent.data === undefined) return null;
  return (
    <MeetFrappAiSheet
      ref={sheet}
      onClosed={() => releaseStartupSheet(MEET_FRAPP_AI_SHEET)}
    />
  );
}
