/**
 * Fills the unread first-paint overlay (`unread-first-paint.ts`, #4006): the
 * tray's chat channels, the saved answer of the signed-in member and chapter,
 * and the save of each new server answer. Mounted once from
 * `components/app-runtime.tsx`.
 */
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { CHANNEL_UNREAD_COUNTS_KEY, viewedChannelId } from "@repo/hooks";
import { useAuthSession } from "@/lib/auth-session";
import { presentedChatChannelIds } from "@/lib/notifications/push";
import { holdUnreadFirstPaint as hold } from "./unread-first-paint";
import {
  asUnreadRows,
  readUnreadMemory,
  unreadMemoryKey,
  writeUnreadMemory,
} from "./unread-memory";

/**
 * Reads the tray into the overlay. The thread on screen is left out: coming
 * forward stamps it read (`createChatActivityHandler`), so it must not light.
 */
function readTray(isCancelled: () => boolean): void {
  const since = Date.now();
  void presentedChatChannelIds().then((channelIds) => {
    if (isCancelled()) return;
    const viewed =
      AppState.currentState === "active" ? viewedChannelId() : null;
    if (viewed) channelIds.delete(viewed);
    hold({ tray: { channelIds, since } });
  });
}

const UNREAD_QUERY_HASH = hashKey(CHANNEL_UNREAD_COUNTS_KEY);

export function useUnreadFirstPaintRuntime(): void {
  const queryClient = useQueryClient();
  const { status, userId, chapterId, isChapterResolving } = useAuthSession();
  // No key until the chapter claim has been read: before that `null` means
  // "not known yet", not "no chapter".
  const memoryKey =
    status === "authenticated" && userId && !isChapterResolving
      ? unreadMemoryKey(userId, chapterId)
      : null;

  // The tray, at launch and on each return from the background. At launch it
  // is read at once, signed in or not: on Android, badging the icon to zero
  // cancels every notification (`use-badge-sync.ts` does that while it has
  // nothing to count), so a read that waited for the session would find the
  // tray already empty. `background`, not `inactive`, the line
  // `useChatRealtimeBinding` draws for its resume.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    readTray(isCancelled);
    let previous: AppStateStatus | null = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous === "background") readTray(isCancelled);
      previous = next;
    });
    return () => {
      cancelled = true;
      subscription.remove();
      hold({ tray: null });
    };
  }, []);

  // The saved answer of this member and chapter, and no one else's.
  useEffect(() => {
    if (!memoryKey) return;
    let cancelled = false;
    void readUnreadMemory(memoryKey).then((saved) => {
      if (!cancelled) hold({ saved });
    });
    return () => {
      cancelled = true;
      hold({ saved: null });
    };
  }, [memoryKey]);

  // Keep the server's latest answer for the next launch. Only a fetch's
  // result: an optimistic write is not an answer.
  useEffect(() => {
    if (!memoryKey) return;
    let lastSaved: string | null = null;
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        event.action.type !== "success" ||
        event.action.manual ||
        event.query.queryHash !== UNREAD_QUERY_HASH
      ) {
        return;
      }
      const rows = asUnreadRows(event.query.state.data);
      if (!rows) return;
      const serialized = JSON.stringify(rows);
      if (serialized === lastSaved) return;
      lastSaved = serialized;
      writeUnreadMemory(memoryKey, serialized);
    });
  }, [queryClient, memoryKey]);
}
