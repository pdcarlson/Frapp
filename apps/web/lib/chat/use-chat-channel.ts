"use client";

/**
 * Component-facing facade for a single chat channel.
 *
 * This hook is the **only** thing chat UI components touch. It hides the
 * normalized cache, the supabase singleton, the realtime manager, and the
 * outbox so components stay dumb (arrays + callbacks).
 *
 * Its mobile counterpart is `apps/mobile/lib/chat/use-chat-channel.ts`. The
 * two are not one hook, on purpose (#1004): what they share is logic, kept in
 * framework-free `@repo/chat-core`, and each hook holds only its client's React
 * wiring around it. A fix to shared behaviour belongs in chat-core, where both
 * clients get it. The mobile file's header is the one place that lists what
 * chat-core covers and what differs between the two, and why.
 */

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";
import { getRealtimeClient } from "@/lib/realtime/supabase-realtime";
import { useChannelDraft } from "./use-channel-draft";
import { useChatViewerId } from "@/lib/chat/viewer-id";
import { useToast } from "@/lib/hooks/use-toast";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import {
  chatMessagesKey,
  type ChannelCache,
  type ChatMessage,
} from "@repo/chat-core/types";
import {
  cacheFromPage,
  emptyCache,
  mergeUnheldRows,
  newestConfirmed,
  reconcileNewestPage,
  selectMessages,
  trimOlderThan,
} from "@repo/chat-core/cache";
import {
  createHistoryPageFetcher,
  createHistoryPager,
  OLDER_PAGE_LIMIT,
  olderHistoryView,
  SinceCursorNotFoundError,
  type HistoryPage,
  type LoadOlderResult,
} from "@repo/chat-core/history";
import {
  chatRealtime,
  NO_TYPING_USERS,
  type ConnectionStatus,
} from "@repo/chat-core/realtime-manager";
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
import {
  browserKeyValueStore,
  type OutboxAttachment,
} from "@repo/chat-core/adapters";
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
  /**
   * Loads the next page of older history. Concurrent calls share one read.
   * Resolves what it did (`LoadOlderResult`, `@repo/chat-core/history`).
   */
  loadOlder: () => Promise<LoadOlderResult>;
  /**
   * Reads what arrived after the newest loaded row, once, and merges it — or,
   * when more arrived than one read returns, makes that read the thread's
   * newest page: a jump's first move, since its target may be a message
   * Realtime has not delivered yet rather than an old one. Resolves how many
   * rows were new, or `null` when the read failed.
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
  /** The manager's list: the same array until someone starts or stops typing. */
  typingUsers: readonly string[];
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
    which chip lights up (`toggleReactionLocal`), whose optimistic row is
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
    painting a row as the wrong member's for one fetch, and strictly smaller than
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
    Every page, the newest and each older one (#1571), reads through the one
    chat-core fetcher, so reactions and poll tallies render on first paint.
  */
  const fetchPage = useMemo(
    () => createHistoryPageFetcher(apiClient, supabase),
    [apiClient, supabase],
  );

  /*
    The pager keeps what both clients' hooks share around paging: where each
    channel's history starts, one older read per channel at a time, and each
    channel's older-page status. Per channel, because one hook serves every
    channel the shell switches through.
  */
  const pager = useMemo(
    () => createHistoryPager(queryClient, fetchPage),
    [queryClient, fetchPage],
  );
  const pagerState = useSyncExternalStore(
    pager.subscribe,
    pager.getSnapshot,
    pager.getSnapshot,
  );

  /*
    The newest page. A refetch (`refetchOnReconnect: "always"`, the first-chunk
    seed's invalidate, `refetchTimelinesHolding` after a report removal) folds
    it into the cache as it stands rather than replacing it, and drops the
    older pages: see `reconcileNewestPage` for what that keeps and why.
  */
  const query = useQuery<ChannelCache, Error>({
    queryKey: channelId ? chatMessagesKey(channelId) : ["chat", "none"],
    enabled: !!channelId,
    staleTime: Infinity,
    queryFn: async () => {
      if (!channelId) return emptyCache();
      const newest = await pager.readNewest(channelId);
      // Re-merge the viewer's persisted heavy-command rows: `recorded`
      // (#1789), and `unconfirmed` with its Retry (#1909). The server never
      // wrote either, so the page never carries them, and the rebuild that
      // matters most is `refetchOnReconnect: "always"` firing on the
      // reconnect that follows the outage which lost the response.
      return mergePersistedNotices(newest, {
        channelId,
        viewerId: viewerRef.current,
        kv: browserKeyValueStore,
      });
    },
  });

  /*
    Older history (#1571), one page per call, merged into the live cache by
    `readOlderPage`, which owns the cursor and the merge.
  */
  const loadOlder = useCallback(
    (): Promise<LoadOlderResult> =>
      channelId ? pager.loadOlder(channelId) : Promise.resolve("start"),
    [channelId, pager],
  );

  /*
    What arrived after the newest loaded row (#1571 review), for a jump whose
    target may be newer than the cache rather than older.

    The API's `since` read is the newest `limit` rows after the pivot, not the
    ones right after it (#2807), so a full page may sit on the far side of a
    hole. Merged, it would draw the hole as silence and put a target inside it
    out of reach of paging back. A full page is therefore folded in the way
    the channel query folds its newest page: it becomes the thread's newest
    page, and the older rows it is not contiguous with go
    (`reconcileNewestPage`), so paging back runs contiguously through the
    hole. No second request: the rows in hand already are that page. The
    reconnect backfill follows the same rule (`mergeSincePage`); this read
    rebuilds from the page instead because it carries the page's reactions.

    Heavy-command cards it delivers settle their persisted notices, as every
    other path that delivers a server card does (`mergePersistedNotices`), or
    a stale Retry could come back on a later cold load.
  */
  const loadNewer = useCallback(async (): Promise<number | null> => {
    if (!channelId) return 0;
    const key = chatMessagesKey(channelId);
    const newest = newestConfirmed(queryClient.getQueryData<ChannelCache>(key));
    if (!newest) return 0;
    try {
      // The server no longer holds the newest row this thread does (purged,
      // and its Realtime delete missed), so nothing reads as after it. Nor can
      // the thread vouch for any confirmed row up to its instant: a purge
      // deletes in slices, and its other deletes were missed the same way.
      // Those rows go, and the newest page is read instead, bringing back
      // with their reactions whichever of them still exist. Dropping only
      // the one row would key the next forward read on the next purged row,
      // failing again one row per jump.
      let goneAt: number | null = null;
      let page: HistoryPage;
      try {
        page = await fetchPage(channelId, {
          limit: OLDER_PAGE_LIMIT,
          since: newest.id,
        });
      } catch (error) {
        if (!(error instanceof SinceCursorNotFoundError)) throw error;
        goneAt = Date.parse(newest.created_at);
        page = await fetchPage(channelId, { limit: OLDER_PAGE_LIMIT });
      }
      const { rows, actions, actionsIncomplete } = page;
      // Merged once, like an older page, so partial tallies would stay: a
      // failed read instead, which the jump reports.
      if (actionsIncomplete) return null;
      const full = rows.length >= OLDER_PAGE_LIMIT;
      let added = 0;
      queryClient.setQueryData<ChannelCache>(key, (current) => {
        if (!current) return current;
        const held =
          goneAt === null ? current : trimOlderThan(current, goneAt + 1);
        // New to the thread, not to `held`: rows the trim took and the page
        // brought back were on screen all along.
        added = rows.filter((row) => !current.byId[row.id]).length;
        const next = full
          ? reconcileNewestPage(held, cacheFromPage(rows, actions))
          : mergeUnheldRows(held, rows, actions).cache;
        return mergePersistedNotices(next, {
          channelId,
          viewerId: viewerRef.current,
          kv: browserKeyValueStore,
        });
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

  /*
    Typing users: re-read from the manager on each status ping (it pings on
    typing changes too). Most pings carry no change for this channel, and
    `getTypingUsers` then hands back the array it returned last, so this set
    bails out instead of re-rendering the thread (#1004). With no channel open
    nobody is typing, rather than the last channel's typists.
  */
  const [typingUsersState, setTypingUsers] =
    useState<readonly string[]>(NO_TYPING_USERS);
  useEffect(() => {
    if (!channelId) return;
    const refresh = () =>
      setTypingUsers(chatRealtime.getTypingUsers(channelId));
    refresh();
    return chatRealtime.subscribeStatus(refresh);
  }, [channelId]);
  const typingUsers = channelId ? typingUsersState : NO_TYPING_USERS;

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

  return {
    messages,
    isLoading: query.isPending,
    loadError: query.error ?? null,
    ...olderHistoryView(pagerState, channelId, query.data),
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
