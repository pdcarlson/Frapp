import { errorCopy } from "@repo/hooks/error-copy";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useConnection } from "@/lib/connection/use-connection";

/** A refused write's line on a card. */
export interface CardRefusal {
  text: string;
  /** A gate's: the controls stay withdrawn rather than invite a retry. */
  gate: boolean;
}

/**
 * The writes on a mobile chat card and what a refused one does, shared by the
 * task and rush cards (#3185, #3383) so the two can't drift apart.
 *
 * Mobile has no toast, so a refusal is a line on the card. A gate's refusal,
 * which the card's `gateRefusal` puts in a member's words, withdraws the
 * controls: pressing again would only fetch the same refusal. It lasts until
 * the member comes back, since an officer may have sorted the gate out since
 * and nothing on a withdrawn card can be pressed to find out. Back to the
 * thread is a navigation focus; back to the app with the thread still open is
 * an AppState change, which focus never sees. The AppState listener is held
 * only while there is a refusal to clear, so a thread of cards doesn't
 * register one each. Any other refusal relays the server's message, or the
 * write's fallback, and leaves the controls for a retry.
 *
 * No card write has an outbox, so the controls are also disabled while a
 * write would be lost (`useConnection().writeBlockedReason`, which is then
 * their accessibility hint), while the message is not yet server-acked, and
 * while one of the card's writes is pending.
 */
export function useCardWrite(input: {
  /** The card's gate reader: a member-worded refusal, or `null` for any other failure. */
  gateRefusal: (error: unknown) => string | null;
  /** False while the optimistic chat row is not yet server-acked. */
  isConfirmed: boolean;
  /** Whether any of the card's write hooks is pending. */
  pending: boolean;
}): {
  refusal: CardRefusal | null;
  /** Runs one write; a refusal lands on the card. */
  act: (write: () => Promise<unknown>, fallback: string) => Promise<void>;
  /**
   * For a write made outside `act`, such as from a sheet that says its own
   * failures: a gate refusal still lands on the card and withdraws its
   * controls. Any other failure is left to the caller.
   */
  latchGate: (error: unknown) => void;
  disabled: boolean;
  hint: string | undefined;
} {
  const { gateRefusal, isConfirmed, pending } = input;
  const { writeBlockedReason } = useConnection();
  const [refusal, setRefusal] = useState<CardRefusal | null>(null);
  useFocusEffect(
    useCallback(() => {
      setRefusal(null);
      return undefined;
    }, []),
  );
  const hasRefusal = refusal !== null;
  useEffect(() => {
    if (!hasRefusal) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setRefusal(null);
    });
    return () => subscription.remove();
  }, [hasRefusal]);
  // The hooks' `isPending` reaches React a tick after the press, so two taps
  // in one frame would both send; the ref is set before the first await.
  const inFlight = useRef(false);

  const act = async (write: () => Promise<unknown>, fallback: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefusal(null);
    try {
      await write();
    } catch (error) {
      const gate = gateRefusal(error);
      setRefusal(
        gate
          ? { text: gate, gate: true }
          : { text: errorCopy(error, fallback), gate: false },
      );
    } finally {
      inFlight.current = false;
    }
  };

  const latchGate = (error: unknown) => {
    const gate = gateRefusal(error);
    if (gate) setRefusal({ text: gate, gate: true });
  };

  const blockedReason =
    writeBlockedReason ?? (refusal?.gate ? refusal.text : null);
  return {
    refusal,
    act,
    latchGate,
    disabled: !isConfirmed || pending || blockedReason !== null,
    hint: blockedReason ?? undefined,
  };
}
