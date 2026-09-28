"use client";

/**
 * Component-facing facade for a single chat channel.
 *
 * This hook is the **only** thing chat UI components touch. It hides the
 * normalized cache, the supabase singleton, the realtime manager, and the
 * outbox so components stay dumb (arrays + callbacks).
 */

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { useChannelDraft } from "./use-channel-draft";
import { useChatViewerId } from "@/lib/chat/viewer-id";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
  type RawChatMessage,
  type RawChatMessageAction,
} from "@repo/chat-core/types";
import {
  applyReactionInsert,
  confirmedDepth,
  emptyCache,
  mergeUnheldRows,
  mergeServerRows,
  newestConfirmed,
  oldestConfirmed,
  reconcileNewestPage,
  selectMessages,
} from "@repo/chat-core/cache";
import { chatRealtime, type ConnectionStatus } from "@repo/chat-core/realtime-manager";
import {
  actOnCard,
  deleteMessage as deleteMessageAction,
  discardOutboxRow,
  editMessage as editMessageAction,
  flushOutbox,
  hydrateOutboxIntoCache,
  mergePersistedNotices,
  react as reactAction,
  retryOutboxRow,
  sendMessage,
  unreact as unreactAction,
  type ToastFn,
} from "@repo/chat-core/chat-client";
import { browserKeyValueStore, type OutboxAttachment } from "@repo/chat-core/adapters";
import type { ReplayRequest } from "@repo/chat-core/types";
import {
  dispatchSlashCommand,
  retryPointsDispatch,
  type DispatchResult,
  type ResolveMember,
} from "@repo/chat-core/dispatch";
import type { SlashCommand } from "@repo/chat-integrations";
import { createDexieOutboxStore } from "./offline-queue";
import { useChatOutboundScope } from "./chat-scope";
import { usePersistedChannelTail } from "./use-first-chunk-cache";

/** The newest page a channel opens on. */
export const FIRST_PAGE_LIMIT = 50;
/** Each older page (#1571). Under the API's 200 cap, and small enough that the
 *  reaction read's `in (…)` list of ids stays a reasonable URL. */
export const OLDER_PAGE_LIMIT = 100;
/** Older pages a refetch re-reads to keep loaded history (#1571). */
export const REFETCH_MAX_OLDER_PAGES = 10;

/**
 * Whether a refetch's read has not yet reached as far back as the cache it
 * replaces. Two ways to be done: the read has gone past the cache's oldest row
 * (strictly, in milliseconds — a row sharing that millisecond may still be
 * unread), or it holds as many rows as the cache did, not counting rows newer
 * than the cache's newest, which are what arrived since.
 */
function needsDeeperRead(
  fresh: ChannelCache,
  depth: ReturnType<typeof confirmedDepth>,
): boolean {
  if (depth.oldestTime === null || depth.newestTime === null) return false;
  const edge = oldestConfirmed(fresh);
  if (!edge || Date.parse(edge.created_at) < depth.oldestTime) return false;
  let covered = 0;
  for (const key of fresh.order) {
    const message = fresh.byId[key];
    if (
      message?._status === "confirmed" &&
      Date.parse(message.created_at) <= depth.newestTime
    ) {
      covered += 1;
    }
  }
  return covered < depth.rows;
}

/**
 * What one `loadOlder` call did.
 *
 * - `loaded`: older rows were added.
 * - `start`: the channel has nothing older; `hasOlder` is now false.
 * - `stale`: the cache's oldest row moved while the page was in flight (a
 *   refetch dropped the older pages), so the page was discarded rather than
 *   merged across a hole. Nothing is wrong; ask again.
 * - `error`: the read failed. `olderError` says so until the next attempt.
 */
export type LoadOlderResult = "loaded" | "start" | "stale" | "error";

export interface UseChatChannelResult {
  messages: ChatMessage[];
  isLoading: boolean;
  loadError: Error | null;
  /**
   * Whether older history may exist beyond the loaded rows. True until a read
   * comes back short, so a channel the member has not scrolled to the top of
   * says "maybe" rather than "no".
   */
  hasOlder: boolean;
  isLoadingOlder: boolean;
  /** The last older-page read failed; cleared by the next attempt. */
  olderError: boolean;
  /** Loads the next page of older history. Concurrent calls share one read. */
  loadOlder: () => Promise<LoadOlderResult>;
  /**
   * Reads what arrived after the newest loaded row, once, and merges it:
   * a jump's first move, since its target may be a message Realtime has not
   * delivered yet rather than an old one. Resolves how many rows were new,
   * or `null` when the read failed.
   */
  loadNewer: () => Promise<number | null>;
  send: (
    content: string,
    opts?: { replyToId?: string | null; attachments?: OutboxAttachment[] },
  ) => Promise<void>;
  react: (messageId: string, emoji: string) => Promise<void>;
  unreact: (messageId: string, emoji: string) => Promise<void>;
  /** Own message only — enforced server-side. Rejects on failure; callers keep editing on error. */
  edit: (messageId: string, content: string) => Promise<void>;
  /** Own message, or any message with `channels:manage` (server-enforced). */
  delete: (messageId: string) => Promise<void>;
  draft: string;
  setDraft: (body: string) => void;
  typingUsers: string[];
  emitTyping: () => void;
  connection: ConnectionStatus;
  retry: (clientMessageId: string) => Promise<void>;
  discard: (clientMessageId: string) => Promise<void>;
  /**
   * Replay an `unconfirmed` heavy-command row under its ORIGINAL idempotency
   * key (#1733) — not an outbox retry. `retry`/`discard` above operate on the
   * Dexie outbox, which heavy commands deliberately bypass
   * (`chat-client.ts`), so neither can reach one of these rows.
   *
   * Returns the dispatcher's `DispatchResult` for the same reason
   * `dispatchSlash` does: the caller toasts the outcome.
   */
  retryUnconfirmed: (replay: ReplayRequest) => Promise<DispatchResult>;
  // Returns the dispatcher's own `DispatchResult` rather than a restated shape,
  // so a new outcome field (e.g. `warning`) reaches the composer instead of
  // being silently erased at this boundary.
  dispatchSlash: (
    command: SlashCommand,
    args: string,
    announcementsChannelId: string | null,
    resolveMember?: ResolveMember,
  ) => Promise<DispatchResult>;
  /** Card action invoker (Vote, RSVP, …). Goes through the NestJS chat actions endpoint (ADR-11). */
  act: (
    messageId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

export function useChatChannel(channelId: string | null): UseChatChannelResult {
  const queryClient = useQueryClient();
  const apiClient = useFrappClient();
  /*
    The resolved viewer id — live if `GET /v1/users/me` has answered, else the
    one cached beside the first chunk (#2249).

    **Not a write credential, and that is why the cached value is allowed here.**
    Nothing below is *authorised* by `ctx.userId`: every REST action POSTs under
    the member's bearer token and the server derives the author from it, and the
    two paths that talk to Supabase directly are RLS-scoped to `auth.uid()`
    (`chat_message_actions`). What the id does is decide *local* attribution —
    which chip lights up (`toggleReactionLocal`), whose optimistic bubble is
    drawn (`senderId`), which member's queued rows hydrate
    (`hydrateOutboxIntoCache`). That is the same question `viewerId` answers for
    the timeline, so it takes the same answer.

    Two places do put it on the wire, and neither is an authorisation: `unreact`
    passes it as a `.match({ user_id })` filter on a `chat_message_actions`
    delete, and `emitTyping` broadcasts it as the typing identity. The filter is
    the one worth naming — a delete that matches nothing is not an error in
    Postgres, so a *stale* id (the deleted-and-recreated-account case this cache
    already bounds with a 7-day age limit) would remove the chip locally and
    leave the row on the server until a refetch or a realtime echo restores it.
    RLS still prevents it touching anyone else's row; the cost is a chip that
    disagrees with the server for one fetch, which is the same class of cost as
    painting a bubble on the wrong side for one fetch, and strictly smaller than
    the alternative below.

    Keeping it on the live id was worse than inconsistent, it was broken. The
    timeline's gate opens on the resolved id, so a warm or offline load now
    renders reaction chips, poll buttons and card actions — and `react` and
    `actOnCard` return *silently* on a falsy `ctx.userId`, with no optimistic
    chip, no request and no toast. Offline that window has no end. Worse,
    `hydrateOutboxIntoCache` returns on the same check, so a member who composed
    a message offline and reloaded would have seen a complete-looking thread
    with their own unsent message absent from it and no Retry in reach —
    `principles.md` §5 is the rule that outranks everything else here.
  */
  const userId = useChatViewerId();
  /*
    The viewer as of *now*, for the channel query's merge of persisted
    heavy-command rows. That query's key does not include the viewer, so a
    first fetch that started before the viewer resolved can finish after the
    hydrate that restored those rows; reading the viewer from its own closure
    would overwrite them with a snapshot built for nobody (#1789). A ref read
    at merge time sees the resolved id instead.
  */
  const viewerRef = useRef(userId);
  useEffect(() => {
    viewerRef.current = userId;
  }, [userId]);
  const { toast: rawToast } = useToast();
  const track = useContext(AnalyticsContext);
  const supabase = useMemo(() => getRealtimeClient(), []);

  const toast: ToastFn = useCallback(
    (input) =>
      rawToast({
        title: input.title,
        description: input.description,
        variant: input.variant,
      }),
    [rawToast],
  );

  /*
    Whose queue this channel reads and writes (#2226). The store is bound to the
    scope rather than being the module const it used to be, so every outbox
    operation this hook reaches — enqueue, retry, discard, the per-channel
    hydrate — can only address rows written by the signed-in member in the
    active chapter.
  */
  const scope = useChatOutboundScope();
  const outbox = useMemo(() => createDexieOutboxStore(scope), [scope]);

  const ctx = useMemo(
    () => ({
      queryClient,
      apiClient,
      supabase,
      userId,
      toast,
      track: track ?? undefined,
      outbox,
      kv: browserKeyValueStore,
    }),
    [queryClient, apiClient, supabase, userId, toast, track, outbox],
  );

  /*
    One page of history plus a single batched select on `chat_message_actions`,
    so reactions and poll tallies render accurately on first paint. The newest
    page and every older page (#1571) read through this one path.
  */
  const fetchPage = useCallback(
    async (
      id: string,
      query: { limit: number; before?: string; since?: string },
    ): Promise<{
      rows: RawChatMessage[];
      actions: RawChatMessageAction[];
    }> => {
      const { data, error } = await apiClient.GET(
        "/v1/channels/{id}/messages",
        { params: { path: { id }, query } },
      );
      if (error) throw error;
      const rows = asArray<RawChatMessage>(data);
      const messageIds = rows.map((row) => row.id).filter(Boolean);
      if (messageIds.length === 0) return { rows, actions: [] };
      const { data: actions } = await supabase
        .from("chat_message_actions")
        .select("*")
        .in("message_id", messageIds);
      return { rows, actions: (actions ?? []) as RawChatMessageAction[] };
    },
    [apiClient, supabase],
  );

  /*
    The channel's first row, per channel, once a read has come back short:
    `null` for a channel with no confirmed rows at all. `hasOlder` is false
    only while the cache's oldest row is still that row, so a refetch that
    drops the older pages makes the rest of the history reachable again.
  */
  const [channelStarts, setChannelStarts] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());
  const recordStart = useCallback((id: string, firstId: string | null) => {
    setChannelStarts((current) => {
      if (current.has(id) && current.get(id) === firstId) return current;
      const next = new Map(current);
      next.set(id, firstId);
      return next;
    });
  }, []);

  /*
    The newest page, and on a refetch every older page the member has loaded.

    A refetch (`refetchOnReconnect: "always"`, the first-chunk seed's
    invalidate, `refetchTimelinesHolding` after a report removal) is how a
    thread gets back to server truth after something it missed: an outage, a
    removal whose response was lost, a week-old disk tail. So it re-reads the
    history it keeps instead of trusting it, page by page back to the oldest
    row the cache held, and `reconcileNewestPage` drops whatever the read did
    not reach. Rows newer than the cache (what arrived while it was stale) do
    not count toward that depth, so a cold open over a 30-row disk tail reads
    one page unless more than 20 messages arrived meanwhile. Capped at
    `REFETCH_MAX_OLDER_PAGES`; history beyond it is dropped and reads again,
    fresh, when the member next scrolls to it.
  */
  const query = useQuery<ChannelCache, Error>({
    queryKey: channelId ? chatMessagesKey(channelId) : ["chat", "none"],
    enabled: !!channelId,
    staleTime: Infinity,
    queryFn: async () => {
      if (!channelId) return emptyCache();
      const key = chatMessagesKey(channelId);
      const depth = confirmedDepth(queryClient.getQueryData<ChannelCache>(key));
      const first = await fetchPage(channelId, { limit: FIRST_PAGE_LIMIT });
      let fresh = mergeServerRows(emptyCache(), first.rows);
      // The canonical merge, not a local copy: it also appends each raw
      // row to `message.actions`, which the poll-card tallies read — a
      // local variant that skipped that step left reloaded polls at zero
      // votes until a live echo happened to re-deliver them.
      for (const action of first.actions) {
        fresh = applyReactionInsert(fresh, action);
      }
      let reachedStart = first.rows.length < FIRST_PAGE_LIMIT;
      for (
        let pageNo = 0;
        !reachedStart &&
        pageNo < REFETCH_MAX_OLDER_PAGES &&
        needsDeeperRead(fresh, depth);
        pageNo += 1
      ) {
        const edge = oldestConfirmed(fresh)!;
        const older = await fetchPage(channelId, {
          limit: OLDER_PAGE_LIMIT,
          before: new Date(Date.parse(edge.created_at) + 1).toISOString(),
        });
        const merged = mergeUnheldRows(fresh, older.rows, older.actions);
        fresh = merged.cache;
        reachedStart = older.rows.length < OLDER_PAGE_LIMIT;
        // A full page inside one millisecond moves nothing; stop rather than
        // spend the cap on it. What it left unread goes, and reads again when
        // the member scrolls to it.
        if (merged.added === 0) break;
      }
      // Read after every await, so it is the cache as it is now: an outbox
      // hydrate or a Realtime row that landed during the read is in it (#2486).
      let cache = reconcileNewestPage(
        queryClient.getQueryData<ChannelCache>(key),
        fresh,
      );
      if (reachedStart) {
        recordStart(channelId, oldestConfirmed(cache)?.id ?? null);
      }
      // Re-merge the viewer's persisted heavy-command rows: `recorded`
      // (#1789), and `unconfirmed` with its Retry (#1909). The server never
      // wrote either, so the page never carries them, and the rebuild that
      // matters most is `refetchOnReconnect: "always"` firing on the
      // reconnect that follows the outage which lost the response.
      cache = mergePersistedNotices(cache, {
        channelId,
        viewerId: viewerRef.current,
        kv: browserKeyValueStore,
      });
      return cache;
    },
  });

  /*
    Older history (#1571), one page per call, merged into the live cache.

    The cursor is the oldest confirmed row's `created_at` plus one millisecond,
    not the timestamp itself: the API's `before` is strict, so two rows sharing
    the boundary instant (an imported burst, a bot) would leave the one the
    last page cut off unreachable forever. The overlap this causes is deduped
    by id. A full page that adds nothing means more than a page of rows share
    that millisecond, and only then does it fall back to the strict cursor.
  */
  const olderInFlight = useRef(new Map<string, Promise<LoadOlderResult>>());
  // Per channel: one hook serves every channel the shell switches through, and
  // a read that settles after a switch must only ever write its own channel's
  // status, never the one now on screen.
  const [olderStatus, setOlderStatus] = useState<
    ReadonlyMap<string, "loading" | "error">
  >(() => new Map());

  const loadOlder = useCallback((): Promise<LoadOlderResult> => {
    if (!channelId) return Promise.resolve("start");
    const inFlight = olderInFlight.current.get(channelId);
    if (inFlight) return inFlight;
    const key = chatMessagesKey(channelId);
    const setStatus = (status: "loading" | "error" | null) =>
      setOlderStatus((current) => {
        if ((current.get(channelId) ?? null) === status) return current;
        const next = new Map(current);
        if (status === null) next.delete(channelId);
        else next.set(channelId, status);
        return next;
      });
    const clearOlderStatus = () => setStatus(null);
    const run = async (): Promise<LoadOlderResult> => {
      const edge = oldestConfirmed(queryClient.getQueryData<ChannelCache>(key));
      if (!edge) {
        recordStart(channelId, null);
        return "start";
      }
      setStatus("loading");
      try {
        const cursors = [
          new Date(Date.parse(edge.created_at) + 1).toISOString(),
          edge.created_at,
        ];
        for (const before of cursors) {
          const { rows, actions } = await fetchPage(channelId, {
            limit: OLDER_PAGE_LIMIT,
            before,
          });
          // Assigned inside the updater, which runs synchronously; boxed so the
          // compiler does not narrow it to its initial value.
          const result: { outcome: LoadOlderResult } = { outcome: "stale" };
          queryClient.setQueryData<ChannelCache>(key, (current) => {
            // Merge only onto the edge the page was read from. A refetch that
            // dropped the older pages meanwhile moved it, and merging there
            // would draw a hole as if nothing had been said in it.
            if (!current || oldestConfirmed(current)?.id !== edge.id) {
              return current;
            }
            const merged = mergeUnheldRows(current, rows, actions);
            result.outcome = merged.added > 0 ? "loaded" : "start";
            return merged.cache;
          });
          const { outcome } = result;
          const short = rows.length < OLDER_PAGE_LIMIT;
          if (outcome === "stale" || (outcome === "loaded" && !short)) {
            clearOlderStatus();
            return outcome;
          }
          if (short) {
            recordStart(
              channelId,
              oldestConfirmed(queryClient.getQueryData<ChannelCache>(key))
                ?.id ?? null,
            );
            clearOlderStatus();
            return outcome;
          }
          // A full page that added nothing: retry on the strict cursor.
        }
        clearOlderStatus();
        return "stale";
      } catch {
        setStatus("error");
        return "error";
      }
    };
    const promise = run().finally(() => {
      olderInFlight.current.delete(channelId);
    });
    olderInFlight.current.set(channelId, promise);
    return promise;
  }, [channelId, fetchPage, queryClient, recordStart]);

  const loadNewer = useCallback(async (): Promise<number | null> => {
    if (!channelId) return 0;
    const key = chatMessagesKey(channelId);
    const newest = newestConfirmed(queryClient.getQueryData<ChannelCache>(key));
    if (!newest) return 0;
    try {
      const { rows, actions } = await fetchPage(channelId, {
        limit: OLDER_PAGE_LIMIT,
        since: newest.id,
      });
      let added = 0;
      queryClient.setQueryData<ChannelCache>(key, (current) => {
        if (!current) return current;
        const merged = mergeUnheldRows(current, rows, actions);
        added = merged.added;
        return merged.cache;
      });
      return added;
    } catch {
      return null;
    }
  }, [channelId, fetchPage, queryClient]);

  /*
    Ref-counted subscription to the realtime manager. Cleans up when the active
    channel changes or the component unmounts.

    Keyed on `channelId` alone, deliberately. It used to carry `ctx`, which was
    harmless while every member of `ctx` was stable for the life of the mount —
    and stopped being so when `ctx.outbox` became scope-bound (#2226), because
    the scope resolves a few milliseconds after mount. That made this effect
    tear the topic down and rebuild it on every chat open: at refCount 1→0
    `unsubscribe` calls `removeChannel` and drops the manager's channel state,
    so the re-subscribe mints a fresh `joining` — a websocket leave/rejoin, a
    second backfill, discarded typing state, and the connection pill flickering
    off `live`. The realtime topic has nothing to do with which member's outbox
    is mounted, so it should never have been able to notice.
  */
  useEffect(() => {
    if (!channelId) return;
    chatRealtime.subscribe(channelId);
    return () => chatRealtime.unsubscribe(channelId);
  }, [channelId]);

  // The outbox hydrate genuinely does depend on the scope — it replays this
  // member's unsent rows — so it keeps `ctx` and runs on its own.
  useEffect(() => {
    if (!channelId) return;
    void hydrateOutboxIntoCache(ctx, channelId).catch(() => {
      /*
        Best-effort, and explicitly caught. A rejected Dexie read here (a
        cross-tab `VersionError` while the v1→v3 upgrade lands, storage
        pressure, private mode) would otherwise be an unhandled rejection that
        reaches Sentry with no channel context and nothing anyone can act on.
        The timeline still paints; it just starts without the unsent rows.
      */
    });
  }, [channelId, ctx]);

  // Connection status pipe.
  const [connection, setConnection] = useState<ConnectionStatus>("live");
  useEffect(() => {
    const unsub = chatRealtime.subscribeStatus(setConnection);
    return unsub;
  }, []);

  // Typing users tick: re-read from the manager when its status pings change
  // (the manager bumps status listeners on typing membership changes too).
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  useEffect(() => {
    if (!channelId) return;
    const refresh = () =>
      setTypingUsers(chatRealtime.getTypingUsers(channelId));
    refresh();
    const unsub = chatRealtime.subscribeStatus(refresh);
    return unsub;
  }, [channelId]);

  /*
    Draft persistence lives in its own hook (#2176).

    It was inline here until the composer shell needed it to survive a channel
    that does not exist yet, which turned four lines of `useState` into a small
    state machine with an ordering hazard in it — and this hook takes eight
    dependencies, so nothing in that machine could be tested without standing up
    all eight. `use-channel-draft.ts` owns it and `use-channel-draft.spec.ts`
    tests it directly.
  */
  const { draft, setDraft, cancelPendingSave, clearAfterSend } =
    useChannelDraft(channelId);

  const send = useCallback(
    async (
      content: string,
      opts?: { replyToId?: string | null; attachments?: OutboxAttachment[] },
    ): Promise<void> => {
      // A message may be nothing but a file. Guarding on empty text alone would
      // silently drop an attachment-only send — the case the old
      // "append the filename into the body" composer could not produce, and the
      // first one a real attachment model makes possible.
      const hasAttachments = (opts?.attachments?.length ?? 0) > 0;
      if (!channelId) return;
      if (content.trim().length === 0 && !hasAttachments) return;
      // Cancel any in-flight debounced save before clearing so a stale draft
      // can't be re-persisted after the send.
      cancelPendingSave();
      await sendMessage(ctx, {
        channelId,
        content: content.trim(),
        replyToId: opts?.replyToId ?? null,
        attachments: opts?.attachments ?? null,
      });
      await clearAfterSend();
    },
    [cancelPendingSave, clearAfterSend, channelId, ctx],
  );

  const reactCb = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;
      await reactAction(ctx, { channelId, messageId, emoji });
    },
    [channelId, ctx],
  );

  const unreactCb = useCallback(
    async (messageId: string, emoji: string) => {
      if (!channelId) return;
      await unreactAction(ctx, { channelId, messageId, emoji });
    },
    [channelId, ctx],
  );

  const editCb = useCallback(
    async (messageId: string, content: string) => {
      if (!channelId) return;
      await editMessageAction(ctx, { channelId, messageId, content });
    },
    [channelId, ctx],
  );

  const deleteCb = useCallback(
    async (messageId: string) => {
      if (!channelId) return;
      await deleteMessageAction(ctx, { channelId, messageId });
    },
    [channelId, ctx],
  );

  const emitTyping = useCallback(() => {
    if (!channelId || !userId) return;
    chatRealtime.emitTyping(channelId, userId);
  }, [channelId, userId]);

  /*
    Read through `ctx.outbox`, never a separately-bound scope: it is the same
    store the flush uses, so Retry and Discard cannot resolve a row under a
    different member than the one that would send it.
  */
  const retry = useCallback(
    async (clientMessageId: string) => {
      const row = await ctx.outbox.get(clientMessageId);
      if (!row) return;
      await retryOutboxRow(ctx, row);
    },
    [ctx],
  );

  const discard = useCallback(
    async (clientMessageId: string) => {
      const row = await ctx.outbox.get(clientMessageId);
      if (!row) return;
      await discardOutboxRow(ctx, row);
    },
    [ctx],
  );

  const retryUnconfirmed = useCallback(
    async (replay: ReplayRequest) => retryPointsDispatch(ctx, replay),
    [ctx],
  );

  const act = useCallback(
    async (
      messageId: string,
      actionType: string,
      payload: Record<string, unknown>,
    ) => {
      if (!channelId) return;
      await actOnCard(ctx, { channelId, messageId, actionType, payload });
    },
    [channelId, ctx],
  );

  const dispatchSlash = useCallback(
    async (
      command: SlashCommand,
      args: string,
      announcementsChannelId: string | null,
      resolveMember?: ResolveMember,
    ) => {
      if (!channelId) {
        return { ok: false, error: "No active channel" };
      }
      return dispatchSlashCommand(ctx, {
        command,
        args,
        channelId,
        announcementsChannelId,
        resolveMember,
      });
    },
    [channelId, ctx],
  );

  // Best-effort flush whenever the connection comes live for this channel.
  useEffect(() => {
    if (connection !== "live") return;
    void flushOutbox(ctx);
  }, [connection, ctx]);

  const messages = useMemo(() => selectMessages(query.data), [query.data]);

  /*
    Keep this channel's tail on disk so the next cold load paints it (`1s`'s
    "first chunk"). Driven off `dataUpdatedAt` rather than the message array so
    a realtime merge — which is a `setQueryData`, and so bumps that timestamp —
    refreshes the cache the same way the initial backfill does.
  */
  usePersistedChannelTail(channelId, messages, query.dataUpdatedAt);

  const edgeId = oldestConfirmed(query.data)?.id ?? null;
  // On the data, not on `isSuccess`: a refetch that failed keeps its data and
  // reads `error`, and the history it holds can still be paged from.
  const hasOlder =
    !!channelId &&
    query.data !== undefined &&
    !(channelStarts.has(channelId) && channelStarts.get(channelId) === edgeId);
  const olderForChannel = channelId
    ? (olderStatus.get(channelId) ?? null)
    : null;

  return {
    messages,
    isLoading: query.isPending,
    loadError: query.error ?? null,
    hasOlder,
    isLoadingOlder: olderForChannel === "loading",
    olderError: olderForChannel === "error",
    loadOlder,
    loadNewer,
    send,
    react: reactCb,
    unreact: unreactCb,
    edit: editCb,
    delete: deleteCb,
    draft,
    setDraft,
    typingUsers,
    emitTyping,
    connection,
    retry,
    discard,
    retryUnconfirmed,
    dispatchSlash,
    act,
  };
}
