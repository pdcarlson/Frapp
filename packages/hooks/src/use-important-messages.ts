"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** The strip's accessible name on the phone, which says what a tap does. */
export function importantStripActionLabel(total: number): string {
  return total === 1
    ? "1 important message. Jump to it"
    : `${total} important messages. Jump to the oldest`;
}

/** The ×'s accessible name. */
export const IMPORTANT_STRIP_DISMISS_LABEL = "Dismiss important messages";

/**
 * How long reports of rows scrolled onto the screen are gathered before one
 * write. Scrolling reports many ranges a second, and the API's `write` bucket
 * allows 30 a minute per route per member, across every channel.
 */
export const IMPORTANT_SEEN_BATCH_MS = 800;

/**
 * After a seen write fails, how long rows on screen stop being reported. A
 * failure is usually the write bucket being spent or the network; reporting
 * the same rows again at once would only fail again, every batch.
 */
export const IMPORTANT_SEEN_RETRY_PAUSE_MS = 30_000;

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

/** An answer with these ids taken out of the list and the count. */
export function withoutMessages(
  answer: ImportantMessages,
  ids: ReadonlySet<string>,
): ImportantMessages {
  if (ids.size === 0) return answer;
  const kept = answer.messages.filter((m) => !ids.has(m.id));
  const removed = answer.messages.length - kept.length;
  return { messages: kept, total: Math.max(0, answer.total - removed) };
}

/**
 * A browser tab in the background: rows drawn there are on no one's screen.
 * React Native has no `document`; the phone says so through `isOnScreen`.
 */
function pageHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
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
   * {@link IMPORTANT_SEEN_BATCH_MS}, and nothing while the timeline isn't in
   * front of the member.
   */
  reportVisible: (ids: readonly string[]) => void;
  /** The ×: every one is seen. */
  dismiss: () => void;
}

export interface ImportantStripOptions {
  /**
   * Whether the timeline is in front of the member right now: not under
   * another screen, not hidden behind another pane, the app in the
   * foreground. Read when a report would be written, never during render.
   * A browser tab in the background is ruled out here already.
   */
  isOnScreen?: () => boolean;
}

/**
 * The strip's state for the open channel, and its writes.
 *
 * `loadedMessages` is the timeline's cache. It is read only for
 * {@link importantSignature}: when that changes the strip re-reads, so a flag
 * someone adds while the member is in the channel shows at once.
 *
 * **Claimed ids.** Every id this member jumped to, scrolled past or dismissed
 * in this channel is held as claimed until its write fails, and the strip
 * always draws the server's answer minus the claimed ids. So writes show at
 * once, and an answer computed before a later write (an older seen write's
 * answer landing last, a read that raced a write) can't bring a message back.
 * A failed write releases its ids, so a message whose seen didn't land comes
 * back.
 */
export function useImportantMessages(
  channelId: string | null | undefined,
  loadedMessages: readonly FlagFields[] | undefined,
  options: ImportantStripOptions = {},
): ImportantStrip {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  const enabled = !!chapterId && !!channelId;
  const channel = channelId ?? null;
  const key = importantMessageKeys.detail(chapterId ?? "", channel ?? "");

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/channels/{id}/important", {
        params: { path: { id: channel! } },
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
    lastSignature.current = { channelId: channel, value: signature };
    if (!enabled || last.channelId !== channel) return;
    if (last.value === signature) return;
    void queryClient.invalidateQueries({
      queryKey: importantMessageKeys.detail(chapterId!, channel!),
      exact: true,
    });
  }, [signature, channel, chapterId, enabled, queryClient]);

  // What has been claimed in this channel: state for the render, mirrored in
  // a ref so writes and reports read the latest at once.
  type Claimed = { channelId: string | null; ids: ReadonlySet<string> };
  const [claimedState, setClaimedState] = useState<Claimed>({
    channelId: null,
    ids: new Set(),
  });
  const claimed = useRef<Claimed>(claimedState);
  const updateClaimed = useCallback(
    (forChannel: string | null, change: (ids: Set<string>) => void) => {
      const base =
        claimed.current.channelId === forChannel
          ? claimed.current.ids
          : new Set<string>();
      const next = new Set(base);
      change(next);
      claimed.current = { channelId: forChannel, ids: next };
      setClaimedState(claimed.current);
    },
    [],
  );
  const claimedIn = useCallback(
    (forChannel: string | null): ReadonlySet<string> =>
      claimed.current.channelId === forChannel
        ? claimed.current.ids
        : new Set<string>(),
    [],
  );

  const answer = useMemo(() => {
    const data = query.data ?? EMPTY;
    return claimedState.channelId === channel
      ? withoutMessages(data, claimedState.ids)
      : data;
  }, [query.data, channel, claimedState]);
  const unseenIds = useMemo(
    () => new Set(answer.messages.map((m) => m.id)),
    [answer],
  );
  const unseenRef = useRef(unseenIds);
  useEffect(() => {
    unseenRef.current = unseenIds;
  }, [unseenIds]);

  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedUntil = useRef(0);
  const context = useRef({ client, queryClient, chapterId, channel, options });
  useEffect(() => {
    context.current = { client, queryClient, chapterId, channel, options };
  });

  /** Gives ids back after a failed write, and re-reads the strip. */
  const release = useCallback(
    (forChannel: string, forChapter: string, ids: Iterable<string>) => {
      if (claimed.current.channelId === forChannel) {
        updateClaimed(forChannel, (set) => {
          for (const id of ids) set.delete(id);
        });
      }
      void context.current.queryClient.invalidateQueries({
        queryKey: importantMessageKeys.detail(forChapter, forChannel),
        exact: true,
      });
    },
    [updateClaimed],
  );

  const send = useCallback(
    (ids: readonly string[]) => {
      const {
        client: c,
        queryClient: qc,
        chapterId: chapter,
      } = context.current;
      const forChannel = context.current.channel;
      if (!chapter || !forChannel || ids.length === 0) return;
      const writeKey = importantMessageKeys.detail(chapter, forChannel);
      void c
        .POST("/v1/channels/{id}/important/seen", {
          params: { path: { id: forChannel } },
          body: { message_ids: [...ids] },
        })
        .then(({ data, error }) => {
          if (error || !data) throw error ?? new Error("No answer");
          // The claimed set is taken off whatever this answer says, so it
          // never undoes a later write.
          qc.setQueryData<ImportantMessages>(writeKey, data);
        })
        .catch(() => {
          pausedUntil.current = Date.now() + IMPORTANT_SEEN_RETRY_PAUSE_MS;
          release(forChannel, chapter, ids);
        });
    },
    [release],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const ids = [...pending.current];
    pending.current = new Set();
    send(ids);
  }, [send]);

  /** Claims the unseen ones among `ids`; returns those newly claimed. */
  const claim = useCallback(
    (ids: readonly string[]): string[] => {
      const already = claimedIn(channel);
      const fresh = ids.filter(
        (id) => unseenRef.current.has(id) && !already.has(id),
      );
      if (fresh.length > 0) {
        updateClaimed(channel, (set) => {
          for (const id of fresh) set.add(id);
        });
      }
      return fresh;
    },
    [channel, claimedIn, updateClaimed],
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
  // it), which no scroll would report again. Cleared on a channel switch,
  // before anything below reads it.
  const onScreen = useRef<readonly string[]>([]);
  useEffect(() => {
    onScreen.current = [];
  }, [channel]);

  const gather = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0 || pageHidden()) return;
      const isOnScreen = context.current.options.isOnScreen;
      if (isOnScreen && !isOnScreen()) return;
      if (Date.now() < pausedUntil.current) return;
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
    if (typeof document === "undefined") return;
    const onVisibility = () => gather(onScreen.current);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [gather]);

  // A channel switch sends what was gathered for the channel being left.
  useEffect(() => {
    return () => {
      if (pending.current.size > 0) flush();
    };
  }, [channel, flush]);

  const dismiss = useCallback(() => {
    const { client: c, queryClient: qc, chapterId: chapter } = context.current;
    if (!chapter || !channel) return;
    const writeKey = importantMessageKeys.detail(chapter, channel);
    const ids = answer.messages.map((m) => m.id);
    updateClaimed(channel, (set) => {
      for (const id of ids) set.add(id);
    });
    // What the list doesn't name (past its 50) leaves with the answer.
    qc.setQueryData<ImportantMessages>(writeKey, (old) =>
      old ? { messages: old.messages, total: old.messages.length } : old,
    );
    void c
      .POST("/v1/channels/{id}/important/dismiss", {
        params: { path: { id: channel } },
      })
      .then(({ data, error }) => {
        if (error || !data) throw error ?? new Error("No answer");
        qc.setQueryData<ImportantMessages>(writeKey, data);
      })
      .catch(() => release(channel, chapter, ids));
  }, [answer, channel, updateClaimed, release]);

  return {
    total: answer.total,
    next: answer.messages[0] ?? null,
    markSeen,
    reportVisible,
    dismiss,
  };
}
