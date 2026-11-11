"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { createChapterQueryKeys } from "./chapter-query-keys";

/**
 * The "1 important message" strip (#4186, slice 4 of #3921), shared by web
 * and mobile. The rule is the server's (`spec/behavior/chat/README.md`
 * § Message flags, The Important strip): which Important messages count, and
 * which the member has seen. A client never counts them from its own cache,
 * which may not hold older pages; it reads `GET /v1/channels/{id}/important`
 * and reports what the member jumped to or scrolled past.
 */
export const importantMessageKeys = createChapterQueryKeys("chat-important");

export type ImportantMessages = components["schemas"]["ImportantMessagesDto"];
export type ImportantMessageRef =
  components["schemas"]["ImportantMessageRefDto"];

/** "1 important message", "3 important messages". */
export function importantStripLabel(total: number): string {
  return `${total} important message${total === 1 ? "" : "s"}`;
}

/** The strip's accessible name, which says what a tap does. */
export function importantStripActionLabel(total: number): string {
  return total === 1
    ? "1 important message. Jump to it"
    : `${total} important messages. Jump to the oldest`;
}

/** The ×'s accessible name. */
export const IMPORTANT_STRIP_DISMISS_LABEL = "Dismiss important messages";

/**
 * How long reports of rows scrolled onto the screen are gathered before one
 * write. Scrolling reports many ranges a second; the write bucket allows 30
 * a minute per channel route.
 */
export const IMPORTANT_SEEN_BATCH_MS = 800;

/** The loaded rows' fields that say whether a message is flagged Important. */
type FlagFields = {
  id: string;
  flag?: string | null;
  flagged_at?: string | null;
  is_deleted?: boolean;
};

/**
 * A key for which loaded messages carry Important, and since when. It changes
 * when a flag goes on, comes off or is replaced, whether by this member or by
 * the Realtime echo of someone else's, and that is when the strip re-reads.
 */
export function importantSignature(
  messages: readonly FlagFields[] | undefined,
): string {
  if (!messages) return "";
  return messages
    .filter((m) => m.flag === "important" && !m.is_deleted)
    .map((m) => `${m.id}@${m.flagged_at ?? ""}`)
    .sort()
    .join(",");
}

const EMPTY: ImportantMessages = { messages: [], total: 0 };

/**
 * A browser tab in the background: rows drawn there are on no one's screen.
 * React Native has no `document`, and a backgrounded app reports no rows.
 */
function pageHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/** The cached answer with these ids taken out, for a write in flight. */
export function withoutMessages(
  answer: ImportantMessages,
  ids: ReadonlySet<string>,
): ImportantMessages {
  const kept = answer.messages.filter((m) => !ids.has(m.id));
  const removed = answer.messages.length - kept.length;
  return { messages: kept, total: Math.max(0, answer.total - removed) };
}

export interface ImportantStrip {
  /** How many unseen; 0 when none, or while unknown. */
  total: number;
  /** The one a tap jumps to: the oldest unseen. */
  next: ImportantMessageRef | null;
  /** Marks these seen now (a jump). */
  markSeen: (ids: readonly string[]) => void;
  /**
   * Reports the rows on screen now, replacing the last report. Only the
   * unseen Important ones are written, in one batch after
   * {@link IMPORTANT_SEEN_BATCH_MS}, and nothing while a browser tab is in
   * the background.
   */
  reportVisible: (ids: readonly string[]) => void;
  /** The ×: every one is seen. */
  dismiss: () => void;
}

/**
 * The strip's state for the open channel, and its writes.
 *
 * `loadedMessages` is the timeline's cache. It is read only for
 * {@link importantSignature}: when that changes the strip re-reads, so a flag
 * someone adds while the member is in the channel shows at once.
 *
 * Writes are optimistic: the messages leave the strip at once, and the
 * server's answer then replaces the cache. A failed write re-reads, so a
 * message whose seen didn't land comes back rather than staying hidden.
 */
export function useImportantMessages(
  channelId: string | null | undefined,
  loadedMessages: readonly FlagFields[] | undefined,
): ImportantStrip {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const enabled = !!chapterId && !!channelId;
  const key = importantMessageKeys.detail(chapterId ?? "", channelId ?? "");

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/important", {
        params: { path: { id: channelId! } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled,
  });

  // Re-read when a flag changes in the loaded timeline. Not on the first
  // signature a channel shows: the query's own read covers that.
  const signature = importantSignature(loadedMessages);
  const lastSignature = useRef<{ channelId: string | null; value: string }>({
    channelId: null,
    value: "",
  });
  useEffect(() => {
    const last = lastSignature.current;
    lastSignature.current = { channelId: channelId ?? null, value: signature };
    if (!enabled || last.channelId !== (channelId ?? null)) return;
    if (last.value === signature) return;
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
    // `key` is derived from the two ids already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, channelId, chapterId, enabled, queryClient]);

  const answer = query.data ?? EMPTY;
  const unseenIds = useMemo(
    () => new Set(answer.messages.map((m) => m.id)),
    [answer],
  );
  const unseenRef = useRef(unseenIds);
  useEffect(() => {
    unseenRef.current = unseenIds;
  }, [unseenIds]);

  // Ids already sent or waiting, per channel, so a row that stays on screen
  // is written once.
  const reported = useRef<{ channelId: string | null; ids: Set<string> }>({
    channelId: null,
    ids: new Set(),
  });
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeContext = useRef({ client, queryClient, chapterId, channelId });
  useEffect(() => {
    writeContext.current = { client, queryClient, chapterId, channelId };
  });

  const send = useCallback((ids: readonly string[]) => {
    const {
      client: c,
      queryClient: qc,
      chapterId: chapter,
      channelId: channel,
    } = writeContext.current;
    if (!chapter || !channel || ids.length === 0) return;
    const writeKey = importantMessageKeys.detail(chapter, channel);
    const idSet = new Set(ids);
    qc.setQueryData<ImportantMessages>(writeKey, (old) =>
      old ? withoutMessages(old, idSet) : old,
    );
    void c
      .POST("/v1/channels/{id}/important/seen", {
        params: { path: { id: channel } },
        body: { message_ids: [...idSet] },
      })
      .then(({ data, error }) => {
        if (error || !data) throw error ?? new Error("No answer");
        // Ids still waiting to be sent stay out of the answer too.
        qc.setQueryData<ImportantMessages>(writeKey, () =>
          withoutMessages(data, pending.current),
        );
      })
      .catch(() => {
        for (const id of idSet) reported.current.ids.delete(id);
        void qc.invalidateQueries({ queryKey: writeKey, exact: true });
      });
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const ids = [...pending.current];
    pending.current = new Set();
    send(ids);
  }, [send]);

  // A channel switch sends what was gathered for the channel being left,
  // then starts the next one's list afresh.
  useEffect(() => {
    return () => {
      if (pending.current.size > 0) flush();
    };
  }, [channelId, flush]);

  const claim = useCallback(
    (ids: readonly string[]): string[] => {
      if (reported.current.channelId !== (channelId ?? null)) {
        reported.current = { channelId: channelId ?? null, ids: new Set() };
      }
      const fresh = ids.filter(
        (id) => unseenRef.current.has(id) && !reported.current.ids.has(id),
      );
      for (const id of fresh) reported.current.ids.add(id);
      return fresh;
    },
    [channelId],
  );

  const markSeen = useCallback(
    (ids: readonly string[]) => {
      const fresh = claim(ids);
      if (fresh.length > 0) send(fresh);
    },
    [claim, send],
  );

  // The rows last reported on screen. Kept so they count once they can: when
  // a browser tab comes back to the front, and when the strip learns of a
  // message that was already on screen (flagged while the member looked at
  // it), which no scroll would report again.
  const onScreen = useRef<readonly string[]>([]);

  const gather = useCallback(
    (ids: readonly string[]) => {
      if (pageHidden()) return;
      const fresh = claim(ids);
      if (fresh.length === 0) return;
      for (const id of fresh) pending.current.add(id);
      if (!timer.current) {
        timer.current = setTimeout(flush, IMPORTANT_SEEN_BATCH_MS);
      }
    },
    [claim, flush],
  );

  const reportVisible = useCallback(
    (ids: readonly string[]) => {
      onScreen.current = ids;
      gather(ids);
    },
    [gather],
  );

  useEffect(() => {
    gather(onScreen.current);
  }, [unseenIds, gather]);

  useEffect(() => {
    onScreen.current = [];
  }, [channelId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => gather(onScreen.current);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [gather]);

  const dismiss = useCallback(() => {
    if (!enabled) return;
    queryClient.setQueryData<ImportantMessages>(key, EMPTY);
    void client
      .POST("/v1/channels/{id}/important/dismiss", {
        params: { path: { id: channelId! } },
      })
      .then(({ error }) => {
        if (error) throw error;
      })
      .catch(() => {
        void queryClient.invalidateQueries({ queryKey: key, exact: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, queryClient, enabled, chapterId, channelId]);

  return {
    total: answer.total,
    next: answer.messages[0] ?? null,
    markSeen,
    reportVisible,
    dismiss,
  };
}
