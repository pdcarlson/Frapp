import { useCallback, useMemo, useState } from "react";
import {
  readKeptDraft,
  useKeptDraftKeys,
  useKeptFormDraft,
} from "@repo/hooks/kept-drafts";

/**
 * A form sheet's draft, kept past its screen (#4593: "keep the draft").
 *
 * A sheet already keeps its draft across a close, because it stays mounted on
 * its host (`spec/ui/mobile/patterns.md` § Bottom sheets). A sheet hosted by a
 * pushed screen (Tasks, Service hours, Documents) goes when the member goes
 * back, and took the draft with it. This keeps it in the shared store
 * (`@repo/hooks/kept-drafts`, the one web's docked forms use), by member,
 * chapter and form, so the screen's sheet opens on it next time.
 *
 * `name` is `null` for a sheet that keeps nothing past its host (the + quick
 * actions' sheets, whose host never unmounts). `useKeptSheetOpening` reads the
 * kept draft to start the sheet's state from. While mounted the store follows
 * the draft;
 * `clear()` where the sheet gives it up (Cancel, a save that lands);
 * `hold()` when a save starts, so a screen reopened mid-save doesn't offer
 * the same entry again, and `release()` when it fails.
 */
export function useKeptSheetOpening<T>(name: string | null): T | undefined {
  const keys = useKeptDraftKeys();
  const [opening] = useState(() =>
    name === null ? undefined : readKeptDraft<T>(keys.draft(name)),
  );
  return opening;
}

export function useKeptSheetDraft<T>(
  name: string | null,
  value: T,
  signature: string,
  /** What `useKeptSheetOpening` gave the sheet to start from. */
  opening: T | undefined,
): {
  clear: () => void;
  hold: () => void;
  release: () => void;
} {
  const kept = useKeptFormDraft<T>(name, true, value, {
    signature,
    restoredAtMount: opening !== undefined,
  });
  const { drop, rebase, hold, release } = kept;
  // What the sheet is left showing (blank, or what failed to send) is not a
  // new draft.
  const clear = useCallback(() => {
    drop();
    rebase();
  }, [drop, rebase]);
  return useMemo(() => ({ clear, hold, release }), [clear, hold, release]);
}
