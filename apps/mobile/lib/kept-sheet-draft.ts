import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dropKeptDraft,
  hasKeptDraft,
  keepEditsOver,
  readKeptDraft,
  readKeptSend,
  useKeptDraftKeys,
  useKeptFormDraft,
  writeKeptDraft,
} from "@repo/hooks/kept-drafts";

/**
 * A form sheet's draft, kept past its screen (#4593: "keep the draft").
 *
 * A sheet already keeps its draft across a close while it stays mounted on
 * its host. A sheet hosted by a pushed screen goes when the member goes back,
 * and took the draft with it. This keeps it in the shared store
 * (`@repo/hooks/kept-drafts`, the one web's docked forms use), by member,
 * chapter and form, so the sheet opens on it next time. Which sheets keep
 * one, and when each gives it up, is `spec/ui/mobile/patterns.md` § Bottom
 * sheets ("A draft outlives a close"); an edit names its record
 * (`event-edit:<id>`, #4872) and is laid over the record as it is now with
 * `keepEditsOver`.
 *
 * `name` is `null` for a sheet that keeps nothing past its host (the + quick
 * actions' sheets, whose host never unmounts). `useKeptSheetOpening` reads the
 * kept draft to start the sheet's state from. While mounted the store follows
 * the draft;
 * `clear()` where the sheet gives it up;
 * `hold()` when a save starts, so a screen reopened mid-save doesn't offer
 * the same entry again, and `release()` when it fails, with anything the
 * failure added that the sheet hasn't drawn yet (`patch`).
 *
 * A save that settles after the screen was left (an upload awaited in the
 * sheet, not a `mutate` callback, which doesn't run then) comes from a sheet
 * that is gone, while a later visit may have written a draft of its own. A
 * landed save then clears nothing, since its draft was held out of the store
 * already; a failed one puts its draft back only where no later one stands.
 *
 * With `waitsOnSend`, a sheet mounted while its last visit's save is still
 * out (#5086) opens on what that visit sent, not blank, and waits on it:
 * `sendingElsewhere` is true until it settles, and the sheet locks as the one
 * that sent it did, so the same entry isn't sent twice. A failed save leaves
 * the sheet holding its draft, kept from then on; one that lands turns
 * `landedElsewhere` true, and the sheet closes (or, for notes the server now
 * holds, takes them as its base). Only a sheet whose save is awaited, and so
 * settles after the sheet has gone, can pass it: a `mutate` callback never
 * runs once its sheet unmounts, so a sheet that sends that way would wait for
 * good, and opens blank instead.
 */
export function useKeptSheetOpening<T>(
  name: string | null,
  options?: { waitsOnSend?: boolean },
): T | undefined {
  const keys = useKeptDraftKeys();
  const waitsOnSend = options?.waitsOnSend === true;
  const [opening] = useState(() => {
    if (name === null) return undefined;
    const key = keys.draft(name);
    const kept = readKeptDraft<T>(key);
    return kept !== undefined || !waitsOnSend ? kept : readKeptSend<T>(key);
  });
  return opening;
}

export function useKeptSheetDraft<T>(
  name: string | null,
  value: T,
  /** What decides "changed", or `undefined` for the value's own JSON. */
  signature: string | undefined,
  /** What `useKeptSheetOpening` gave the sheet to start from. */
  opening: T | undefined,
): {
  clear: () => void;
  hold: () => void;
  release: (patch?: Partial<T>) => void;
  /** The save of an earlier visit this sheet opened on is still out. */
  sendingElsewhere: boolean;
  /** That save landed: what the sheet shows has been sent. */
  landedElsewhere: boolean;
} {
  const keys = useKeptDraftKeys();
  const key = name === null ? null : keys.draft(name);
  // Same object, so it came from the save in flight rather than the store.
  const [adoptsSend] = useState(
    () =>
      key !== null && opening !== undefined && readKeptSend<T>(key) === opening,
  );
  const kept = useKeptFormDraft<T>(name, true, value, {
    signature,
    restoredAtMount: opening !== undefined,
    adoptsSend,
  });
  const {
    drop,
    rebase,
    hold,
    release,
    settleGone,
    sendingElsewhere,
    landedElsewhere,
  } = kept;
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  // What the sheet is left showing (blank, or what failed to send) is not a
  // new draft.
  const clear = useCallback(() => {
    if (gone.current) {
      settleGone("landed");
      return;
    }
    drop();
    rebase();
  }, [drop, rebase, settleGone]);
  const releaseWith = useCallback(
    (patch?: Partial<T>) => {
      if (key === null) return;
      if (gone.current && hasKeptDraft(key)) {
        settleGone("failed");
        return;
      }
      release();
      const now = readKeptDraft<T>(key);
      if (patch && now !== undefined) writeKeptDraft(key, { ...now, ...patch });
    },
    [key, release, settleGone],
  );
  return useMemo(
    () => ({
      clear,
      hold,
      release: releaseWith,
      sendingElsewhere,
      landedElsewhere,
    }),
    [clear, hold, releaseWith, sendingElsewhere, landedElsewhere],
  );
}

/** Shared with web's event editor (`@repo/hooks/kept-drafts`). */
export { keepEditsOver };

/**
 * Drops a kept draft whose record is gone (deleted, or no longer this
 * member's to see), so nothing keeps it for a sheet that can't open again.
 */
export function useDropKeptSheetDraft(name: string | null, gone: boolean) {
  const keys = useKeptDraftKeys();
  useEffect(() => {
    if (gone && name !== null) dropKeptDraft(keys.draft(name));
  }, [gone, name, keys]);
}
