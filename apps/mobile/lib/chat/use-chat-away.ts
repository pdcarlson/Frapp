import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  AWAY_HEARTBEAT_MS,
  awaySince,
  readLastChatVisit,
  writeLastChatVisit,
} from "./away-updates";

/** One stretch of "while you were away", for one member in one chapter. */
export interface AwayStretch {
  key: string;
  since: number;
  /** The channels the card opened with; null until the first rows land. */
  ids: ReadonlySet<string> | null;
  closed: boolean;
}

/**
 * When Chat home's "while you were away" card has a stretch to show (#5464).
 *
 * The member's last time on Chat is kept on the phone, per member and
 * chapter. It is read when Chat comes into view: on focus, and when the app
 * comes back to the foreground while Chat is showing (focus never fires for
 * that, and it is the usual way back after a night away). While Chat shows,
 * the time is written again every few minutes and on leaving, so a phone
 * that kills the app in the background doesn't leave an old time behind.
 *
 * A stretch belongs to one chapter: switching chapters drops it. It ends
 * once its channels are read (`end`), or on the card's close mark (`close`),
 * and nothing restarts it until the member has been away again.
 */
export function useChatAway(input: {
  viewerId: string | null;
  chapterId: string | null;
  focused: boolean;
}): {
  stretch: AwayStretch | null;
  freeze: (ids: readonly string[]) => void;
  end: () => void;
  close: () => void;
} {
  const { viewerId, chapterId, focused } = input;
  const key = viewerId && chapterId ? `${viewerId}.${chapterId}` : null;
  const [stretch, setStretch] = useState<AwayStretch | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const check = useCallback(() => {
    if (!viewerId || !chapterId || !key) return;
    void readLastChatVisit(viewerId, chapterId).then((previous) => {
      if (!live.current) return;
      const now = Date.now();
      const since = awaySince(previous, now);
      if (since !== null) setStretch({ key, since, ids: null, closed: false });
      writeLastChatVisit(viewerId, chapterId, now);
    });
  }, [viewerId, chapterId, key]);

  const touch = useCallback(() => {
    if (viewerId && chapterId) {
      writeLastChatVisit(viewerId, chapterId, Date.now());
    }
  }, [viewerId, chapterId]);

  useEffect(() => {
    if (!focused) return;
    check();
    const heartbeat = setInterval(touch, AWAY_HEARTBEAT_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
      else touch();
    });
    return () => {
      clearInterval(heartbeat);
      subscription.remove();
      touch();
    };
  }, [focused, check, touch]);

  return {
    // Another member's or chapter's stretch isn't this one's; a stretch for
    // this one replaces it on the next check.
    stretch: stretch && stretch.key === key ? stretch : null,
    freeze: useCallback(
      (ids) =>
        setStretch((current) =>
          current && current.ids === null
            ? { ...current, ids: new Set(ids) }
            : current,
        ),
      [],
    ),
    end: useCallback(() => setStretch(null), []),
    close: useCallback(
      () =>
        setStretch((current) =>
          current ? { ...current, closed: true } : current,
        ),
      [],
    ),
  };
}
