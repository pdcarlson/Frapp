import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { isPushAvailable } from "@/lib/notifications/push";
import {
  answerPushAsk,
  declinePrimer,
  readDeclinedAt,
  readPrimerDecision,
  readReminderDone,
  recordReminderDone,
  shouldOfferPrimer,
  shouldOfferReminder,
  type PrimerDecision,
  type PushAskOutcome,
} from "@/lib/notifications/primer";
import {
  PUSH_PROMPT_ANSWERED_EVENT,
  pushPromptAnsweredProperties,
  type PushPromptSurface,
} from "@/lib/notifications/push-analytics";
import {
  pushTapAsks,
  readPushState,
  type PushState,
} from "@/lib/notifications/push-state";
import { useLatestTrack } from "@/lib/use-latest-track";

interface StoredAsk {
  decision: PrimerDecision;
  declinedAt: number | null;
  reminderDone: boolean;
}

/**
 * The stored answers and the phone's push state, read together. `stored` and
 * `push` stay `null` until read, so a host never flashes an ask that is about
 * to resolve to "already on". The push state is read again each time the app
 * returns to the foreground, because "Open Settings" leaves the app and the
 * member turns push on out there.
 */
function usePushAskState() {
  const [stored, setStored] = useState<StoredAsk | null>(null);
  const [push, setPush] = useState<PushState | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      readPrimerDecision(),
      readDeclinedAt(),
      readReminderDone(),
    ]).then(([decision, declinedAt, reminderDone]) => {
      if (live) setStored({ decision, declinedAt, reminderDone });
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const read = () => {
      // A failed read offers nothing, as an unknown permission does.
      void readPushState()
        .catch(() => null)
        .then((next) => {
          if (live) setPush(next);
        });
    };
    read();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") read();
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return { stored, setStored, push, setPush };
}

/** What a tap on the ask's main button will do, so its label can say so. */
export type PushAskAction = "ask" | "settings";

function actionFor(push: PushState | null): PushAskAction {
  return push && !pushTapAsks(push) ? "settings" : "ask";
}

function trackedAnswer(outcome: PushAskOutcome) {
  // "settings" opened the phone's settings; whether the member turned push on
  // there is read on return, not known here, so it is counted as neither.
  return outcome === "settings" ? null : outcome;
}

/**
 * Onboarding's notifications step: s03 for a member who joined, and chapter
 * setup for the officer who created the chapter (#3351). Both ask the same
 * way, so the decision, the push read and the two answers live here once.
 * "Turn on" is `answerPushAsk()` in `primer.ts`, which shows the OS prompt
 * through `acceptPrimer()` (also what s16 Settings' push switch calls), or
 * opens the phone's settings when no prompt can appear.
 *
 * `showPrimer` stays false until the stored decision and the push state have
 * both been read (`shouldOfferPrimer`). "Turn on" records the decision before
 * it asks, so a crash mid-prompt still counts as asked.
 */
export function usePushPrimer() {
  const { stored, setStored, push, setPush } = usePushAskState();
  const [isRequesting, setIsRequesting] = useState(false);
  // Read after the OS prompt closes, by which time the chapter's opt-out
  // answer may have replaced the `track` this tap started with.
  const track = useLatestTrack();

  const available = isPushAvailable();
  const showPrimer =
    stored !== null &&
    shouldOfferPrimer({
      isAvailable: available,
      push,
      decision: stored.decision,
    });

  /**
   * Resolves with what the answer did, and never rejects: a prompt the OS
   * failed to show counts as denied, and the decision stays recorded, so the
   * step isn't offered again.
   */
  const turnOn = useCallback(async (): Promise<PushAskOutcome> => {
    if (!push) return "denied";
    setIsRequesting(true);
    try {
      const outcome = await answerPushAsk(push, () =>
        setStored((s) => (s ? { ...s, decision: "accepted" } : s)),
      );
      const answer = trackedAnswer(outcome);
      if (answer) {
        track(
          PUSH_PROMPT_ANSWERED_EVENT,
          pushPromptAnsweredProperties(answer, "primer"),
        );
      }
      setPush(await readPushState().catch(() => null));
      return outcome;
    } finally {
      setIsRequesting(false);
    }
  }, [push, setPush, setStored, track]);

  const notNow = useCallback(async (): Promise<void> => {
    await declinePrimer();
    setStored((s) => (s ? { ...s, decision: "declined" } : s));
    track(
      PUSH_PROMPT_ANSWERED_EVENT,
      pushPromptAnsweredProperties("not_now", "primer"),
    );
  }, [setStored, track]);

  return {
    showPrimer,
    action: actionFor(push),
    isRequesting,
    turnOn,
    notNow,
  };
}

/**
 * The chat home's one reminder (`shouldOfferReminder`): a member whose push is
 * off and who said "Not now" a few days ago, or was never asked. Turning it on
 * or closing it answers it for good; Settings (s16) is the place after that.
 */
export function usePushReminder() {
  const { stored, setStored, push, setPush } = usePushAskState();
  // Read once, when the chat home mounts: whether three days have passed
  // doesn't need to change under a member who is looking at it.
  const [now] = useState(() => Date.now());
  const [isRequesting, setIsRequesting] = useState(false);
  const track = useLatestTrack();

  const show =
    stored !== null &&
    shouldOfferReminder({
      isAvailable: isPushAvailable(),
      push,
      decision: stored.decision,
      declinedAt: stored.declinedAt,
      reminderDone: stored.reminderDone,
      now,
    });

  const close = useCallback(
    (surface: PushPromptSurface | null) => {
      setStored((s) => (s ? { ...s, reminderDone: true } : s));
      void recordReminderDone();
      if (surface) {
        track(
          PUSH_PROMPT_ANSWERED_EVENT,
          pushPromptAnsweredProperties("not_now", surface),
        );
      }
    },
    [setStored, track],
  );

  const turnOn = useCallback(async (): Promise<void> => {
    if (!push) return;
    setIsRequesting(true);
    try {
      // Hidden the moment it is answered, before the OS dialog opens over it.
      const outcome = await answerPushAsk(push, () => close(null));
      const answer = trackedAnswer(outcome);
      if (answer) {
        track(
          PUSH_PROMPT_ANSWERED_EVENT,
          pushPromptAnsweredProperties(answer, "reminder"),
        );
      }
      setPush(await readPushState().catch(() => null));
    } finally {
      setIsRequesting(false);
    }
  }, [close, push, setPush, track]);

  return {
    show,
    action: actionFor(push),
    isRequesting,
    turnOn,
    dismiss: () => close("reminder"),
  };
}
