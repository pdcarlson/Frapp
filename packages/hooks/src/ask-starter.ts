import { useCallback, useEffect, useRef, useState } from "react";
import { askStarterDue, type AskStarterSeen } from "@repo/validation";

/**
 * Where a device keeps what it remembers of Ask's first-open starter, per
 * member: AsyncStorage on the phone, localStorage on web. `read` answers
 * `null` for no record and `undefined` for one it could not read; `write`
 * answers whether it kept the record. Neither may throw.
 */
export type AskStarterStore = {
  read: (userId: string) => Promise<AskStarterSeen | null | undefined>;
  write: (userId: string, seen: AskStarterSeen) => Promise<boolean>;
};

/**
 * What Ask's opening draws this open: `deciding` while the device's record
 * is read (draw nothing, so the greeting never flashes before the starter),
 * then `starter` or `greeting`.
 */
export type AskOpeningMode = "deciding" | "starter" | "greeting";

/**
 * Whether Ask opens on the first-open starter, the "What can you do?"
 * exchange (#4904; `spec/behavior/ai.md` § What Ask opens with). One rule
 * for both clients:
 *
 * - The record is read once each time Ask opens.
 * - It is written only once the starter has been drawn (`starterShown`, from
 *   the opening's effect), so an open that never draws it (a question sent
 *   as Ask opens, a sheet closed before the read came back) leaves it due.
 * - Once the thread has had a turn in this open, the opening is the greeting
 *   for the rest of the open, so New conversation doesn't bring the starter
 *   back.
 * - Seen without the line about asking Frapp to do things, it is due again
 *   once Frapp can act for the member (`askStarterDue`).
 * - A record that can't be read never shows it; one that can't be written is
 *   remembered for as long as this hook is mounted.
 */
export function useAskStarter({
  userId,
  open,
  empty,
  canAct,
  store,
}: {
  userId: string | null;
  open: boolean;
  /** The thread has no turns. */
  empty: boolean;
  /** Frapp can take at least one action for this member. */
  canAct: boolean;
  store: AskStarterStore;
}): { mode: AskOpeningMode; starterShown: () => void } {
  // Each open is a new sitting, counted as it changes during render (React's
  // "storing information from previous renders"), not in an effect.
  const [sitting, setSitting] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSitting((n) => n + 1);
  }
  const [turnIn, setTurnIn] = useState<number | null>(null);
  if (open && !empty && turnIn !== sitting) setTurnIn(sitting);

  const [read, setRead] = useState<{
    sitting: number;
    seen: AskStarterSeen | null | undefined;
  } | null>(null);
  // What this mount wrote, for a device that can't keep the record.
  const kept = useRef<AskStarterSeen | null>(null);
  const [shownIn, setShownIn] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let live = true;
    void store.read(userId).then((seen) => {
      if (live) setRead({ sitting, seen: seen === null ? kept.current : seen });
    });
    return () => {
      live = false;
    };
    // Read when Ask opens; the store is the caller's constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, sitting]);

  let mode: AskOpeningMode;
  if (!open || !userId || turnIn === sitting) mode = "greeting";
  else if (read?.sitting !== sitting) mode = "deciding";
  else if (shownIn === sitting || askStarterDue(read.seen, canAct))
    mode = "starter";
  else mode = "greeting";

  const level: AskStarterSeen = canAct ? "act" : "ask";
  const starterShown = useCallback(() => {
    if (!userId || kept.current === "act" || kept.current === level) {
      setShownIn(sitting);
      return;
    }
    kept.current = level;
    setShownIn(sitting);
    void store.write(userId, level);
  }, [userId, level, sitting, store]);

  return { mode, starterShown };
}
