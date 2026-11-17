import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

/**
 * Whether a member has seen Ask's first-open starter on this phone (#4904;
 * Paul, 2026-11-17): the exchange "What can you do?" and Frapp's answer,
 * shown the first time Ask opens and never again, so nothing about how Ask
 * works is written at the top of every open. Kept per member on the phone,
 * like the Messages hint (`lib/chat/messages-hint.ts`), so a second account
 * on the same phone gets its own first open.
 *
 * It fails quiet. A phone that can't read the record, or can't write that the
 * starter was shown, never shows it: a starter that can't be remembered would
 * be at the top of every open, the very thing Paul asked to be rid of.
 */

const STORAGE_KEY_PREFIX = "frapp.mobile.ask-starter-seen:";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

/**
 * Decides whether this open shows the starter, and records that it did.
 * `true` only when the record says unseen and the write that marks it seen
 * went through.
 */
export async function claimAskStarter(
  userId: string,
  storage: Storage = AsyncStorage,
): Promise<boolean> {
  try {
    if ((await storage.getItem(STORAGE_KEY_PREFIX + userId)) !== null) {
      return false;
    }
    await storage.setItem(STORAGE_KEY_PREFIX + userId, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the opening drawn now carries the starter. Claimed once each time
 * Ask opens with an empty thread, and held for that open, so it doesn't
 * vanish under the member while they read it.
 */
export function useAskStarter({
  userId,
  open,
  empty,
}: {
  userId: string | null;
  open: boolean;
  empty: boolean;
}): boolean {
  // Each open is a new sitting: counted as it changes, during render (React's
  // "storing information from previous renders"), not in an effect.
  const [sitting, setSitting] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSitting((n) => n + 1);
  }
  const [claimedIn, setClaimedIn] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !userId || !empty) return;
    let live = true;
    void claimAskStarter(userId).then((claimed) => {
      if (live && claimed) setClaimedIn(sitting);
    });
    return () => {
      live = false;
    };
    // Claimed when Ask opens, not again when the first turn empties it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, sitting]);
  return open && claimedIn === sitting;
}
