import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { isPushAvailable } from "@/lib/notifications/push";
import {
  answerPushAsk,
  declinePrimer,
  readDeclinedAt,
  onStoredAnswerChange,
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
  pushIsOn,
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
 * The stored answers, the phone's push state and the time, read together.
 * `stored` and `push` stay `null` until read, so a host never flashes an ask
 * that is about to resolve to "already on". All three are read again each
 * time the app returns to the foreground (the member may have turned push on
 * in the phone's settings, or been away for days), and the stored answers
 * again whenever any surface records one (`onStoredAnswerChange`), since a
 * tab screen stays mounted while the member answers in Settings.
 */
function usePushAskState() {
  const [stored, setStored] = useState<StoredAsk | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  // Whether the first push read has come back, failed or not: `push` stays
  // `null` on a failure, so it can't say this itself.
  const [pushRead, setPushRead] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const readStored = () => {
      void Promise.all([
        readPrimerDecision(),
        readDeclinedAt(),
        readReminderDone(),
      ]).then(([decision, declinedAt, reminderDone]) => {
        if (live) setStored({ decision, declinedAt, reminderDone });
      });
    };
    const readPush = () => {
      // A failed read offers nothing, as an unknown permission does.
      void readPushState()
        .catch(() => null)
        .then((next) => {
          if (!live) return;
          setPush(next);
          setPushRead(true);
        });
    };
    readStored();
    readPush();
    const offStored = onStoredAnswerChange(readStored);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      setNow(Date.now());
      readStored();
      readPush();
    });
    return () => {
      live = false;
      offStored();
      subscription.remove();
    };
  }, []);

  return { stored, setStored, push, setPush, pushRead, now };
}

/** What a tap on the ask's main button will do, so its label can say so. */
export type PushAskAction = "ask" | "settings";

function actionFor(push: PushState | null): PushAskAction {
  return push && !pushIsOn(push) && !pushTapAsks(push) ? "settings" : "ask";
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
  const { stored, push, setPush, pushRead } = usePushAskState();
  const [isRequesting, setIsRequesting] = useState(false);
  // One answer per step: a second tap (or Not now, then Turn on) while the
  // first is still being stored would send a second event and could show the
  // OS dialog after the member said Not now.
  const answering = useRef(false);
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
   * step isn't offered again. `null` for a tap while another answer runs.
   */
  const turnOn = useCallback(async (): Promise<PushAskOutcome | null> => {
    if (answering.current) return null;
    answering.current = true;
    setIsRequesting(true);
    try {
      // A failed store still moves the step on (`answerPushAsk` itself never
      // fails on the OS side): the member is held by nothing they can fix.
      // It isn't tracked, since nothing is known about what was answered.
      const outcome = await answerPushAsk().catch(() => null);
      if (outcome === null) return "denied";
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
  }, [setPush, track]);

  /** `false` for a tap while another answer runs. */
  const notNow = useCallback(async (): Promise<boolean> => {
    if (answering.current) return false;
    answering.current = true;
    setIsRequesting(true);
    try {
      // A failed store still moves the step on; the reminder may ask again.
      await declinePrimer().catch(() => undefined);
      track(
        PUSH_PROMPT_ANSWERED_EVENT,
        pushPromptAnsweredProperties("not_now", "primer"),
      );
      return true;
    } finally {
      setIsRequesting(false);
    }
  }, [track]);

  return {
    showPrimer,
    /** Both reads are back, so `showPrimer` is the answer, not a first frame. */
    ready: stored !== null && pushRead,
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
  const { stored, setStored, push, setPush, now } = usePushAskState();
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
    if (isRequesting) return;
    setIsRequesting(true);
    try {
      // Hidden the moment it is answered, before the OS dialog opens over it.
      const outcome = await answerPushAsk(() => close(null)).catch(() => null);
      const answer = outcome && trackedAnswer(outcome);
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
  }, [close, isRequesting, setPush, track]);

  return {
    show,
    action: actionFor(push),
    isRequesting,
    turnOn,
    dismiss: () => close("reminder"),
  };
}
